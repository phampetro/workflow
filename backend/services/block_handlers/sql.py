"""Khối SQL: SQL → Excel, Excel → SQL, Chạy hàm SQL (EXEC).

Phần chạy thật nằm trong script cố định ``services/block_scripts/<khối>.py``; handler
chỉ kiểm cấu hình rồi truyền vào qua ``script_code(ten, params)`` (một biến PARAMS
dạng JSON). Các ô cấu hình đã đi qua nội suy {{var}} nên có thể chứa nội dung do
người ngoài gửi (``{{text}}`` của Telegram Listener): tên bảng vẫn phải qua
``_VALID_TABLE_NAME``, tên file qua ``safe_filename``. Xem CLAUDE.md §Bảo mật.
"""
from services import executor_blocks as eb

from .common import ensure_block_packages, finish_script, run_script, script_code


def handle_sql_to_excel(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    sql_query = bdata.get("sqlQuery", "").strip()
    excel_filename = eb.safe_filename(bdata.get("excelFileName", ""), "sqltoexcel.xlsx")
    db_config = eb.get_saved_db_connection(bdata.get("sqlToExcelSavedConnectionId", "").strip())

    if not sql_query:
        ctx.log(bid, "warning", "sql_missing_query", label=label)
        step.continue_branch = False
        return None
    if not db_config:
        ctx.log(bid, "error", "block_missing_db_connection", label=label)
        return ctx.fail(step, "Chưa chọn Kết nối Database cho khối SQL to Excel")

    conn_str = eb.build_conn_str(db_config)
    ensure_block_packages(ctx, step, db_config.get("db_type"))
    ctx.log(bid, "info", "sql_to_excel_running", label=label)

    code = script_code("sql_to_excel", {
        "conn_str": conn_str, "sql_query": sql_query, "excel_filename": excel_filename,
    })
    return finish_script(ctx, step, run_script(ctx, step, code))


def _parse_header_rows(header_row_str):
    """"1" → 0, "1-2"/"1,2" → [0, 1] (chỉ số pandas), rỗng/rác → 0."""
    h_indices = [max(0, int(p) - 1)
                 for p in (x.strip() for x in header_row_str.replace("-", ",").split(","))
                 if p.isdigit()]
    if not h_indices:
        return 0
    return h_indices[0] if len(h_indices) == 1 else h_indices


def handle_excel_to_sql(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    # Tên file thuần: ô này đi qua nội suy {{var}}, "../../" sẽ import file bất kỳ.
    input_file = eb.safe_filename(bdata.get("excelToSqlInputFile", "").strip(), "")
    table_name = bdata.get("excelToSqlTableName", "").strip()
    import_mode = bdata.get("excelToSqlImportMode", "append")
    mapping = bdata.get("excelToSqlMapping", {})
    header_row_str = str(bdata.get("excelToSqlHeaderRow", "1"))
    header_row_val = _parse_header_rows(header_row_str)
    db_config = eb.get_saved_db_connection(bdata.get("excelToSqlSavedConnectionId", "").strip())

    if not input_file or not table_name:
        ctx.log(bid, "error", "excel_to_sql_missing_config")
        return ctx.fail(step, "Chưa cấu hình đủ bảng đích hoặc file nguồn")

    # Tên bảng bị ghép thẳng vào "TRUNCATE TABLE [...]" trong script sinh ra, mà ô
    # này ĐI QUA nội suy {{var}} → giá trị có thể đến từ tin nhắn Telegram / Google
    # Sheet của người khác. Dấu ] đóng ngoặc sớm nên `x]; DROP TABLE don_hang; --` là
    # xoá bảng thật. Chỉ nhận định danh SQL thường (cho phép schema dạng dbo.ten_bang).
    if not eb._VALID_TABLE_NAME.match(table_name):
        ctx.log(bid, "error", "excel_to_sql_invalid_table_name", table_name=repr(table_name))
        return ctx.fail(step, f"Tên bảng đích không hợp lệ: {table_name!r}")
    if not db_config:
        ctx.log(bid, "error", "block_missing_db_connection", label=label)
        return ctx.fail(step, "Chưa chọn Kết nối Database cho khối Excel to SQL")

    conn_str = eb.build_conn_str(db_config)
    ensure_block_packages(ctx, step, db_config.get("db_type"))
    ctx.log(bid, "info", "excel_to_sql_running", label=label)

    code = script_code("excel_to_sql", {
        "conn_str": conn_str, "input_file": input_file, "table_name": table_name,
        "import_mode": import_mode, "mapping": mapping,
        "header_row_str": header_row_str, "header_row_val": header_row_val,
    })
    result = run_script(ctx, step, code)
    return finish_script(ctx, step, result,
                         fail_log=f"❌ Import thất bại sau {ctx.elapsed_ms()}ms")


def _sql_exec_timeout(raw_timeout):
    """Thủ tục nặng có thể chạy vài tiếng → cho phép cấu hình.

    0 = chờ tới khi SQL trả kết quả (không giới hạn). Không set / rác = 7200s.
    """
    if raw_timeout in (None, ""):
        return 7200
    try:
        return max(0, int(float(raw_timeout)))
    except (TypeError, ValueError):
        return 7200


def handle_run_sql_exec(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    sql_command = bdata.get("sqlCommand", "").strip()
    db_config = eb.get_saved_db_connection(bdata.get("sqlExecSavedConnectionId", "").strip())

    if not sql_command:
        ctx.log(bid, "warning", "sql_exec_missing_query", label=label)
        step.continue_branch = False
        return None
    if not db_config:
        ctx.log(bid, "error", "block_missing_db_connection", label=label)
        return ctx.fail(step, "Chưa chọn Kết nối Database cho khối Chạy Hàm SQL (EXEC)")

    conn_str = eb.build_conn_str(db_config)
    ensure_block_packages(ctx, step, db_config.get("db_type"))
    sql_timeout = _sql_exec_timeout(bdata.get("sqlExecTimeout"))

    ctx.log(bid, "info", "sql_exec_running", label=label)
    if sql_timeout == 0:
        ctx.log(bid, "info", "sql_exec_no_timeout")
    else:
        ctx.log(bid, "info", "sql_exec_timeout_limit", timeout=sql_timeout)

    code = script_code("run_sql_exec", {"conn_str": conn_str, "sql_command": sql_command})
    # sql_timeout do người dùng đặt (0 = không giới hạn). Trước đây truyền cứng 7200
    # nên ô cấu hình vô nghĩa: log "Không giới hạn" rồi vẫn kill thủ tục ở phút 120.
    result = run_script(ctx, step, code, timeout=sql_timeout)
    # duration = thời gian của CHÍNH khối này (không phải cả workflow).
    return finish_script(ctx, step, result,
                         fail_log=f"❌ Thực thi SQL thất bại sau {result[3]}ms")


HANDLERS = {
    "sql_to_excel": handle_sql_to_excel,
    "excel_to_sql": handle_excel_to_sql,
    "run_sql_exec": handle_run_sql_exec,
}
