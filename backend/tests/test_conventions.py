"""Quy ước của dự án do MÁY kiểm, không chỉ nằm bằng lời trong CLAUDE.md.

Mỗi test ứng với một quy tắc đã từng bị quên và gây bug thật. Test đỏ nghĩa là
vừa vi phạm quy tắc đó — sửa code, đừng nới test.
"""
import ast
import json
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
FRONTEND_SRC = REPO / "frontend" / "src"
LOCALES = FRONTEND_SRC / "i18n" / "locales"
BLOCK_EDITOR = FRONTEND_SRC / "components" / "BlockEditorModal.jsx"

_SKIP_DIRS = {".venv", "data", "build", "dist", "tests", "__pycache__"}


def _backend_sources():
    for p in BACKEND.rglob("*.py"):
        if not _SKIP_DIRS.intersection(p.relative_to(BACKEND).parts):
            yield p


# ── Biến output của khối (CLAUDE.md §Quy ước biến output) ────────────────────

def test_every_var_name_field_on_ui_is_not_interpolated():
    """Ô tên biến mà quên khai NON_INTERPOLATED_KEYS → từ vòng lặp 2 bị thay bằng
    chính GIÁ TRỊ của biến, dữ liệu ghi vào key rác."""
    from services.executor_blocks import NON_INTERPOLATED_KEYS
    src = BLOCK_EDITOR.read_text(encoding="utf-8")
    fields = set(re.findall(r"renderVarNameField\(\s*'([A-Za-z0-9_]+)'", src))
    assert fields, "không tìm thấy renderVarNameField — đổi tên hàm thì sửa test này"
    assert fields - NON_INTERPOLATED_KEYS == set()


def test_block_output_var_fields_are_not_interpolated():
    from services.executor_blocks import BLOCK_OUTPUT_VARS, NON_INTERPOLATED_KEYS
    ui_fields = {ui for pairs in BLOCK_OUTPUT_VARS.values() for _key, ui in pairs}
    assert ui_fields - NON_INTERPOLATED_KEYS == set()


# ── SQLite & task nền ────────────────────────────────────────────────────────

def test_no_bare_sqlite3_connect_outside_database_py():
    """sqlite3.connect() trần không bật WAL/busy_timeout → 'database is locked',
    run kẹt RUNNING. Dùng database.connect_sqlite()."""
    offenders = [
        str(p.relative_to(BACKEND)) for p in _backend_sources()
        if p.name != "database.py" and "sqlite3.connect(" in p.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_create_task_only_inside_spawn():
    """asyncio.create_task trần trong router: task không ai giữ tham chiếu có thể bị
    GC giữa chừng. Dùng _spawn()."""
    offenders = []
    for p in _backend_sources():
        tree = ast.parse(p.read_text(encoding="utf-8"))
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) or fn.name == "_spawn":
                continue
            for node in ast.walk(fn):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                        and node.func.attr == "create_task"
                        and isinstance(node.func.value, ast.Name) and node.func.value.id == "asyncio"):
                    offenders.append(f"{p.relative_to(BACKEND)}:{node.lineno} ({fn.name})")
    # main.py chạy ở lifespan (task sống cùng app) — chỉ router bị cấm.
    assert [o for o in offenders if o.startswith("routers")] == []


# ── i18n (CLAUDE.md §Song ngữ) ───────────────────────────────────────────────

def _flat_keys(obj, prefix=""):
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            yield from _flat_keys(v, key)
        else:
            yield key


@pytest.fixture(scope="module")
def locales():
    # json.loads báo lỗi ngay nếu có dấu ngoặc kép cong gõ nhầm — lỗi từng làm hỏng
    # cả file và kéo theo lỗi Vite HMR ở file không liên quan.
    return {lang: json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
            for lang in ("vi", "en")}


def test_vi_and_en_have_same_keys(locales):
    vi, en = set(_flat_keys(locales["vi"])), set(_flat_keys(locales["en"]))
    assert sorted(vi - en) == [], "có trong vi.json nhưng thiếu ở en.json"
    assert sorted(en - vi) == [], "có trong en.json nhưng thiếu ở vi.json"


def test_static_translation_keys_exist(locales):
    """t('a.b') với key không có → giao diện hiện nguyên chuỗi 'a.b'."""
    keys = set(_flat_keys(locales["vi"]))
    plural = {re.sub(r"_(one|other|zero|few|many)$", "", k) for k in keys}
    missing = []
    for p in FRONTEND_SRC.rglob("*.js*"):
        if p.suffix not in (".js", ".jsx"):
            continue
        for m in re.finditer(r"\bt\(\s*['\"]([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)['\"]", p.read_text(encoding="utf-8")):
            if m.group(1) not in keys and m.group(1) not in plural:
                missing.append(f"{p.relative_to(FRONTEND_SRC)}: {m.group(1)}")
    assert missing == []
