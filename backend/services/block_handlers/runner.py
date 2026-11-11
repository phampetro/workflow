"""Vòng lặp điều phối workflow: lấy khối khỏi hàng đợi → gọi handler → đẩy sang khối kế.

Mọi logic RIÊNG của từng loại khối nằm trong handler (basic/flow/sql/excel/...).
File này chỉ giữ phần chung: chọn khối bắt đầu, đọc input.json, chống lặp vô hạn,
nội suy cấu hình, gộp biến vào workflow_env, rẽ nhánh và ghi trạng thái cuối.
"""
import json
import logging
import re
import time
from datetime import datetime

from services import executor_blocks as eb

from .context import ABORT, BREAK, SKIP, BlockStep, RunContext

logger = logging.getLogger("pyflow.runner")

MAX_RUNS_PER_NODE = 2000


def _load_input_json(input_dir):
    """input.json của workflow → dict biến toàn cục. Cho phép chú thích // /* */ và dấu phẩy thừa."""
    input_file = input_dir / "input.json"
    if not input_file.exists():
        return {}
    try:
        content = input_file.read_text(encoding="utf-8")
        pattern = r'("(?:\\.|[^"\\])*")|(//.*)|(/\*[\s\S]*?\*/)'
        cleaned = re.sub(pattern, lambda m: m.group(1) if m.group(1) else "", content)
        cleaned = re.sub(r",(\s*[}\]])", r"\1", cleaned)
        return json.loads(cleaned)
    except Exception as e:
        # Không chặn run (giữ hành vi cũ) nhưng phải để lại dấu vết: input.json hỏng
        # nghĩa là MỌI {{biến}} trong workflow sẽ đứng im ở dạng chữ.
        logger.warning("Không đọc được %s: %s", input_file, e)
        return {}


def _read_triggered_by(run_id):
    try:
        with eb.connect_sqlite() as conn:
            row = conn.execute("SELECT triggered_by FROM workflow_run WHERE id=?", (run_id,)).fetchone()
            return row[0] if row else None
    except Exception as e:
        logger.warning("Không đọc được triggered_by của run %s: %s", run_id, e)
        return None


def _pick_start_nodes(nodes, triggered_by):
    """Trả (start_nodes, initial_input)."""
    listeners = [n for n in nodes if n.get("data", {}).get("type") == "telegram_listener"]
    with_input = [n for n in listeners if "_initial_input" in n.get("data", {})]
    if with_input:
        return with_input, with_input[0]["data"]["_initial_input"]
    if triggered_by == "listener_autostart" and listeners:
        # Khởi động lại backend → bật thẳng khối listener không qua Start
        return listeners, None
    return [n for n in nodes if n.get("data", {}).get("type") == "start"], None


def _wait_loop_delay(ctx, step):
    """Chờ loopDelay, kiểm Dừng mỗi 0.5s. Trả True nếu bị Dừng.

    Trước đây time.sleep(delay) nguyên khối khiến nút Dừng phải đợi hết loopDelay.
    """
    delay = float(step.bdata.get("loopDelay") or 0)
    if delay <= 0:
        return False
    ctx.log(step.bid, "info", "loop_delay", delay=delay)
    waited = 0.0
    while waited < delay:
        if ctx.stopped():
            ctx.final_status = "stopped"
            return True
        t = min(0.5, delay - waited)
        time.sleep(t)
        waited += t
    return False


def _propagate(ctx, step):
    """Gộp output vào workflow_env và đẩy sang các khối kế (theo nhánh nếu có)."""
    if isinstance(step.current_input, dict):
        # current_input đã mang đúng tên biến người dùng đặt (rename_output_keys) nên
        # chỉ cần gộp phẳng là {{ten_bien}} đọc được. KHÔNG ghi nguyên dict dưới tên
        # biến (từng làm {{file_name}} trả về cả object).
        ctx.workflow_env.update(step.current_input)
        if ctx.log_fn:
            desc = eb.describe_output_vars(step.btype, step.bdata, step.current_input, language=ctx.language)
            if desc:
                ctx.log(step.bid, "info", "output_vars_line", label=step.label, desc=desc)

    branching = step.btype in ("condition", "loop")
    for e in ctx.edges_from.get(step.node_id, []):
        if not branching or e.get("sourceHandle") == step.branch:
            ctx.queue.append((e["target"], step.current_input))


