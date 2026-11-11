"""Hàm thuần đã từng gây bug thật — xem docstring/comment tại chỗ định nghĩa."""
from pathlib import Path

import pytest

from services import executor_blocks as eb
from services import venv_manager as vm


@pytest.mark.parametrize("raw,expected", [
    ("bao_cao.xlsx", "bao_cao.xlsx"),
    ("../../pyflow.db", "pyflow.db"),
    ("..\\..\\pyflow.db", "pyflow.db"),
    ("C:\\Windows\\win.ini", "win.ini"),
    ("..", "fb"),
    ("", "fb"),
    (None, "fb"),
])
def test_safe_filename(raw, expected):
    assert eb.safe_filename(raw, "fb") == expected


@pytest.mark.parametrize("name,ok", [
    ("don_hang", True), ("dbo.don_hang", True), ("_t1", True),
    ("x]; DROP TABLE a; --", False), ("a.b.c", False), ("1abc", False), ("", False),
])
def test_valid_table_name(name, ok):
    assert bool(eb._VALID_TABLE_NAME.match(name)) is ok


def test_rename_output_keys_custom_name_replaces_original():
    out = eb.rename_output_keys("run_sql_exec", {"sqlExecRowCountVarName": "so_dong"},
                                {"result": [], "row_count": 3})
    assert out == {"result": [], "so_dong": 3}


def test_rename_output_keys_default_is_noop():
    data = {"file_name": "a.xlsx", "other": 1}
    assert eb.rename_output_keys("sql_to_excel", {"outputVarName": "file_name"}, data) == data
    assert eb.rename_output_keys("sql_to_excel", {}, data) == data
    assert eb.rename_output_keys("unknown_block", {"outputVarName": "x"}, data) == data


def test_every_output_var_field_is_not_interpolated():
    """Quy tắc CLAUDE.md: mọi field đặt tên biến output phải nằm trong NON_INTERPOLATED_KEYS."""
    fields = {f for pairs in eb.BLOCK_OUTPUT_VARS.values() for _, f in pairs}
    assert fields <= eb.NON_INTERPOLATED_KEYS
    assert "_initial_input" in eb.NON_INTERPOLATED_KEYS


def test_topological_sort():
    nodes = [{"id": i} for i in "cab"]
    edges = [{"source": "a", "target": "b"}, {"source": "b", "target": "c"}]
    assert [n["id"] for n in eb.topological_sort(nodes, edges)] == ["a", "b", "c"]


def test_runner_template_formats():
    code = eb.RUNNER_TEMPLATE.format(workflow_id="w", block_id="b", output_dir="o",
                                     input_dir="i", user_code=eb.indent_code("x = 1"))
    compile(code, "main.py", "exec")


def _write_cfg(venv: Path, home: str):
    venv.mkdir(parents=True, exist_ok=True)
    (venv / "pyvenv.cfg").write_text(f"home = {home}\nversion = 3.13.0\n", encoding="utf-8")


def test_venv_base_python_ok_detects_missing_base(tmp_path):
    _write_cfg(tmp_path / "v", str(tmp_path / "khong_ton_tai"))
    assert vm._venv_base_python_ok(tmp_path / "v") is False


def test_venv_base_python_ok_with_real_base(tmp_path):
    home = tmp_path / "py"
    home.mkdir()
    (home / "python.exe").write_bytes(b"")
    _write_cfg(tmp_path / "v", str(home))
    assert vm._venv_base_python_ok(tmp_path / "v") is True


def test_venv_without_cfg_is_not_ok(tmp_path):
    assert vm._venv_base_python_ok(tmp_path / "none") is False


def test_get_system_python_skips_store_stub(monkeypatch):
    import shutil
    import sys
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    table = {"py": None,
             "python": r"C:\Users\x\AppData\Local\Microsoft\WindowsApps\python.exe",
             "python3": None}
    monkeypatch.setattr(shutil, "which", lambda n: table.get(n))
    with pytest.raises(RuntimeError):
        vm.get_system_python()
    table["py"] = r"C:\Windows\py.exe"
    assert vm.get_system_python() == r"C:\Windows\py.exe"
