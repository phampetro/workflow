"""Trạng thái của MỘT lượt chạy workflow và của khối đang chạy.

Trước đây toàn bộ phần này là biến cục bộ + closure ``nonlocal`` trong một hàm
~1.200 dòng (``execute_workflow_thread``). Tách ra để mỗi loại khối là một hàm
handler riêng ``handler(ctx, step) -> Signal | None``.

Handler báo cho vòng lặp phải làm gì tiếp bằng giá trị trả về — tương ứng 1-1 với
``continue`` / ``break`` / ``return`` của vòng lặp cũ:

- ``None``   chạy xong bình thường → đẩy ``step.current_input`` sang khối kế
             (trừ khi handler đặt ``step.continue_branch = False``).
- ``SKIP``   không đẩy sang khối kế (``continue`` cũ) — VD lỗi đã chuyển sang Bắt Lỗi.
- ``BREAK``  thoát vòng lặp, kết thúc run theo ``ctx.final_status`` (``break`` cũ).
- ``ABORT``  run ĐÃ được ``_finish_run`` ghi trạng thái → thoát ngay (``return`` cũ).
"""
from collections import Counter, deque
from datetime import datetime

from services.log_messages import tr

SKIP = "skip"
BREAK = "break"
ABORT = "abort"


class RunContext:
    def __init__(self, *, run_id, project_id, workflow_id, workflow_name, graph_json,
                 log_fn, stop_event, language, start, wf_dir, input_dir,
                 browser_profile_dir, nodes, edges):
        self.run_id = run_id
        self.project_id = project_id
        self.workflow_id = workflow_id
        self.workflow_name = workflow_name
        self.graph_json = graph_json
        self.log_fn = log_fn
        self.stop_event = stop_event
        self.language = language
        self.start = start
        self.wf_dir = wf_dir
        self.input_dir = input_dir
        self.output_dir = wf_dir / "output"
        self.browser_profile_dir = browser_profile_dir

        self.nodes = nodes
        self.nodes_dict = {n["id"]: n for n in nodes}
        self.edges_from = {}
        for e in edges:
            self.edges_from.setdefault(e["source"], []).append(e)
        self.error_trigger_nodes = [n for n in nodes
                                    if n.get("data", {}).get("type") == "error_trigger"]

        self.queue = deque()           # (node_id, input_data)
        self.workflow_env = {}
        self.run_counts = Counter()
        self.loop_states = {}
        self.final_status = "success"
        # Lý do lỗi cho nhánh thoát bằng BREAK (không đi qua handle_workflow_error).
        # Thiếu biến này là lý do 11/28 run trong lịch sử có status=error mà
        # error_message rỗng → mở Lịch sử chỉ thấy "Lỗi" trần, không biết vì sao.
        self.final_error = None
        # Đã có khối gặp lỗi, KỂ CẢ khi nhánh Bắt Lỗi đã xử lý xong êm đẹp.
        # Phải tách khỏi final_status: cổng ở cuối vòng (`final_status != "error"`)
        # quyết định output có được đẩy sang khối kế hay không, nên đặt
        # final_status="error" ngay lúc lỗi sẽ làm nhánh Bắt Lỗi chỉ chạy được
        # đúng khối đầu tiên. Chỉ quy đổi sang status cuối cùng sau vòng lặp.
        self.workflow_failed = False
        self.in_error_mode = False

    # ── log ──────────────────────────────────────────────────────────
    def log(self, bid, level, key, **params):
        """Log qua bảng dịch log_messages (key + tham số)."""
        if self.log_fn:
            self.log_fn(bid, level, tr(self.language, key, **params))

    def log_raw(self, bid, level, msg):
        if self.log_fn:
            self.log_fn(bid, level, msg)

    def elapsed_ms(self):
        return int((datetime.now() - self.start).total_seconds() * 1000)

    def stopped(self):
        return bool(self.stop_event and self.stop_event.is_set())

    # ── xử lý lỗi ────────────────────────────────────────────────────
    def handle_workflow_error(self, error_msg, failed_bid=None, failed_label=None):
        """Ghi nhận lỗi; có khối Bắt Lỗi thì chuyển hướng sang đó.

        Trả True nếu run đã kết thúc (đã _finish_run) → caller phải ABORT.
        """
        from services import executor_blocks as eb

        # Workflow ĐÃ thất bại, dù nhánh Bắt Lỗi có chạy trơn tru sau đó.
        # Trước đây nhánh error_trigger return False mà không ghi nhận gì →
        # _finish_run cuối hàm vẫn nhận "success", Lịch sử báo Thành công và
        # Dashboard đếm là chạy thành công cho một workflow đã lỗi.
        self.workflow_failed = True
        if self.final_error is None:
            self.final_error = error_msg
        if self.in_error_mode:
            eb._finish_run(self.run_id, "error", self.start, error=error_msg,
                           log_fn=self.log_fn, language=self.language)
            return True

        if self.error_trigger_nodes:
            if self.log_fn:
                suffix = tr(self.language, "error_redirect_suffix", label=failed_label) if failed_label else ""
                self.log("system", "warning", "error_redirect", suffix=suffix)
            self.queue.clear()
            self.in_error_mode = True
            payload = {
                "status": "error",
                "error_detail": error_msg,
                "failed_block": failed_label,
                "failed_block_id": failed_bid,
            }
            for et_node in self.error_trigger_nodes:
                self.queue.append((et_node["id"], payload))
            return False

        eb._finish_run(self.run_id, "error", self.start, error=error_msg,
                       log_fn=self.log_fn, language=self.language)
        return True

    def fail(self, step, error_msg):
        """Khối lỗi (đã tự log chi tiết) → chuyển sang Bắt Lỗi hoặc kết thúc run."""
        return ABORT if self.handle_workflow_error(error_msg, step.bid, step.label) else SKIP

    def block_failed(self, step, error_msg, fail_log=None):
        """Xử lý chung cho MỌI khối chạy qua run_python_block_sync khi thất bại.

        Gom về một chỗ vì trước đây chỉ khối `python` và `browser` kiểm
        error == "stopped"; 5 khối SQL/Excel thiếu nhánh này nên bấm Dừng giữa
        lúc import 500k dòng bị ghi thành LỖI và bắn cảnh báo Bắt Lỗi vô cớ.
        """
        if error_msg == "stopped":
            self.final_status = "stopped"
            return BREAK
        if self.log_fn:
            self.log_fn("system", "error",
                        fail_log or tr(self.language, "workflow_failed", ms=self.elapsed_ms()))
        return self.fail(step, error_msg)


