"""Khối Trình duyệt (Playwright) — phần điều phối; logic thật ở services/browser_executor."""
from .context import BREAK


def handle_browser(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    steps = bdata.get("steps", [])
    if not steps:
        ctx.log(bid, "warning", "browser_no_steps", label=label)
        step.continue_branch = False
        return None

    ctx.log(bid, "info", "browser_running", label=label)
    from services.browser_executor import run_browser_block

    try:
        ctx.output_dir.mkdir(exist_ok=True)
        # "steps" KHÔNG được nội suy trước (xem BlockStep._RAW_FIELDS): browser_executor
        # tự nội suy từng bước, tránh lấy nhầm dữ liệu vòng lặp cũ. Truyền vào toàn bộ
        # biến (workflow_env + current_input).
        b_result = run_browser_block(
            block_id=bid,
            workflow_id=ctx.workflow_id,
            run_id=ctx.run_id,
            steps=steps,
            input_data=step.merged_vars(),
            headless=not bdata.get("debugMode", False),
            log_callback=ctx.log_fn,
            output_dir=str(ctx.output_dir).replace("\\", "/"),
            stop_event=ctx.stop_event,
            browser_profile_dir=str(ctx.browser_profile_dir).replace("\\", "/"),
            language=ctx.language,
        )
    except Exception as e:
        ctx.log("system", "error", "browser_exception", error=e)
        return ctx.fail(step, str(e))

    if not b_result.get("success"):
        if b_result.get("stopped"):
            # Không _finish_run ở đây — để vòng lặp chính log "⏹ Đã dừng sau Xms".
            ctx.final_status = "stopped"
            return BREAK
        ctx.log("system", "error", "workflow_failed_browser")
        return ctx.fail(step, b_result.get("error"))

    browser_out = b_result.get("output_data")
    if browser_out is not None:
        # Giữ mọi biến cũ (chat_id, message_id, sent_message_id...) rồi thêm dữ liệu mới
        if isinstance(step.current_input, dict) and isinstance(browser_out, dict):
            merged = dict(step.current_input)
            merged.update(browser_out)
            step.current_input = merged
        else:
            step.current_input = browser_out


HANDLERS = {"browser": handle_browser}
