"""Khối SQL → Excel. Chạy trong venv của project (không phải venv backend).

Biến có sẵn khi chạy (RUNNER_TEMPLATE + common.script_code tiêm vào):
PARAMS (dict cấu hình), INPUT_DIR, OUTPUT_DIR. Script phải gán ``output_data``.
"""
import os

import pandas as pd
import sqlalchemy

print("Đang kết nối CSDL và thực thi câu lệnh SQL...")
engine = sqlalchemy.create_engine(PARAMS["conn_str"])
# sql_query ĐÃ đi qua nội suy {{var}} nên có thể chứa nội dung người ngoài gửi
# ({{text}} của Telegram Listener). Giờ nó chỉ là dữ liệu trong PARAMS, không còn
# bị ghép vào mã nguồn như trước.
df = pd.read_sql(PARAMS["sql_query"], engine)

out_file = PARAMS["excel_filename"]
out_path = os.path.join(OUTPUT_DIR, out_file)

print(f"Đã tải {len(df)} dòng dữ liệu! Đang lưu vào {out_path}...")
df.to_excel(out_path, index=False)

output_data = {"file_name": out_file}
