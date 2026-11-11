"""Kiểm tra môi trường máy: những thứ NGOÀI app mà workflow cần để chạy được.

Mỗi lỗi ở đây trước đây chỉ lộ ra GIỮA lúc chạy workflow, dưới dạng traceback dài:
- Python hệ thống mất (đổi user Windows, gỡ Python) → venv project hỏng, mọi lệnh
  pip báo "did not find executable".
- Thiếu ODBC Driver 17 → khối SQL báo IM002 "Data source name not found".
- Thiếu Chromium riêng của Playwright → khối Trình duyệt tụt về Chrome hệ thống
  (bị group policy chặn) hoặc không chạy được.

Kết quả trả ``code`` + ``status`` + ``params`` — FE tự dịch qua i18n (CLAUDE.md:
backend không trả chuỗi ngôn ngữ cứng để hiển thị).
"""
import logging
import subprocess
import sys

from database import connect_sqlite
from services import venv_manager

logger = logging.getLogger("pyflow.env_check")

ODBC_DRIVER_REQUIRED = "ODBC Driver 17 for SQL Server"   # khớp build_conn_str()
OK, WARN, ERROR = "ok", "warn", "error"


def _item(code, status, **params):
    return {"code": code, "status": status, "params": params}


def check_python():
    try:
        exe = venv_manager.get_system_python()
    except RuntimeError:
        return _item("python", ERROR)
    try:
        out = subprocess.run([exe, "-c", "import sys; print(sys.version.split()[0])"],
                             capture_output=True, text=True, timeout=15)
    except Exception as e:
        logger.warning("Không chạy được Python hệ thống %s: %s", exe, e)
        return _item("python", ERROR, path=exe)
    if out.returncode != 0:
        return _item("python", ERROR, path=exe)
    return _item("python", OK, version=out.stdout.strip(), path=exe)


def _installed_odbc_drivers():
    if sys.platform != "win32":
        return []
    import winreg
    names = []
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers") as key:
            i = 0
            while True:
                try:
                    name, _value, _type = winreg.EnumValue(key, i)
                except OSError:
                    break
                names.append(name)
                i += 1
    except OSError as e:
        logger.warning("Không đọc được danh sách ODBC driver: %s", e)
    return names


def _sqlserver_connection_count():
    try:
        with connect_sqlite() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM db_connection WHERE COALESCE(db_type, '') IN ('', 'sqlserver')"
            ).fetchone()
        return int(row[0]) if row else 0
    except Exception as e:
        logger.warning("Không đếm được kết nối SQL Server: %s", e)
        return 0


def check_odbc():
    drivers = _installed_odbc_drivers()
    needed = _sqlserver_connection_count()
    if ODBC_DRIVER_REQUIRED in drivers:
        return _item("odbc", OK, driver=ODBC_DRIVER_REQUIRED, connections=needed)
    others = [d for d in drivers if "SQL Server" in d]
    # Chưa có kết nối SQL Server nào thì thiếu driver chưa làm hỏng gì — chỉ cảnh báo.
    return _item("odbc", ERROR if needed else WARN, driver=ODBC_DRIVER_REQUIRED,
                 connections=needed, found=", ".join(others))


def check_chromium():
    from services.browser_executor import _find_system_browser, find_installed_chromium
    bundled = find_installed_chromium()
    if bundled:
        return _item("chromium", OK, path=bundled)
    system = _find_system_browser()
    if system:
        return _item("chromium", WARN, path=system)
    return _item("chromium", ERROR)


def check_project_venvs():
    try:
        with connect_sqlite() as conn:
            projects = conn.execute("SELECT id, name FROM project ORDER BY name").fetchall()
    except Exception as e:
        logger.warning("Không đọc được danh sách project: %s", e)
        return _item("venvs", WARN, total=0, broken="")
    broken = [name for pid, name in projects if venv_manager.venv_is_stale(pid)]
    return _item("venvs", ERROR if broken else OK, total=len(projects), broken=", ".join(broken))


CHECKS = (
    ("python", check_python),
    ("odbc", check_odbc),
    ("chromium", check_chromium),
    ("venvs", check_project_venvs),
)


def run_all():
    items = []
    for code, check in CHECKS:
        try:
            items.append(check())
        except Exception as e:
            # Một mục lỗi không được làm hỏng cả bảng kiểm tra.
            logger.exception("Kiểm tra môi trường %s lỗi", code)
            items.append(_item(code, ERROR, detail=str(e)))
    return {"items": items}