def _run_loop(ctx, handlers):
    """Trả False nếu run đã được kết thúc bên trong (ABORT)."""
    while ctx.queue:
        if ctx.stopped():
            ctx.log("system", "warning", "workflow_stopped_by_user")
            ctx.final_status = "stopped"
            break

        node_id, current_input = ctx.queue.popleft()
        if ctx.run_counts[node_id] > MAX_RUNS_PER_NODE:
            ctx.log("system", "error", "infinite_loop_detected", node_id=node_id)
            ctx.final_status = "error"
            ctx.final_error = f"Phát hiện lặp vô hạn ở Node {node_id} (>{MAX_RUNS_PER_NODE} lần)"
            break
        ctx.run_counts[node_id] += 1

        node = ctx.nodes_dict.get(node_id)
        if not node:
            continue

        step = BlockStep(ctx, node_id, node, current_input)
        handler = handlers.get(step.btype)
        if handler is None:
            # Loại khối không có handler: trước đây lọt qua im lặng (node `database` cũ
            # vẫn nằm trong workflow thật mà không ai biết). Cảnh báo để người dùng gỡ,
            # KHÔNG dừng workflow — dừng sẽ phá các workflow đang chạy được.
            ctx.log(step.bid, "warning", "unsupported_block_type", label=step.label, btype=step.btype)
            signal = None
        else:
            signal = handler(ctx, step)

        if signal == ABORT:
            return False
        if signal == BREAK:
            break
        if signal == SKIP:
            continue

        if step.continue_branch and ctx.final_status != "error":
            if step.btype == "loop" and step.branch == "loop" and _wait_loop_delay(ctx, step):
                break
            _propagate(ctx, step)
    return True


def _finish(ctx):
    total_ms = ctx.elapsed_ms()
    # Có khối lỗi mà nhánh Bắt Lỗi chạy xong không báo gì thì vẫn là run LỖI. Không đè
    # lên "stopped" — người dùng bấm Dừng là chủ ý, không phải lỗi.
    if ctx.workflow_failed and ctx.final_status == "success":
        ctx.final_status = "error"
    eb._finish_run(ctx.run_id, ctx.final_status, ctx.start, error=ctx.final_error,
                   log_fn=ctx.log_fn, language=ctx.language)
    if not ctx.log_fn:
        return
    if ctx.final_status == "success":
        ctx.log_fn("system", "success", eb.tr(ctx.language, "workflow_done", ms=total_ms), event="workflow_done")
    elif ctx.final_status == "stopped":
        ctx.log_fn("system", "warning", eb.tr(ctx.language, "workflow_stopped_total", ms=total_ms),
                   event="workflow_stopped")
    else:
        ctx.log_fn("system", "error", eb.tr(ctx.language, "workflow_failed", ms=total_ms), event="workflow_failed")


def run_workflow(run_id, project_id, workflow_id, workflow_name, graph_json, log_fn, stop_event,
                 language="vi"):
    """Chạy toàn bộ workflow trong thread executor (đồng bộ)."""
    from . import BLOCK_HANDLERS

    time.sleep(0.5)  # Đợi client SSE kết nối trước khi chạy nhanh
    start = datetime.now()

    # Đăng ký để kill_run / stop_all_runs_for_workflow tìm được; _finish_run dọn.
    eb._active_runs[run_id] = stop_event
    eb._workflow_run_ids.setdefault(workflow_id, set()).add(run_id)

    try:
        graph = json.loads(graph_json)
    except Exception as e:
        eb._finish_run(run_id, "error", start, error=str(e))
        return

    try:
        wf_dir = eb.get_project_dir(project_id) / f"wf_{eb.slugify(workflow_name)}"
        input_dir = wf_dir / "input"
        # Profile trình duyệt riêng cho lượt chạy này
        browser_profile_dir = wf_dir / "runs" / run_id / "browser_profile"
        eb._active_browser_profiles[run_id] = browser_profile_dir
        input_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        # Lỗi trước vòng chính (DB lock, PermissionError...) không được để run kẹt RUNNING
        eb._finish_run(run_id, "error", start, error=str(e))
        if log_fn:
            log_fn("system", "error", eb.tr(language, "workflow_prepare_dir_error", error=e))
        return

    try:
        ctx = RunContext(
            run_id=run_id, project_id=project_id, workflow_id=workflow_id,
            workflow_name=workflow_name, graph_json=graph_json, log_fn=log_fn,
            stop_event=stop_event, language=language, start=start, wf_dir=wf_dir,
            input_dir=input_dir, browser_profile_dir=browser_profile_dir,
            nodes=graph.get("nodes", []), edges=graph.get("edges", []),
        )
        start_nodes, initial_input = _pick_start_nodes(ctx.nodes, _read_triggered_by(run_id))
        if not start_nodes:
            ctx.log("system", "error", "no_start_block")
            eb._finish_run(run_id, "error", start, error="Missing Start block")
            return

        ctx.queue.append((start_nodes[0]["id"], initial_input))
        ctx.log("system", "info", "workflow_start")
        ctx.workflow_env = _load_input_json(input_dir)

        if _run_loop(ctx, BLOCK_HANDLERS):
            _finish(ctx)
    except Exception as e:
        logger.exception("Lỗi hệ thống trong thread workflow (run %s)", run_id)
        eb._finish_run(run_id, "error", start, error=str(e), log_fn=log_fn, language=language)
        if log_fn:
            log_fn("system", "error", eb.tr(language, "workflow_system_error", error=str(e)),
                   event="workflow_system_error")
