"""Handler cho từng loại khối workflow.

Thêm khối mới:
1. Viết ``handle_<loai>(ctx, step)`` trong module phù hợp (hoặc module mới), khai vào
   dict ``HANDLERS`` của module đó. Đọc ``context.py`` để biết giá trị trả về.
2. Khối trả dữ liệu ra → khai ``BLOCK_OUTPUT_VARS`` + ``NON_INTERPOLATED_KEYS`` trong
   executor_blocks.py và gọi ``rename_output_keys`` (xem CLAUDE.md §Quy ước biến output).
3. Khối chạy script trong venv project → khai package vào ``_BLOCK_BASE`` ở
   pkg_scanner.py, rồi gọi ``ensure_block_packages(ctx, step)`` (common.py).
4. Thêm test vào backend/tests/test_workflow_engine.py.
"""
from . import basic, browser, email_block, excel, flow, python_block, read_data, sql, telegram


def _error_trigger(ctx, step):
    """Khối Bắt Lỗi chỉ là điểm vào nhánh lỗi — payload lỗi đi tiếp nguyên vẹn.

    Trước đây không có handler nên mỗi lần chuyển sang Bắt Lỗi lại log thêm cảnh báo
    giả "loại khối không hỗ trợ".
    """
    return None


BLOCK_HANDLERS = {"error_trigger": _error_trigger}
for _mod in (basic, browser, email_block, excel, flow, python_block, read_data, sql, telegram):
    for _btype, _fn in _mod.HANDLERS.items():
        assert _btype not in BLOCK_HANDLERS, f"Trùng handler cho khối {_btype}"
        BLOCK_HANDLERS[_btype] = _fn
