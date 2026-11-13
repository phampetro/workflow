"""Quét thư viện cho "Tự động cài thư viện": gom theo workflow/khối, kiểm cài bằng import thật."""
from services import pkg_scanner as ps


def _g(*nodes):
    return {"nodes": [{"id": str(i), "data": d} for i, d in enumerate(nodes)]}


def test_scan_dedupes_across_workflows_and_names_the_workflow(monkeypatch):
    monkeypatch.setattr(ps, "get_saved_db_connection", lambda cid: None)
    items = ps.scan_packages(
        [_g({"type": "excel_to_sql", "label": "Nhap"}, {"type": "python", "label": "Xu ly", "code": "import pandas\nimport jwt"}),
         _g({"type": "merge_excel", "label": "Ghep"})],
        ["WF A", "WF B"])
    by = {i["package"]: i for i in items}
    # pandas: 3 nguồn, 1 dòng duy nhất
    assert {(r["kind"], r["block"], r["workflow"]) for r in by["pandas"]["reasons"]} == {
        ("block", "Nhap", "WF A"), ("import", "Xu ly", "WF A"), ("block", "Ghep", "WF B")}
    # driver mặc định pyodbc dù kết nối DB không tìm thấy — khớp với lúc chạy thật
    assert by["pyodbc"]["reasons"][0]["kind"] == "db_driver"
    # tên module ≠ tên gói pip
    assert "PyJWT" in by and by["PyJWT"]["modules"] == ["jwt"] and "jwt" not in by


def test_scan_ignores_stdlib_and_backend_blocks():
    items = ps.scan_packages([_g({"type": "python", "code": "import os, json\nfrom datetime import date"},
                                 {"type": "browser"}, {"type": "telegram"}, {"type": "excel_read"})], ["W"])
    assert items == []


def test_mark_installed_uses_real_import_not_pip_name(monkeypatch):
    from services import venv_manager
    from services import executor_blocks
    monkeypatch.setattr(venv_manager, "venv_exists", lambda pid: True)
    monkeypatch.setattr(venv_manager, "get_python_path", lambda pid: "python.exe")
    monkeypatch.setattr(executor_blocks, "list_pkgs_sync", lambda pid: [{"name": "pandas"}, {"name": "SQLAlchemy"}])
    monkeypatch.setattr(ps, "_importable_in_venv", lambda exe, mods: {"jwt": True, "requests": False, "pandas": True})
    items = [
        {"package": "PyJWT", "modules": ["jwt"], "fixed": False},          # pip list KHÔNG có, nhưng import được
        {"package": "requests", "modules": ["requests"], "fixed": False},
        {"package": "sqlalchemy", "modules": [], "fixed": True},           # tên pip khác hoa thường
        {"package": "pandas", "modules": ["pandas"], "fixed": True},
        {"package": "pyodbc", "modules": [], "fixed": True},
    ]
    got = {i["package"]: i["installed"] for i in ps.mark_installed("p", items)}
    assert got == {"PyJWT": True, "requests": False, "sqlalchemy": True, "pandas": True, "pyodbc": False}


def test_mark_installed_without_venv_marks_all_missing(monkeypatch):
    from services import venv_manager
    monkeypatch.setattr(venv_manager, "venv_exists", lambda pid: False)
    items = ps.mark_installed("p", [{"package": "pandas", "modules": [], "fixed": True}])
    assert items[0]["installed"] is False


def test_importable_in_venv_with_real_interpreter():
    import sys
    res = ps._importable_in_venv(sys.executable, ["json", "khong_ton_tai_xyz"])
    assert res == {"json": True, "khong_ton_tai_xyz": False}


def _call_auto_install(monkeypatch, venv_ok, packages):
    """Gọi thẳng endpoint auto-install với session giả, không chạy thread cài thật."""
    import asyncio
    import threading
    from fastapi import HTTPException
    from routers import projects
    from services import venv_manager

    class _Session:
        async def get(self, model, pid):
            return object()

    started = []
    real_thread = threading.Thread

    def _thread(*a, **kw):
        # Chỉ chặn thread cài gói; thread khác (asyncio.to_thread) vẫn chạy thật.
        if kw.get("target") is projects._install_worker:
            started.append(kw["args"])
            return real_thread(target=lambda: None)
        return real_thread(*a, **kw)

    monkeypatch.setattr(venv_manager, "venv_exists", lambda pid: venv_ok)
    monkeypatch.setattr(threading, "Thread", _thread)
    projects._pkg_jobs.pop("p1", None)
    try:
        return asyncio.run(projects.auto_install_packages("p1", {"packages": packages}, _Session())), started
    except HTTPException as e:
        return e.status_code, started
    finally:
        projects._pkg_jobs.pop("p1", None)


def test_auto_install_empty_list_rebuilds_broken_venv(monkeypatch):
    """Project không cần thư viện nào mà venv hỏng: phải cho tạo lại, không trả 400.

    Bug cũ: Kiểm tra môi trường bảo bấm "Tự động cài thư viện" để tạo lại, nhưng quét
    ra 0 gói → nút bị khoá, endpoint từ chối danh sách rỗng → venv hỏng vĩnh viễn.
    """
    res, started = _call_auto_install(monkeypatch, venv_ok=False, packages=[])
    assert res == {"status": "started", "total": 0}
    assert started == [("p1", [])]


def test_auto_install_empty_list_rejected_when_venv_healthy(monkeypatch):
    res, started = _call_auto_install(monkeypatch, venv_ok=True, packages=[])
    assert res == 400 and started == []
