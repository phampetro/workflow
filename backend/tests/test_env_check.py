"""Phân loại ok/warn/error của màn Kiểm tra môi trường."""
from services import env_check as ec


def test_odbc_missing_is_error_only_when_sqlserver_connections_exist(monkeypatch):
    monkeypatch.setattr(ec, "_installed_odbc_drivers", lambda: ["SQL Server", "ODBC Driver 18 for SQL Server"])
    monkeypatch.setattr(ec, "_sqlserver_connection_count", lambda: 2)
    item = ec.check_odbc()
    assert item["status"] == "error"
    assert "ODBC Driver 18 for SQL Server" in item["params"]["found"]

    monkeypatch.setattr(ec, "_sqlserver_connection_count", lambda: 0)
    assert ec.check_odbc()["status"] == "warn"


def test_odbc_ok(monkeypatch):
    monkeypatch.setattr(ec, "_installed_odbc_drivers", lambda: [ec.ODBC_DRIVER_REQUIRED])
    monkeypatch.setattr(ec, "_sqlserver_connection_count", lambda: 1)
    assert ec.check_odbc()["status"] == "ok"


def test_python_missing(monkeypatch):
    def boom():
        raise RuntimeError("no python")
    monkeypatch.setattr(ec.venv_manager, "get_system_python", boom)
    assert ec.check_python() == {"code": "python", "status": "error", "params": {}}


def test_one_failing_check_does_not_break_report(monkeypatch):
    def boom():
        raise ValueError("x")
    monkeypatch.setattr(ec, "CHECKS", (("python", boom), ("odbc", lambda: ec._item("odbc", "ok"))))
    items = ec.run_all()["items"]
    assert [i["code"] for i in items] == ["python", "odbc"]
    assert items[0]["status"] == "error" and items[1]["status"] == "ok"
