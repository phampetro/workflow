"""Tiện ích dùng chung cho handler: chạy script con, cài package, tìm file."""
from services import executor_blocks as eb


def run_script(ctx, step, code, timeout=7200, workflow_env=None):
    """Chạy ``code`` trong venv project qua run_python_block_sync.

    Gọi qua ``eb.run_python_block_sync`` (tra thuộc tính lúc chạy) để test thay được.
    Chỉ khối Python người dùng viết nhận ``workflow_env``; khối sinh sẵn script thì không.
    """
    kwargs = dict(timeout=timeout, label=step.label, log_fn=ctx.log_fn,
                  input_dir=str(ctx.input_dir), stop_event=ctx.stop_event,
                  run_id=ctx.run_id, language=ctx.language)
    if workflow_env is not None:
        kwargs["workflow_env"] = workflow_env
    return eb.run_python_block_sync(ctx.project_id, step.bid, ctx.workflow_id, code,
                                    step.current_input, **kwargs)


def ensure_block_packages(ctx, step, db_type=None):
    """Cài package khối cần — danh sách lấy từ pkg_scanner (nguồn duy nhất)."""
    from services.pkg_scanner import required_packages
    eb.ensure_packages(ctx.project_id, required_packages(step.btype, db_type), ctx.log_fn,
                       step.bid, step.label, ctx.stop_event, language=ctx.language)


def find_file(ctx, name, input_first=True):
    """Tìm file theo TÊN THUẦN trong input/ rồi output/ (hoặc ngược lại). None nếu không có."""
    dirs = (ctx.input_dir, ctx.output_dir) if input_first else (ctx.output_dir, ctx.input_dir)
    for d in dirs:
        path = d / name
        if path.exists() and path.is_file():
            return path
    return None


def finish_script(ctx, step, result, fail_log=None):
    """Kết quả run_script → Signal khi lỗi, hoặc gán output (đã đổi tên biến) vào step."""
    success, output, error, _duration = result
    if not success:
        return ctx.block_failed(step, error, fail_log=fail_log)
    step.current_input = eb.rename_output_keys(step.btype, step.bdata, output)
    return None
