"""Khối SQL: SQL → Excel, Excel → SQL, Chạy hàm SQL (EXEC).

⚠ Mọi giá trị nhúng vào script sinh ra PHẢI qua ``!r``: các ô cấu hình đã đi qua
nội suy {{var}} nên có thể chứa nội dung do người ngoài gửi (``{{text}}`` của
Telegram Listener). Tên bảng phải qua ``_VALID_TABLE_NAME``, tên file qua
``safe_filename``. Xem CLAUDE.md §Bảo mật.
"""
from services import executor_blocks as eb

from .common import ensure_block_packages, finish_script, run_script


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

    code = f'''
import pandas as pd
import sqlalchemy
import os

conn_str = {conn_str!r}

print("Đang kết nối CSDL và thực thi câu lệnh SQL...")
engine = sqlalchemy.create_engine(conn_str)
# !r bắt buộc: sql_query ĐÃ đi qua interpolate_deep nên có thể chứa nội dung do
# người ngoài gửi ({{{{text}}}} của khối Telegram Listener). Trước đây nhúng thô vào
# giữa """...""" nên tin nhắn dạng  x""" ; import os; os.system(...) ; z="""
# thoát khỏi chuỗi và chạy như mã Python trong venv của project.
sql_query = {sql_query!r}
df = pd.read_sql(sql_query, engine)

out_file = {excel_filename!r}
out_path = os.path.join(OUTPUT_DIR, out_file)

print(f"Đã tải {{len(df)}} dòng dữ liệu! Đang lưu vào {{out_path}}...")
df.to_excel(out_path, index=False)

output_data = {{"file_name": out_file}}
'''
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

    code = f'''
import os
import warnings
import pandas as pd
from sqlalchemy import create_engine, text

# Suppress openpyxl style warnings (file không có default style vẫn đọc được)
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

input_file = {input_file!r}
file_path = os.path.join(INPUT_DIR, input_file)
if not os.path.exists(file_path):
    file_path = os.path.join(OUTPUT_DIR, input_file)

if not os.path.exists(file_path):
    raise FileNotFoundError(f"Không tìm thấy file Excel: {{input_file}}")

print(f"Đang đọc file Excel (dòng tiêu đề = {header_row_str} theo Excel, pandas header={header_row_val})...")
if file_path.endswith(".csv"):
    df = pd.read_csv(file_path, header={header_row_val})
else:
    df = pd.read_excel(file_path, header={header_row_val})

if isinstance(df.columns, pd.MultiIndex):
    flat_cols = []
    for col in df.columns:
        clean_levels = [str(c).strip() for c in col if not str(c).startswith('Unnamed:')]
        flat_cols.append('_'.join(clean_levels) if clean_levels else 'Unnamed')
    df.columns = flat_cols

conn_str = {conn_str!r}
engine = create_engine(conn_str, fast_executemany=True)

mapping = {mapping!r}
print(f"File Excel có {{len(df)}} dòng dữ liệu, {{len(df.columns)}} cột.")
print(f"10 cột đầu của Excel: {{list(df.columns[:10])}}")

if mapping:
    print(f"Đang chuẩn hóa dữ liệu theo Mapping: {{len(mapping)}} cột SQL...")
    # Khởi tạo với đúng số dòng từ df (tránh lỗi 0 dòng khi cột không khớp)
    sql_df = pd.DataFrame(index=range(len(df)))
    matched_count = 0
    unmatched = []
    skipped = []
    for sql_col, excel_col in mapping.items():
        if excel_col and excel_col in df.columns:
            sql_df[sql_col] = df[excel_col].values
            matched_count += 1
        elif excel_col:
            sql_df[sql_col] = None
            unmatched.append(f"'{{excel_col}}' -> '{{sql_col}}'")
        else:
            # Cột để trống: KHÔNG đưa vào INSERT. Trước đây gán None nên INSERT ghi NULL
            # tường minh → cột IDENTITY báo lỗi 544 ("Cannot insert explicit value for
            # identity column") và DEFAULT của SQL (VD CreatedAt = getdate()) bị NULL đè mất.
            # Bỏ khỏi INSERT thì SQL tự dùng IDENTITY/DEFAULT, không có thì vẫn là NULL.
            skipped.append(sql_col)
    print(f"Đã khớp {{matched_count}}/{{len(mapping)}} cột. Tổng dòng cần import: {{len(sql_df)}}")
    if skipped:
        print(f"Bỏ trống {{len(skipped)}} cột (không đưa vào INSERT, SQL tự dùng IDENTITY/DEFAULT hoặc NULL): {{skipped}}")
    if unmatched:
        print(f"⚠ {{len(unmatched)}} cột Excel không khớp (sẽ để NULL): {{unmatched[:5]}}")
    if sql_df.shape[1] == 0:
        raise ValueError("Chưa ánh xạ cột nào từ Excel sang SQL")
else:
    print("Không có Mapping cụ thể, đẩy toàn bộ dữ liệu Excel hiện có...")
    sql_df = df.copy()

table_name = {table_name!r}
import_mode = {import_mode!r}

from sqlalchemy import inspect
insp = inspect(engine)
try:
    columns = insp.get_columns(table_name)
    date_cols = [c['name'] for c in columns if 'DATE' in str(c['type']).upper() or 'TIME' in str(c['type']).upper()]

    if date_cols:
        print(f"Phát hiện {{len(date_cols)}} cột thời gian trong SQL. Đang ép kiểu nghiêm ngặt (dayfirst=True)...")
        for sql_col in date_cols:
            if sql_col in sql_df.columns:
                # errors='raise' để báo lỗi dừng khối ngay lập tức nếu format rác/sai
                sql_df[sql_col] = pd.to_datetime(sql_df[sql_col], dayfirst=True, errors='raise')
except Exception as e:
    raise ValueError(f"Lỗi dữ liệu ngày tháng không hợp lệ (sai định dạng hoặc chứa chữ rác): {{str(e)}}")

# Chuẩn hoá NaN -> None (cho cả các ô trống do pd.to_datetime tạo ra nếu có NaT)
sql_df = sql_df.where(pd.notnull(sql_df), None)

with engine.begin() as connection:
    if import_mode == 'truncate':
        print(f"Đang xoá trắng dữ liệu cũ trong bảng {{table_name}}...")
        connection.execute(text(f"TRUNCATE TABLE [{{table_name}}]"))

print(f"Đang Bulk Insert {{len(sql_df)}} dòng vào bảng {{table_name}}...")
sql_df.to_sql(name=table_name, con=engine, if_exists='append', index=False, chunksize=5000)

print(f"✅ Đã Import thành công {{len(sql_df)}} dòng.")
output_data = {{"rows_inserted": len(sql_df), "table": table_name}}
'''
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

    code = f'''
from sqlalchemy import create_engine, text

conn_str = {conn_str!r}
engine = create_engine(conn_str)

sql_command = {sql_command!r}
print(f"Đang thực thi: {{sql_command}}")

with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
    result = conn.execute(text(sql_command))
    returns_rows = result.returns_rows
    if returns_rows:
        rows = [dict(r._mapping) for r in result.fetchall()]
        # Câu SELECT/EXEC có trả tập kết quả: số dòng là len(rows) kể cả khi = 0.
        # (rowcount của SELECT luôn = -1 nên không dùng được cho trường hợp rỗng)
        row_count = len(rows)
    else:
        rows = []
        row_count = result.rowcount

if rows:
    print(f"✅ Thực thi thành công. {{len(rows)}} dòng kết quả trả về.")
    print("Preview kết quả (tối đa 5 dòng):")
    for r in rows[:5]:
        print(f"  {{r}}")
    if len(rows) > 5:
        print("  ...")
elif returns_rows:
    print("✅ Thực thi thành công. Không có dòng nào trả về (0 dòng).")
else:
    if row_count == -1:
        print(f"✅ Thực thi thành công (Hệ thống DB không trả về số dòng ảnh hưởng).")
    else:
        print(f"✅ Thực thi thành công. {{row_count}} dòng bị ảnh hưởng.")

output_data = {{"result": rows, "row_count": row_count}}
'''
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
