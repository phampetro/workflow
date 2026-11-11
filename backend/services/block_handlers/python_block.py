"""Khối Python do người dùng tự viết code."""
from .common import run_script


def handle_python(ctx, step):
    code = step.bdata.get("code", "").strip()
    if not code:
        ctx.log(step.bid, "warning", "python_no_code", label=step.label)
        step.continue_branch = False
        return None

    ctx.log(step.bid, "info", "python_running", label=step.label)
    success, output, error, _ = run_script(ctx, step, code, timeout=7200,
                                           workflow_env=ctx.workflow_env)
    if not success:
        return ctx.block_failed(step, error)
    # Khối Python KHÔNG đổi tên key: output_data người dùng tự đặt tên.
    step.current_input = output


HANDLERS = {"python": handle_python}
