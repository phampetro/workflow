"""
Quét package cần cài cho một project: đọc mọi workflow → mọi khối → suy ra thư viện.

- Khối SQL/Excel chạy trong project venv: package cố định (khớp ensure_packages) +
  driver DB theo db_type của kết nối khối chọn.
- Khối python: parse `code` bằng ast lấy import top-level, lọc thư viện chuẩn (stdlib),
  ánh xạ tên module → tên pip. Đây là BEST-EFFORT (hiện cho người dùng sửa trước khi cài).

Các khối khác (browser/telegram/excel_read...) chạy trong backend venv → không tính.
"""
import ast
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


def scan_packages(graphs: list) -> list:
    """
    graphs: danh sách graph dict (đã json.loads) của mọi workflow trong project.
    Trả: [{"package": str, "reasons": [str...]}] đã dedupe, sắp xếp.
    """
    found = {}  # package -> set(reason)

    def add(pkg, reason):
        if pkg:
            found.setdefault(pkg, set()).add(reason)

    for g in graphs or []:
        for node in (g.get("nodes", []) if isinstance(g, dict) else []):
            data = node.get("data", {}) or {}
            bt = data.get("type")
            label = data.get("label") or bt or "?"

            for pkg in _BLOCK_BASE.get(bt, []):
                add(pkg, f"Khối \"{label}\"")

            # Driver DB theo kết nối khối chọn
            conn_key = _DRIVER_BLOCKS.get(bt)
            if conn_key:
                cid = (data.get(conn_key) or "").strip()
                cfg = get_saved_db_connection(cid) if cid else None
                if cfg:
                    for pkg in _DB_DRIVERS.get(cfg.get("db_type"), ["pyodbc"]):
                        add(pkg, f"Kết nối DB của khối \"{label}\"")

            # Khối python: parse import (best-effort)
            if bt == "python":
                for mod in _parse_python_imports(data.get("code") or ""):
                    pkg = _module_to_package(mod)
                    add(pkg, f"import trong khối \"{label}\"")

    return [
        {"package": p, "reasons": sorted(found[p])}
        for p in sorted(found.keys(), key=str.lower)
    ]
