"""
Quét package cần cài cho một project: đọc mọi workflow → mọi khối → suy ra thư viện.

- Khối SQL/Excel chạy trong project venv: package cố định (khớp ensure_packages) +
  driver DB theo db_type của kết nối khối chọn.
- Khối python: parse `code` bằng ast lấy import top-level, lọc thư viện chuẩn (stdlib),
  ánh xạ tên module → tên pip. Đây là BEST-EFFORT (hiện cho người dùng sửa trước khi cài).

Các khối khác (browser/telegram/excel_read...) chạy trong backend venv → không tính.
"""
import ast
import json
import re
import subprocess
import sys

from services.executor_blocks import get_saved_db_connection

# Package cố định cho từng khối chạy trong project venv (khớp ensure_packages)
_BLOCK_BASE = {
    "sql_to_excel": ["pandas", "sqlalchemy", "openpyxl"],
    "excel_to_sql": ["pandas", "openpyxl", "sqlalchemy", "xlrd"],
    "merge_excel": ["pandas", "openpyxl", "xlrd"],
    "pivot_excel": ["pandas", "openpyxl", "xlrd"],
    "run_sql_exec": ["sqlalchemy"],
}
# Khối nào cần driver DB → key chứa id kết nối trong data
_DRIVER_BLOCKS = {
    "sql_to_excel": "sqlToExcelSavedConnectionId",
    "excel_to_sql": "excelToSqlSavedConnectionId",
    "run_sql_exec": "sqlExecSavedConnectionId",
}
# db_type → package driver
_DB_DRIVERS = {
    "postgresql": ["psycopg2-binary"],
    "mysql": ["pymysql", "cryptography"],
    # mặc định (sqlserver) → pyodbc
}

# Ánh xạ tên module import → tên pip (những cái khác nhau phổ biến)
_MODULE_ALIAS = {
    "cv2": "opencv-python", "sklearn": "scikit-learn", "bs4": "beautifulsoup4",
    "PIL": "Pillow", "yaml": "PyYAML", "dotenv": "python-dotenv",
    "dateutil": "python-dateutil", "docx": "python-docx", "pptx": "python-pptx",
    "fitz": "PyMuPDF", "Crypto": "pycryptodome", "serial": "pyserial",
    "win32com": "pywin32", "win32api": "pywin32", "pythoncom": "pywin32", "win32gui": "pywin32",
    "google": "google-api-python-client", "OpenSSL": "pyOpenSSL", "psycopg2": "psycopg2-binary",
    # Tên module ≠ tên gói pip — thiếu ở đây là "Tự động cài" cài NHẦM gói trùng tên
    # module trên PyPI (VD `jwt` là một gói khác hẳn PyJWT).
    "jwt": "PyJWT", "MySQLdb": "mysqlclient", "mysql": "mysql-connector-python",
    "telegram": "python-telegram-bot", "attr": "attrs", "magic": "python-magic",
    "ldap": "python-ldap", "jose": "python-jose", "slugify": "python-slugify",
    "multipart": "python-multipart", "socks": "PySocks", "usb": "pyusb", "kafka": "kafka-python",
    "smb": "pysmb", "skimage": "scikit-image", "Bio": "biopython", "tabula": "tabula-py",
    "camelot": "camelot-py", "googleapiclient": "google-api-python-client",
    "google_auth_oauthlib": "google-auth-oauthlib", "win32con": "pywin32",
    "win32clipboard": "pywin32", "win32print": "pywin32", "pywintypes": "pywin32",
    "Levenshtein": "levenshtein", "zmq": "pyzmq", "dns": "dnspython", "speech_recognition": "SpeechRecognition",
}

# Thư viện chuẩn (stdlib) — không cần cài
try:
    _STDLIB = set(sys.stdlib_module_names)  # Python 3.10+
except AttributeError:  # fallback cho 3.8/3.9
    _STDLIB = {
        "os", "sys", "json", "re", "math", "time", "datetime", "random", "csv", "io",
        "collections", "itertools", "functools", "subprocess", "threading", "pathlib",
        "typing", "logging", "urllib", "http", "socket", "struct", "hashlib", "base64",
        "uuid", "decimal", "statistics", "sqlite3", "shutil", "glob", "tempfile", "zipfile",
        "traceback", "argparse", "string", "textwrap", "unicodedata", "warnings", "copy",
        "pickle", "asyncio", "concurrent", "queue", "enum", "abc", "contextlib", "operator",
        "smtplib", "email", "ssl", "ftplib", "xml", "html", "gzip", "tarfile", "platform",
    }


def required_packages(block_type: str, db_type: str | None = None) -> list:
    """Package một khối cần trong venv project — NGUỒN DUY NHẤT cho cả lúc chạy thật
    (``ensure_packages`` trong block_handlers) lẫn lúc quét "Tự động cài thư viện".

    Trước đây hai nơi tự khai danh sách riêng và chỉ được giữ khớp bằng lời dặn;
    lệch một gói là quét báo "đã đủ" rồi chạy thật văng ImportError giữa chừng.
    """
    pkgs = list(_BLOCK_BASE.get(block_type, []))
    if block_type in _DRIVER_BLOCKS:
        pkgs.extend(_DB_DRIVERS.get(db_type, ["pyodbc"]))
    return pkgs


