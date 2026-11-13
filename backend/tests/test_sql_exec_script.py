"""Script khối "Chạy Hàm SQL (EXEC)" phải đọc HẾT mọi kết quả của thủ tục.

Thủ tục không có SET NOCOUNT ON trả 1 kết quả (số dòng) cho mỗi câu lệnh. Đọc kết quả
đầu rồi đóng kết nối → SQL Server huỷ phần còn lại của thủ tục mà vẫn báo thành công.
Chạy đúng script sinh ra với một driver giả có nhiều tập kết quả.
"""
import sys
import types

import pytest

from conftest import graph


class FakeCursor:
    """results: list các phần tử ("count", n) | ("rows", cols, data) | ("error", msg)."""

    def __init__(self, results, log):
        self.results, self.i, self.log = results, 0, log
        self.description, self.rowcount = None, -1

    def _load(self):
        kind = self.results[self.i]
        if kind[0] == "error":
            raise RuntimeError(kind[1])
        if kind[0] == "count":
            self.description, self.rowcount = None, kind[1]
        else:
            self.description, self.rowcount = [(c,) for c in kind[1]], -1
        self.log.append(f"read:{self.i}")

    def execute(self, sql):
        self.log.append(f"execute:{sql}")
        self._load()

    def fetchall(self):
        return self.results[self.i][2]

    def nextset(self):
        self.i += 1
        if self.i >= len(self.results):
            return None
        self._load()
        return True

    def close(self):
        self.log.append(f"close_at:{self.i}")


def _run_script(code, results):
    log = []

    class Conn:
        connection = types.SimpleNamespace(cursor=lambda: FakeCursor(results, log))
        def execution_options(self, **kw):
            log.append(f"opts:{kw}")
            return self
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    fake = types.ModuleType("sqlalchemy")
    fake.create_engine = lambda cs: types.SimpleNamespace(connect=lambda: Conn())
    saved = sys.modules.get("sqlalchemy")
    sys.modules["sqlalchemy"] = fake
    try:
        ns = {}
        exec(code, ns)
        return ns, log
    finally:
        if saved is not None:
            sys.modules["sqlalchemy"] = saved
        else:
            del sys.modules["sqlalchemy"]


@pytest.fixture
def exec_code(engine):
    conn = engine.add_db_connection()
    engine.run(graph([("s", "start", {}),
                      ("ex", "run_sql_exec", {"sqlCommand": "exec pro_CapNhatHuyHoaDon;",
                                              "sqlExecSavedConnectionId": conn})],
                     [("s", "ex")]))
    return engine.called("ex")[0][3]


def test_reads_every_statement_result_of_procedure(exec_code):
    # INSERT 1609 dòng rồi UPDATE 35 dòng — trước đây chỉ đọc kết quả đầu, UPDATE bị huỷ
    ns, log = _run_script(exec_code, [("count", 1609), ("count", 35)])
    assert "read:1" in log                       # đã đọc tới kết quả của câu thứ 2
    assert log[-1] == "close_at:2"               # chỉ đóng cursor SAU khi hết kết quả
    assert "opts:{'isolation_level': 'AUTOCOMMIT'}" in log
    assert ns["output_data"] == {"result": [], "row_count": 1644}


def test_last_result_set_is_returned(exec_code):
    ns, _ = _run_script(exec_code, [("count", 10), ("rows", ["SO", "MA"], [("001", "Hủy"), ("002", "Hủy")])])
    assert ns["output_data"]["result"] == [{"SO": "001", "MA": "Hủy"}, {"SO": "002", "MA": "Hủy"}]
    assert ns["output_data"]["row_count"] == 2


def test_error_in_later_statement_is_not_swallowed(exec_code):
    with pytest.raises(RuntimeError, match="vi phạm khoá"):
        _run_script(exec_code, [("count", 1609), ("error", "vi phạm khoá chính")])
