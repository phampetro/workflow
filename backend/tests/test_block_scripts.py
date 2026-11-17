"""Chạy THẬT các script cố định trong services/block_scripts/ (pandas + openpyxl).

Trước đây script là chuỗi f-string trong handler nên không test được trực tiếp;
giờ là file .py thật → chạy đúng mã script_code() sinh ra với file Excel mẫu.
"""
import pandas as pd
import pytest

from services.block_handlers.common import BLOCK_SCRIPTS_DIR, script_code


def _run(name, params, input_dir, output_dir):
    ns = {"INPUT_DIR": str(input_dir), "OUTPUT_DIR": str(output_dir)}
    exec(compile(script_code(name, params), f"<{name}>", "exec"), ns)
    return ns["output_data"]


@pytest.fixture
def dirs(tmp_path):
    i, o = tmp_path / "input", tmp_path / "output"
    i.mkdir()
    o.mkdir()
    return i, o


def _xlsx(path, rows, header=("Vung", "SanPham", "SoLuong")):
    pd.DataFrame(rows, columns=list(header)).to_excel(path, index=False)


def test_every_script_compiles():
    for p in BLOCK_SCRIPTS_DIR.glob("*.py"):
        compile(script_code(p.stem, {}), p.name, "exec")


def test_merge_keeps_header_once_and_appends_all_rows(dirs):
    i, o = dirs
    _xlsx(i / "a.xlsx", [["Bac", "X", 1], ["Nam", "Y", 2]])
    _xlsx(i / "b.xlsx", [["Trung", "X", 3]])
    out = _run("merge_excel", {"header_rows": 1, "merge_mode": "all_input",
                               "selected_files": [], "excel_filename": "gop.xlsx"}, i, o)
    assert out == {"file_name": "gop.xlsx"}
    df = pd.read_excel(o / "gop.xlsx")
    assert list(df.columns) == ["Vung", "SanPham", "SoLuong"] and df["SoLuong"].tolist() == [1, 2, 3]


def test_merge_custom_list_reads_output_dir_too(dirs):
    i, o = dirs
    _xlsx(i / "a.xlsx", [["Bac", "X", 1]])
    _xlsx(o / "b.xlsx", [["Nam", "Y", 5]])
    _run("merge_excel", {"header_rows": 1, "merge_mode": "custom",
                         "selected_files": ["a.xlsx", "b.xlsx"], "excel_filename": "gop.xlsx"}, i, o)
    assert pd.read_excel(o / "gop.xlsx")["SoLuong"].tolist() == [1, 5]


def test_pivot_with_column_letters_and_custom_sort(dirs):
    i, o = dirs
    _xlsx(i / "d.xlsx", [["Bac", "X", 1], ["Nam", "X", 2], ["Bac", "Y", 4], ["Trung", "X", 8]])
    _run("pivot_excel", {
        "selected_files": ["d.xlsx"], "excel_filename": "pv.xlsx",
        "index": "A", "columns": "", "values": "SoLuong",   # "A" = cột đầu theo chữ cái Excel
        "agg": "sum", "fillna": True, "grand_total": False, "header_row": 1,
        "enable_sort": True, "sort_column": "Vung", "sort_order": "custom", "sort_custom": ["Nam", "Trung"],
    }, i, o)
    df = pd.read_excel(o / "pv.xlsx")
    assert df["Vung"].tolist() == ["Nam", "Trung", "Bac"]     # custom trước, phần còn lại sau
    assert df["SoLuong"].tolist() == [2, 8, 5]


def test_sql_query_with_triple_quotes_stays_data():
    """Payload kiểu x\"\"\"; import os ... chỉ là chuỗi trong PARAMS, không thành mã."""
    evil = 'x"""; import os; os.system("calc"); z="""'
    code = script_code("sql_to_excel", {"conn_str": "c", "sql_query": evil, "excel_filename": "f"})
    ns = {}
    exec(code.split("\n", 2)[0] + "\n" + code.split("\n", 2)[1], ns)
    assert ns["PARAMS"]["sql_query"] == evil


def test_sql_scripts_explain_sqlalchemy_too_old_for_pandas(monkeypatch, dirs):
    """pandas đòi SQLAlchemy mới hơn bản trong venv → lỗi rõ ràng thay vì
    "'Engine' object has no attribute 'cursor'" (gặp thật khi ghim 2.0.36 với pandas 3.1.1)."""
    from pandas.compat import _optional
    monkeypatch.setitem(_optional.VERSIONS, "sqlalchemy", "9.9.9")
    i, o = dirs
    for name, params in (("sql_to_excel", {"conn_str": "sqlite://", "sql_query": "select 1", "excel_filename": "x.xlsx"}),
                         ("excel_to_sql", {"conn_str": "sqlite://", "input_file": "a.xlsx", "table_name": "t",
                                           "import_mode": "append", "mapping": {}, "header_row_str": "1",
                                           "header_row_val": 0})):
        with pytest.raises(RuntimeError, match="cần SQLAlchemy >= 9.9.9"):
            _run(name, params, i, o)


def test_sql_to_excel_reads_through_engine(dirs):
    i, o = dirs
    out = _run("sql_to_excel", {"conn_str": "sqlite://", "sql_query": "select 1 as a, 'x' as b",
                                "excel_filename": "kq.xlsx"}, i, o)
    assert out == {"file_name": "kq.xlsx"}
    assert pd.read_excel(o / "kq.xlsx").to_dict("records") == [{"a": 1, "b": "x"}]
