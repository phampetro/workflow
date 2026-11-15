"""Khối Chạy hàm SQL (EXEC). Chạy trong venv của project (không phải venv backend).

Biến có sẵn khi chạy (RUNNER_TEMPLATE + common.script_code tiêm vào):
PARAMS (dict cấu hình), INPUT_DIR, OUTPUT_DIR. Script phải gán ``output_data``.
"""
from sqlalchemy import create_engine

engine = create_engine(PARAMS["conn_str"])

sql_command = PARAMS["sql_command"]
print(f"Đang thực thi: {sql_command}")

# PHẢI đọc HẾT mọi kết quả trả về. Thủ tục không có SET NOCOUNT ON gửi về 1 "kết quả"
# (số dòng bị ảnh hưởng) cho MỖI câu lệnh bên trong. Trước đây chỉ đọc kết quả đầu
# rồi đóng kết nối → SQL Server HUỶ phần còn lại của thủ tục (VD INSERT chạy, UPDATE
# phía sau bị bỏ) mà vẫn báo "thành công", lỗi của câu phía sau cũng bị nuốt mất.
# Dùng cursor gốc của driver (không qua text()) nên dấu ":" trong SQL không bị hiểu
# nhầm thành tham số.
rows = []
returns_rows = False
counts = []
with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
    cur = conn.connection.cursor()
    try:
        cur.execute(sql_command)
        while True:
            if cur.description:
                cols = [d[0] for d in cur.description]
                # Tập kết quả CUỐI CÙNG là kết quả của thủ tục (thường là câu SELECT cuối)
                rows = [dict(zip(cols, r, strict=False)) for r in cur.fetchall()]
                returns_rows = True
            elif cur.rowcount is not None and cur.rowcount >= 0:
                counts.append(cur.rowcount)
            try:
                more = cur.nextset()
            except Exception as e:
                # psycopg2 không hỗ trợ nextset (1 kết quả/lần execute) → coi như hết.
                # Lỗi THẬT của câu lệnh phía sau (pyodbc ném ở đây) thì phải ném tiếp.
                if type(e).__name__ in ("NotSupportedError", "AttributeError"):
                    break
                raise
            if not more:
                break
    finally:
        cur.close()

if counts:
    print("   Số dòng bị ảnh hưởng theo từng câu lệnh: " + ", ".join(str(c) for c in counts))
# Có tập kết quả: số dòng là len(rows) kể cả khi = 0 (rowcount của SELECT luôn = -1).
row_count = len(rows) if returns_rows else (sum(counts) if counts else -1)

if rows:
    print(f"✅ Thực thi thành công. {len(rows)} dòng kết quả trả về.")
    print("Preview kết quả (tối đa 5 dòng):")
    for r in rows[:5]:
        print(f"  {r}")
    if len(rows) > 5:
        print("  ...")
elif returns_rows:
    print("✅ Thực thi thành công. Không có dòng nào trả về (0 dòng).")
else:
    if row_count == -1:
        print("✅ Thực thi thành công (Hệ thống DB không trả về số dòng ảnh hưởng).")
    else:
        print(f"✅ Thực thi thành công. {row_count} dòng bị ảnh hưởng.")

output_data = {"result": rows, "row_count": row_count}
