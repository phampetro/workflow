"""Khối Excel → SQL. Chạy trong venv của project (không phải venv backend).

Biến có sẵn khi chạy (RUNNER_TEMPLATE + common.script_code tiêm vào):
PARAMS (dict cấu hình), INPUT_DIR, OUTPUT_DIR. Script phải gán ``output_data``.
``table_name`` đã được handler kiểm bằng _VALID_TABLE_NAME trước khi tới đây.
"""
import os
import warnings

import pandas as pd
from sqlalchemy import create_engine, inspect, text
import sqlalchemy

# pandas chỉ nhận Engine khi SQLAlchemy >= bản tối thiểu của chính nó; thấp hơn thì nó
# âm thầm coi Engine là kết nối DBAPI → "'Engine' object has no attribute 'cursor'"
# (gặp thật). Kiểm trước để báo lỗi dễ hiểu. Xem pkg_scanner.SQLALCHEMY.
try:
    from pandas.compat._optional import VERSIONS as _PD_MIN
except ImportError:          # pandas đổi cấu trúc nội bộ → bỏ qua kiểm tra, không chặn chạy
    _PD_MIN = {}
_need = _PD_MIN.get("sqlalchemy")
_have = sqlalchemy.__version__


def _ver(s):
    return tuple(int(x) for x in str(s).split(".")[:3] if x.isdigit())


if _need and _ver(_have) < _ver(_need):
    raise RuntimeError(f"pandas {pd.__version__} cần SQLAlchemy >= {_need} nhưng venv của project đang có "
                       f"{_have}. Mở project → 'Tự động cài thư viện' để cài lại cho khớp.")

# Suppress openpyxl style warnings (file không có default style vẫn đọc được)
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

input_file = PARAMS["input_file"]
header_row_str = PARAMS["header_row_str"]
header_row_val = PARAMS["header_row_val"]

file_path = os.path.join(INPUT_DIR, input_file)
if not os.path.exists(file_path):
    file_path = os.path.join(OUTPUT_DIR, input_file)

if not os.path.exists(file_path):
    raise FileNotFoundError(f"Không tìm thấy file Excel: {input_file}")

print(f"Đang đọc file Excel (dòng tiêu đề = {header_row_str} theo Excel, pandas header={header_row_val})...")
if file_path.endswith(".csv"):
    df = pd.read_csv(file_path, header=header_row_val)
else:
    df = pd.read_excel(file_path, header=header_row_val)

if isinstance(df.columns, pd.MultiIndex):
    flat_cols = []
    for col in df.columns:
        clean_levels = [str(c).strip() for c in col if not str(c).startswith('Unnamed:')]
        flat_cols.append('_'.join(clean_levels) if clean_levels else 'Unnamed')
    df.columns = flat_cols

engine = create_engine(PARAMS["conn_str"], fast_executemany=True)

mapping = PARAMS["mapping"]
print(f"File Excel có {len(df)} dòng dữ liệu, {len(df.columns)} cột.")
print(f"10 cột đầu của Excel: {list(df.columns[:10])}")

if mapping:
    print(f"Đang chuẩn hóa dữ liệu theo Mapping: {len(mapping)} cột SQL...")
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
            unmatched.append(f"'{excel_col}' -> '{sql_col}'")
        else:
            # Cột để trống: KHÔNG đưa vào INSERT. Trước đây gán None nên INSERT ghi NULL
            # tường minh → cột IDENTITY báo lỗi 544 ("Cannot insert explicit value for
            # identity column") và DEFAULT của SQL (VD CreatedAt = getdate()) bị NULL đè mất.
            # Bỏ khỏi INSERT thì SQL tự dùng IDENTITY/DEFAULT, không có thì vẫn là NULL.
            skipped.append(sql_col)
    print(f"Đã khớp {matched_count}/{len(mapping)} cột. Tổng dòng cần import: {len(sql_df)}")
    if skipped:
        print(f"Bỏ trống {len(skipped)} cột (không đưa vào INSERT, SQL tự dùng IDENTITY/DEFAULT hoặc NULL): {skipped}")
    if unmatched:
        print(f"⚠ {len(unmatched)} cột Excel không khớp (sẽ để NULL): {unmatched[:5]}")
    if sql_df.shape[1] == 0:
        raise ValueError("Chưa ánh xạ cột nào từ Excel sang SQL")
else:
    print("Không có Mapping cụ thể, đẩy toàn bộ dữ liệu Excel hiện có...")
    sql_df = df.copy()

table_name = PARAMS["table_name"]
import_mode = PARAMS["import_mode"]

insp = inspect(engine)
try:
    columns = insp.get_columns(table_name)
    date_cols = [c['name'] for c in columns if 'DATE' in str(c['type']).upper() or 'TIME' in str(c['type']).upper()]

    if date_cols:
        print(f"Phát hiện {len(date_cols)} cột thời gian trong SQL. Đang ép kiểu nghiêm ngặt (dayfirst=True)...")
        for sql_col in date_cols:
            if sql_col in sql_df.columns:
                # errors='raise' để báo lỗi dừng khối ngay lập tức nếu format rác/sai
                sql_df[sql_col] = pd.to_datetime(sql_df[sql_col], dayfirst=True, errors='raise')
except Exception as e:
    raise ValueError(f"Lỗi dữ liệu ngày tháng không hợp lệ (sai định dạng hoặc chứa chữ rác): {str(e)}")

# Chuẩn hoá NaN -> None (cho cả các ô trống do pd.to_datetime tạo ra nếu có NaT)
sql_df = sql_df.where(pd.notnull(sql_df), None)

with engine.begin() as connection:
    if import_mode == 'truncate':
        print(f"Đang xoá trắng dữ liệu cũ trong bảng {table_name}...")
        connection.execute(text(f"TRUNCATE TABLE [{table_name}]"))

print(f"Đang Bulk Insert {len(sql_df)} dòng vào bảng {table_name}...")
sql_df.to_sql(name=table_name, con=engine, if_exists='append', index=False, chunksize=5000)

print(f"✅ Đã Import thành công {len(sql_df)} dòng.")
output_data = {"rows_inserted": len(sql_df), "table": table_name}