def _parse_python_imports(code: str) -> set:
    """Lấy tên module top-level được import trong code (bỏ relative import)."""
    mods = set()
    if not code or not code.strip():
        return mods
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return mods
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for n in node.names:
                mods.add(n.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:  # bỏ from . import (relative)
                mods.add(node.module.split(".")[0])
    return mods


def _module_to_package(mod: str):
    if not mod or mod in _STDLIB:
        return None
    return _MODULE_ALIAS.get(mod, mod)


def _norm(name) -> str:
    """Tên gói pip chuẩn hoá để so sánh (PEP 503: không phân biệt hoa thường, _ = -)."""
    return re.sub(r"[-_.]+", "-", str(name).strip().lower())


def scan_packages(graphs: list, workflow_names: list | None = None) -> list:
    """Gom package mọi khối của mọi workflow cần, đã bỏ trùng.

    graphs: graph dict (đã json.loads) của từng workflow; workflow_names cùng thứ tự.
    Trả [{"package", "reasons", "modules", "fixed"}]:
    - reasons: [{"kind": "block"|"db_driver"|"import", "block", "workflow"}] — FE tự
      dịch (không trả chuỗi tiếng Việt cứng), ghi rõ khối nào của WORKFLOW nào cần.
    - modules: tên module mà khối Python import (để kiểm "đã cài" bằng import thật).
    - fixed: gói cố định của khối SQL/Excel (đúng tên pip, kiểm theo pip list).
    """
    found = {}

    def add(pkg, kind, label, wf, module=None):
        if not pkg:
            return
        e = found.setdefault(pkg, {"reasons": [], "modules": set(), "fixed": False})
        reason = {"kind": kind, "block": label, "workflow": wf}
        if reason not in e["reasons"]:
            e["reasons"].append(reason)
        if module:
            e["modules"].add(module)
        else:
            e["fixed"] = True

    names = list(workflow_names or [])
    for idx, g in enumerate(graphs or []):
        wf = names[idx] if idx < len(names) else ""
        for node in (g.get("nodes", []) if isinstance(g, dict) else []):
            data = node.get("data", {}) or {}
            bt = data.get("type")
            label = data.get("label") or bt or "?"

            if bt in _BLOCK_BASE:
                # Cùng hàm với lúc chạy thật (ensure_block_packages) — kể cả khi kết nối
                # DB không tìm thấy thì driver mặc định vẫn là pyodbc, đừng bỏ qua.
                conn_key = _DRIVER_BLOCKS.get(bt)
                cfg = None
                if conn_key:
                    cid = (data.get(conn_key) or "").strip()
                    cfg = get_saved_db_connection(cid) if cid else None
                base = set(_BLOCK_BASE[bt])
                for pkg in required_packages(bt, (cfg or {}).get("db_type")):
                    add(pkg, "block" if pkg in base else "db_driver", label, wf)

            # Khối python: parse import (best-effort)
            if bt == "python":
                for mod in _parse_python_imports(data.get("code") or ""):
                    add(_module_to_package(mod), "import", label, wf, module=mod)

    return [
        {"package": p, "reasons": sorted(found[p]["reasons"], key=lambda r: (r["workflow"], r["block"], r["kind"])),
         "modules": sorted(found[p]["modules"]), "fixed": found[p]["fixed"]}
        for p in sorted(found, key=str.lower)
    ]


_FIND_SPEC_SCRIPT = (
    "import importlib.util, json, sys\n"
    "out = {}\n"
    "for m in sys.argv[1:]:\n"
    "    try:\n"
    "        out[m] = importlib.util.find_spec(m) is not None\n"
    "    except Exception:\n"
    "        out[m] = False\n"
    "print(json.dumps(out))\n"
)


def _importable_in_venv(python_exe: str, modules: list) -> dict | None:
    """{module: True/False} — tra trong CHÍNH venv project, không import thật (find_spec).

    -I (isolated): không để thư mục hiện tại/biến môi trường che mất kết quả thật.
    Trả None nếu không chạy được venv → caller lùi về so tên pip.
    """
    if not modules:
        return {}
    try:
        res = subprocess.run([python_exe, "-I", "-c", _FIND_SPEC_SCRIPT, *modules],
                             capture_output=True, text=True, timeout=60)
        if res.returncode != 0:
            return None
        return json.loads(res.stdout.strip().splitlines()[-1])
    except Exception:
        return None


def mark_installed(project_id: str, items: list) -> list:
    """Gắn cờ installed cho từng gói, theo đúng cách lúc chạy thật sẽ gặp.

    - Gói từ `import` của khối Python: đã cài = MỌI module đó import được trong venv
      project. Trước đây so TÊN pip đoán từ tên module: code `import jwt` trong khi
      venv có PyJWT → báo thiếu, bấm cài là cài NHẦM gói `jwt` khác trên PyPI.
    - Gói cố định của khối SQL/Excel: đúng tên pip → so với pip list.
    Venv chưa có / hỏng → mọi gói là chưa cài.
    """
    from services import venv_manager
    from services.executor_blocks import list_pkgs_sync

    if not venv_manager.venv_exists(project_id):
        for it in items:
            it["installed"] = False
        return items

    pip_names = {_norm(p["name"]) for p in list_pkgs_sync(project_id)}
    modules = sorted({m for it in items for m in it.get("modules", [])})
    importable = _importable_in_venv(venv_manager.get_python_path(project_id), modules)

    for it in items:
        by_pip = _norm(it["package"]) in pip_names
        mods = it.get("modules") or []
        if importable is None or not mods:
            ok = by_pip                                   # gói cố định / không chạy được venv
        elif it.get("fixed"):
            ok = by_pip and all(importable.get(m) for m in mods)
        else:
            ok = all(importable.get(m) for m in mods)     # chỉ tin import thật
        it["installed"] = ok
    return items
