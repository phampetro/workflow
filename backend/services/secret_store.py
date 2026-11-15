"""Mã hoá secret lưu trong pyflow.db bằng Windows DPAPI, phạm vi THEO MÁY.

Áp dụng cho `DbConnection.password` và `CloudConnection.refresh_token`. Trước đây
lưu chữ thường: ai lấy được file pyflow.db (backup, chép nhầm, lỗ hổng tải file)
là có luôn mật khẩu SQL Server production và quyền ghi vào Drive/OneDrive.

Vì sao DPAPI phạm vi máy (CRYPTPROTECT_LOCAL_MACHINE), không theo user Windows:
máy dev từng bị đổi user Windows (SID cũ không còn) — nếu khoá theo user thì mọi
mật khẩu mất sạch. Đánh đổi chấp nhận được: user khác TRÊN CÙNG MÁY giải mã được,
nhưng chép pyflow.db sang máy khác thì không. Chuyển máy → dùng file export (vẫn
kèm mật khẩu chữ thường theo quyết định của chủ dự án) hoặc nhập lại.

Định dạng lưu: "dpapi:" + base64. Giá trị không có tiền tố được coi là chữ thường
cũ và trả nguyên văn — nhờ vậy DB chưa chuyển đổi, file export và test vẫn chạy;
`migrate_plaintext_secrets()` lúc khởi động sẽ mã hoá dần các giá trị đó.
"""
import base64
import ctypes
import logging
from ctypes import wintypes

logger = logging.getLogger("pyflow.secret_store")

PREFIX = "dpapi:"
# Entropy riêng của ứng dụng: chương trình khác trên cùng máy gọi DPAPI không có
# chuỗi này thì không giải mã được blob của PyFlow. Đổi chuỗi này = mọi secret đã
# lưu không đọc được nữa.
_ENTROPY = b"pyflow-secret-v1"

_CRYPTPROTECT_UI_FORBIDDEN = 0x01
_CRYPTPROTECT_LOCAL_MACHINE = 0x04


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> _Blob:
    buf = ctypes.create_string_buffer(data, len(data))
    return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))


def _take(blob: _Blob) -> bytes:
    try:
        return ctypes.string_at(blob.pbData, blob.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob.pbData)


def _protect(data: bytes) -> bytes:
    out = _Blob()
    ok = ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(_blob(data)), None, ctypes.byref(_blob(_ENTROPY)), None, None,
        _CRYPTPROTECT_UI_FORBIDDEN | _CRYPTPROTECT_LOCAL_MACHINE, ctypes.byref(out))
    if not ok:
        raise OSError(ctypes.GetLastError(), "CryptProtectData thất bại")
    return _take(out)


def _unprotect(data: bytes) -> bytes:
    out = _Blob()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(_blob(data)), None, ctypes.byref(_blob(_ENTROPY)), None, None,
        _CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(out))
    if not ok:
        raise OSError(ctypes.GetLastError(), "CryptUnprotectData thất bại")
    return _take(out)


def is_encrypted(value) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt(value):
    """Chữ thường → "dpapi:...". Rỗng/None giữ nguyên; đã mã hoá thì không mã hoá lại."""
    if not value or is_encrypted(value):
        return value
    return PREFIX + base64.b64encode(_protect(value.encode("utf-8"))).decode("ascii")


def decrypt(value):
    """"dpapi:..." → chữ thường. Giá trị cũ không tiền tố trả nguyên văn.

    Giải mã thất bại (DB chép từ máy khác) → trả "" và ghi log: coi như chưa có mật
    khẩu, người dùng nhập lại — tốt hơn để lỗi văng giữa lúc chạy workflow.
    """
    if not is_encrypted(value):
        return value
    try:
        return _unprotect(base64.b64decode(value[len(PREFIX):])).decode("utf-8")
    except Exception as e:
        logger.warning("Không giải mã được secret (DB chép từ máy khác?): %s", e)
        return ""


# (bảng, cột) chứa secret — nguồn duy nhất cho migrate và cho test.
SECRET_COLUMNS = (("db_connection", "password"), ("cloud_connection", "refresh_token"))


def migrate_plaintext_secrets(conn) -> int:
    """Mã hoá mọi giá trị còn chữ thường. Chạy lúc khởi động, gọi lại nhiều lần vẫn an toàn."""
    # Nhận cả sqlite3.Connection lẫn Connection của SQLAlchemy (init_db/run_sync):
    # exec_driver_sql dùng đúng paramstyle "?" của sqlite3.
    run = conn.exec_driver_sql if hasattr(conn, "exec_driver_sql") else conn.execute
    changed = 0
    for table, col in SECRET_COLUMNS:
        try:
            rows = run(
                f"SELECT id, {col} FROM {table} WHERE {col} IS NOT NULL AND {col} != '' "
                f"AND {col} NOT LIKE ?", (PREFIX + "%",)).fetchall()
        except Exception as e:      # bảng chưa tồn tại (DB rất cũ) → bỏ qua
            logger.debug("Bỏ qua %s.%s: %s", table, col, e)
            continue
        for row_id, val in rows:
            run(f"UPDATE {table} SET {col}=? WHERE id=?", (encrypt(val), row_id))
            changed += 1
    if changed:
        logger.info("Đã mã hoá %d secret còn lưu chữ thường trong DB", changed)
    return changed
