"""Khối điều khiển cơ bản: Start, End, Delay, Biến đầu vào, Xếp hàng, Xoá file."""
import shutil
import time

from services import executor_blocks as eb

from .context import BREAK, SKIP


def handle_start(ctx, step):
    ctx.log(step.bid, "info", "start_block", label=step.label)


def handle_end(ctx, step):
    ctx.log(step.bid, "info", "end_block", label=step.label)
    return BREAK


def handle_delay(ctx, step):
    delay_sec = float(step.bdata.get("delaySeconds", 3))
    ctx.log(step.bid, "info", "delay_waiting", label=step.label, delay=delay_sec)

    # Chờ có kiểm tra stop_event mỗi 0.5s. Bị Dừng thì KHÔNG return BREAK ở đây — giữ
    # đúng hành vi cũ: đặt final_status rồi để vòng lặp tự thoát ở lượt kế tiếp.
    waited = 0.0
    while waited < delay_sec:
        if ctx.stopped():
            ctx.log(step.bid, "warning", "delay_stopped", waited=int(waited))
            ctx.final_status = "stopped"
            return None
        sleep_time = min(0.5, delay_sec - waited)
        time.sleep(sleep_time)
        waited += sleep_time
    ctx.log(step.bid, "success", "delay_done", delay=delay_sec)


def handle_input_vars(ctx, step):
    bid, label = step.bid, step.label
    fields = step.bdata.get("inputFields") or []
    timeout = float(step.bdata.get("inputTimeout") or 120)
    # Chuẩn hoá field gửi cho FE (bỏ field thiếu tên biến)
    safe_fields = [
        {
            "name": (f.get("name") or "").strip(),
            "label": f.get("label") or f.get("name") or "",
            "type": f.get("type") or "text",
            "required": bool(f.get("required")),
            "defaultValue": f.get("defaultValue", ""),
            "placeholder": f.get("placeholder", ""),
        }
        for f in fields if (f.get("name") or "").strip()
    ]
    if not safe_fields:
        ctx.log(bid, "warning", "input_vars_not_configured", label=label)
        return None

    deadline = time.time() + timeout
    ev = eb.register_pending_input(ctx.run_id, bid, label, safe_fields, deadline)
    ctx.log(bid, "info", "input_vars_waiting", label=label, count=len(safe_fields), timeout=int(timeout))

    got_input = False
    stopped = False
    while time.time() < deadline:
        if ctx.stopped():
            stopped = True
            break
        if ev.wait(timeout=0.5):
            got_input = True
            break

    with eb._pending_lock:
        p = eb._pending_inputs.get(ctx.run_id)
        values = (p or {}).get("values") if got_input else None
    eb.clear_pending_input(ctx.run_id)

    if stopped:
        ctx.log(bid, "warning", "input_vars_stopped")
        ctx.final_status = "stopped"
        return BREAK

    if not got_input or values is None:
        ctx.log(bid, "error", "input_vars_timeout", timeout=int(timeout), label=label)
        return ctx.fail(step, f"Hết thời gian chờ nhập biến ({int(timeout)}s) tại khối [{label}]")

    # Gộp vào current_input → tự merge vào workflow_env cho khối sau
    if not isinstance(step.current_input, dict):
        step.current_input = {}
    applied = []
    for f in safe_fields:
        name = f["name"]
        step.current_input[name] = (values.get(name, f.get("defaultValue", ""))
                                    if isinstance(values, dict) else f.get("defaultValue", ""))
        applied.append(name)
    ctx.log(bid, "success", "input_vars_received", names=", ".join(applied))


def handle_queue(ctx, step):
    """Khối "Xếp hàng": 1 vào - 1 ra, không xử lý gì, không đổi biến.

    Cơ chế "lấy số chờ tới lượt": nếu trong hàng đợi còn khối THƯỜNG (không phải
    queue) đang chờ chạy → tự lùi xuống cuối hàng, nhường cho các nhánh song song
    chạy hết. Chỉ khi không còn khối thường nào chờ mới đi tiếp → khối phía sau luôn
    chạy SAU CÙNG. (Loại trừ queue giúp nhiều khối queue không "nhường" nhau vô tận.)
    """
    non_queue_pending = any(
        ((ctx.nodes_dict.get(nid) or {}).get("data") or {}).get("type") != "queue"
        for nid, _ in ctx.queue
    )
    if non_queue_pending:
        ctx.run_counts[step.node_id] -= 1  # lần lùi hàng không tính là 1 lần chạy thật
        ctx.queue.append((step.node_id, step.current_input))
        return SKIP
    ctx.log(step.bid, "info", "queue_turn", label=step.label)


def _empty_dir(path, keep=()):
    if not path.exists():
        return
    for item in path.iterdir():
        if item.name in keep:
            continue
        if item.is_file():
            item.unlink()
        elif item.is_dir():
            shutil.rmtree(item)


def handle_delete_files(ctx, step):
    # Lỗi xoá chỉ log, KHÔNG dừng workflow (giữ hành vi cũ).
    if step.bdata.get("delete_input", False):
        try:
            _empty_dir(ctx.input_dir, keep=("input.json",))
            ctx.log(step.bid, "success", "delete_input_success")
        except Exception as e:
            ctx.log(step.bid, "error", "delete_input_error", error=e)

    if step.bdata.get("delete_output", False):
        try:
            _empty_dir(ctx.output_dir)
            ctx.log(step.bid, "success", "delete_output_success")
        except Exception as e:
            ctx.log(step.bid, "error", "delete_output_error", error=e)


HANDLERS = {
    "start": handle_start,
    "end": handle_end,
    "delay": handle_delay,
    "input_vars": handle_input_vars,
    "queue": handle_queue,
    "delete_files": handle_delete_files,
}