class BlockStep:
    """Khối đang chạy: cấu hình đã nội suy + dữ liệu vào/ra + cờ rẽ nhánh."""

    def __init__(self, ctx, node_id, node, current_input):
        self.ctx = ctx
        self.node_id = node_id
        self.bid = node["id"]
        self.current_input = current_input
        raw = node.get("data", {})
        self.btype = raw.get("type", "python")
        self.bdata = self._interpolate_bdata(raw)
        self.label = self.bdata.get("label", self.bid)
        self.continue_branch = True
        self.branch = None   # condition/loop: handle của nhánh được chọn

    # ── nội suy {{var}} ──────────────────────────────────────────────
    def interpolate(self, val):
        """Nội suy 1 chuỗi theo workflow_env + current_input HIỆN TẠI.

        re.sub MỘT lượt để giá trị được thay không bị quét tiếp — nếu không, giá trị
        của biến k1 chứa "{{k2}}" sẽ bị thay tiếp, gây rò dữ liệu (VD sender_name
        Telegram do người ngoài đặt là "{{password_web}}").
        """
        import re
        if not isinstance(val, str):
            return val
        ctx = dict(self.ctx.workflow_env)
        if isinstance(self.current_input, dict):
            ctx.update(self.current_input)
        ctx["input_data"] = self.current_input
        if val in ctx:
            return str(ctx[val])

        def _sub(m):
            key = m.group(1)
            return str(ctx[key]) if key in ctx else m.group(0)
        return re.sub(r"\{\{(\w+)\}\}", _sub, val)

    def interpolate_deep(self, val, current_key=None):
        """Nội suy đệ quy dict/list; bỏ qua field tên biến/code (NON_INTERPOLATED_KEYS).

        Kiểm key TRƯỚC khi rẽ theo kiểu dữ liệu để chặn được cả nhánh dict/list
        (VD columnMappings là dict {cột gốc: tên biến}).
        """
        from services.executor_blocks import NON_INTERPOLATED_KEYS
        if current_key in NON_INTERPOLATED_KEYS:
            return val
        if isinstance(val, str):
            return self.interpolate(val)
        if isinstance(val, dict):
            return {k: self.interpolate_deep(v, k) for k, v in val.items()}
        if isinstance(val, list):
            return [self.interpolate_deep(item, current_key) for item in val]
        return val

    # Field giữ nguyên {{biến}} để handler tự nội suy động:
    # - "steps" của Browser: browser_executor nội suy theo từng bước.
    # - "excelEditSteps": excel_edit.resolve_steps tự nội suy, tránh nhánh "gõ tên
    #   trần" làm cột "A" bị thay bằng giá trị của biến tên A.
    _RAW_FIELDS = {("browser", "steps"), ("excel_edit", "excelEditSteps")}

    def _interpolate_bdata(self, raw):
        return {k: (v if (self.btype, k) in self._RAW_FIELDS else self.interpolate_deep(v, k))
                for k, v in raw.items()}

    def merged_vars(self):
        """workflow_env + current_input (current_input đè) — cho khối tự nội suy."""
        merged = dict(self.ctx.workflow_env)
        if isinstance(self.current_input, dict):
            merged.update(self.current_input)
        return merged
