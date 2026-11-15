"""Khối Pivot Excel. Chạy trong venv của project (không phải venv backend).

Biến có sẵn khi chạy (RUNNER_TEMPLATE + common.script_code tiêm vào):
PARAMS (dict cấu hình), INPUT_DIR, OUTPUT_DIR. Script phải gán ``output_data``.
"""
import os
import warnings

import pandas as pd

# Tắt cảnh báo openpyxl "Workbook contains no default style" (vô hại, chỉ gây nhiễu log)
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

file_list = PARAMS["selected_files"]
header_row = PARAMS["header_row"]
sort_order = PARAMS["sort_order"]
agg = PARAMS["agg"]

print(f"Đang tìm kiếm {len(file_list)} file Excel trong thư mục: {INPUT_DIR}...")

if not file_list:
    raise ValueError("Không tìm thấy file nào để xử lý.")

dfs = []
for filename in file_list:
    file_path = os.path.join(INPUT_DIR, filename)
    if not os.path.exists(file_path):
        file_path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Không tìm thấy file: {filename}")

    print(f"Đang đọc dữ liệu: {filename} (header dòng {header_row})")
    pd_header_idx = max(0, header_row - 1)
    if filename.endswith(".csv"):
        df = pd.read_csv(file_path, header=pd_header_idx)
    else:
        df = pd.read_excel(file_path, header=pd_header_idx)
    dfs.append(df)

df = pd.concat(dfs, ignore_index=True)


def col2num(col_str):
    num = 0
    for c in str(col_str).upper():
        if 'A' <= c <= 'Z':
            num = num * 26 + (ord(c) - ord('A') + 1)
        else:
            return -1
    return num - 1


# Lọc và dọn dẹp biến đầu vào
def parse_cols(col_data):
    if not col_data:
        return []
    if isinstance(col_data, str):
        cols = [c.strip() for c in col_data.split(',')]
    elif isinstance(col_data, list):
        cols = [str(c).strip() for c in col_data]
    else:
        return []

    parsed = []
    for c in cols:
        if not c:
            continue
        if c in df.columns:
            parsed.append(c)
        else:
            idx = col2num(c)
            if 0 <= idx < len(df.columns):
                parsed.append(df.columns[idx])
            else:
                print(f"Cảnh báo: Không tìm thấy cột '{c}'")
    return parsed


idx_cols = parse_cols(PARAMS["index"])
col_cols = parse_cols(PARAMS["columns"])
val_cols = parse_cols(PARAMS["values"])

if not val_cols:
    print("Cảnh báo: Không có cột Giá trị (Values) nào hợp lệ. Sẽ dùng toàn bộ cột số.")
    val_cols = df.select_dtypes(include='number').columns.tolist()
if not idx_cols and not col_cols:
    raise ValueError("Phải nhập ít nhất 1 trường Dòng (Rows) hoặc Cột (Columns).")

sort_col_parsed = parse_cols(PARAMS["sort_column"])
sort_col = sort_col_parsed[0] if sort_col_parsed else None

if PARAMS["enable_sort"] and sort_col and sort_col in df.columns:
    print(f"Đang phân loại và sắp xếp cột '{sort_col}' theo chiều: {sort_order}")
    if sort_order == 'custom':
        custom_order = list(PARAMS["sort_custom"])
        # Xử lý Pandas4Warning: bổ sung các giá trị còn thiếu vào cuối danh sách categories
        unique_vals = df[sort_col].dropna().unique().tolist()
        # Ép kiểu custom_order về cùng kiểu với dữ liệu để so sánh chính xác nếu cần
        try:
            custom_order = pd.Series(custom_order).astype(df[sort_col].dtype).tolist()
        except Exception:
            pass
        missing_cats = [x for x in unique_vals if x not in custom_order]
        custom_order.extend(missing_cats)
        df[sort_col] = pd.Categorical(df[sort_col], categories=custom_order, ordered=True)
    elif sort_order == 'asc':
        cats = sorted(df[sort_col].dropna().unique().tolist(), key=str)
        df[sort_col] = pd.Categorical(df[sort_col], categories=cats, ordered=True)
    elif sort_order == 'desc':
        cats = sorted(df[sort_col].dropna().unique().tolist(), key=str, reverse=True)
        df[sort_col] = pd.Categorical(df[sort_col], categories=cats, ordered=True)

print(f"Đang Pivot với Dòng={idx_cols}, Cột={col_cols}, Giá trị={val_cols}, Hàm={agg!r}")

pivot_df = pd.pivot_table(
    df,
    values=val_cols,
    index=idx_cols if idx_cols else None,
    columns=col_cols if col_cols else None,
    aggfunc=agg,
    margins=PARAMS["grand_total"],
    margins_name="Tổng Cộng"
)

if PARAMS["fillna"]:
    pivot_df = pivot_df.fillna(0)

# Làm phẳng cột đa cấp (nếu có)
if isinstance(pivot_df.columns, pd.MultiIndex):
    new_cols = []
    for col in pivot_df.columns.values:
        valid_parts = [str(c) for c in col if str(c) != '']
        if not valid_parts:
            new_cols.append('')
        elif len(valid_parts) > 1 and valid_parts[0] in val_cols:
            new_cols.append('_'.join(valid_parts[1:]))
        else:
            new_cols.append('_'.join(valid_parts))
    pivot_df.columns = new_cols

out_file = PARAMS["excel_filename"]
out_path = os.path.join(OUTPUT_DIR, out_file)

# Reset index để lưu ra file excel đẹp hơn
pivot_df.reset_index(inplace=True)

print(f"Đang lưu file Pivot kết quả vào {out_path}...")
try:
    pivot_df.to_excel(out_path, index=False)
except PermissionError:
    raise PermissionError(f"Không thể lưu đè file {out_file} do file này đang được mở trong Excel.")

output_data = {"file_name": out_file}
