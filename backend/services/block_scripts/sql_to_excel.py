"""Khối SQL → Excel. Chạy trong venv của project (không phải venv backend).

Biến có sẵn khi chạy (RUNNER_TEMPLATE + common.script_code tiêm vào):
PARAMS (dict cấu hình), INPUT_DIR, OUTPUT_DIR. Script phải gán ``output_data``.
"""
import os

import pandas as pd
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
