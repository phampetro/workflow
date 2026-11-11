"""Registry handler phải phủ đủ mọi khối mà giao diện cho kéo thả."""
import re
from pathlib import Path

from conftest import graph
from services.block_handlers import BLOCK_HANDLERS
from services.pkg_scanner import _BLOCK_BASE, required_packages

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "WorkflowEditor.jsx"


def _palette_block_types():
    src = FRONTEND.read_text(encoding="utf-8")
    body = src[src.index("const getBlockGroups"):]
    body = body[:body.index("\n]")]
    return {t for items in re.findall(r"items:\s*\[([^\]]*)\]", body)
            for t in re.findall(r"'([a-z_]+)'", items)}


def test_every_palette_block_has_handler():
    types = _palette_block_types() - {"note"}   # ghi chú: không nối cạnh, không bao giờ chạy
    assert types, "không đọc được danh sách khối từ WorkflowEditor.jsx"
    missing = types - set(BLOCK_HANDLERS)
    assert not missing, f"Khối có trên giao diện nhưng thiếu handler: {missing}"


def test_required_packages_single_source():
    assert required_packages("sql_to_excel", "postgresql") == ["pandas", "sqlalchemy", "openpyxl", "psycopg2-binary"]
    assert required_packages("run_sql_exec", None) == ["sqlalchemy", "pyodbc"]
    assert required_packages("merge_excel") == ["pandas", "openpyxl", "xlrd"]
    assert required_packages("python") == []
    for btype in _BLOCK_BASE:
        assert btype in BLOCK_HANDLERS


def test_error_trigger_has_no_unsupported_warning(engine):
    engine.run(graph(
        [("s", "start", {}), ("tg", "telegram", {}),
         ("et", "error_trigger", {}), ("h", "python", {"code": "x"})],
        [("s", "tg"), ("et", "h")],
    ))
    assert not any(bid == "et" and lv == "warning" for bid, lv, _, _ in engine.logs)


def test_excel_read_rejects_path_traversal(engine):
    secret = engine.wf_dir.parent / "secret.csv"
    secret.write_text("k\nv\n", encoding="utf-8")
    engine.write_input_json({"f": "../../secret.csv"})
    status, err = engine.run(graph(
        [("s", "start", {}), ("r", "excel_read", {"excelReadFile": "{{f}}", "outputVarName": "rows"}),
         ("py", "python", {"code": "x"})],
        [("s", "r"), ("r", "py")],
    ))
    assert status == "error" and "secret.csv" in err
    assert engine.called("py") == []


def test_excel_to_sql_input_file_is_plain_name(engine):
    conn = engine.add_db_connection()
    engine.run(graph(
        [("s", "start", {}),
         ("imp", "excel_to_sql", {"excelToSqlInputFile": "..\\..\\pyflow.db", "excelToSqlTableName": "t",
                                  "excelToSqlSavedConnectionId": conn})],
        [("s", "imp")],
    ))
    assert "input_file = 'pyflow.db'" in engine.called("imp")[0][3]
