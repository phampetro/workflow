"""Khối Ghép file Excel. Chạy trong venv của project (không phải venv backend).

Biến có sẵn khi chạy (RUNNER_TEMPLATE + common.script_code tiêm vào):
PARAMS (dict cấu hình), INPUT_DIR, OUTPUT_DIR. Script phải gán ``output_data``.
"""
import os
import warnings

import openpyxl
import pandas as pd

# Tắt cảnh báo openpyxl "Workbook contains no default style" (vô hại, chỉ gây nhiễu log)
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

header_rows = PARAMS["header_rows"]
merge_mode = PARAMS["merge_mode"]

if merge_mode in ("all_input", "all_output"):
    # Tự quét toàn bộ file .xlsx/.csv trong INPUT_DIR (hoặc OUTPUT_DIR)
    scan_dir, where = (OUTPUT_DIR, "Output") if merge_mode == "all_output" else (INPUT_DIR, "Input")
    file_list = sorted([f for f in os.listdir(scan_dir) if f.endswith('.xlsx') or f.endswith('.csv')])
    print(f"Tự động phát hiện {len(file_list)} file trong thư mục {where}.")
else:
    file_list = PARAMS["selected_files"]
    print(f"Đang ghép {len(file_list)} file đã chọn.")

if not file_list:
    raise ValueError("Không tìm thấy file .xlsx nào trong Dữ liệu Workflow (INPUT_DIR)")

print(f"Bắt đầu ghép. Giữ nguyên {header_rows} dòng tiêu đề từ file đầu tiên...")

file1_path = os.path.join(INPUT_DIR, file_list[0])
if not os.path.exists(file1_path):
    file1_path = os.path.join(OUTPUT_DIR, file_list[0])

if not os.path.exists(file1_path):
    raise FileNotFoundError(f"Không tìm thấy file Gốc: {file_list[0]}")

# 1. Dùng openpyxl mở File 1 để giữ trọn vẹn Format tiêu đề
print(f"Đang xử lý định dạng tiêu đề từ File 1: {file_list[0]}")
wb = openpyxl.load_workbook(file1_path)
ws = wb.active

# Xóa toàn bộ dữ liệu bên dưới dòng tiêu đề (Để lấy format chuẩn cho phần data sau này)
if ws.max_row > header_rows:
    ws.delete_rows(header_rows + 1, ws.max_row)

# 2. Dùng pandas đọc phần Data của TẤT CẢ các file (Bao gồm cả file 1)
dfs = []
for filename in file_list:
    file_path = os.path.join(INPUT_DIR, filename)
    if not os.path.exists(file_path):
        file_path = os.path.join(OUTPUT_DIR, filename)

    print(f"   + Đang đọc dữ liệu: {filename}")

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Không tìm thấy file: {filename}")

    # Bỏ qua header_rows, chỉ lấy Data thô
    df = pd.read_excel(file_path, header=None, skiprows=header_rows)
    dfs.append(df)

print("Đang gộp và đắp dữ liệu vào bảng...")
merged_df = pd.concat(dfs, ignore_index=True)

# 3. Ghi dữ liệu vào Workbook đã có sẵn tiêu đề đẹp
# Chuyển DataFrame thành list các dòng để append vào openpyxl siêu nhanh
for row in merged_df.itertuples(index=False, name=None):
    ws.append(row)

out_file = PARAMS["excel_filename"]
out_path = os.path.join(OUTPUT_DIR, out_file)

print(f"Đang lưu file kết quả (Gồm {header_rows} dòng tiêu đề + {len(merged_df)} dòng dữ liệu) vào {out_path}...")
try:
    wb.save(out_path)
except PermissionError:
    raise PermissionError(f"Không thể lưu đè file {out_file} do file này đang được mở trong Excel. Vui lòng đóng file Excel và chạy lại.")
output_data = {"file_name": out_file}
