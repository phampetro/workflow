"""Hàng rào HTTP của main.py — xem CLAUDE.md §Bảo mật."""
import pytest

import main


@pytest.mark.parametrize("host,ok", [
    ("localhost:7000", True), ("127.0.0.1:8000", True), ("LOCALHOST", True), ("[::1]:8000", True),
    ("evil.com", False), ("127.0.0.1.evil.com:8000", False), ("localhost.evil.com", False),
    ("192.168.1.5:8000", False), ("", False), (None, False),
])
def test_host_allowed(host, ok):
    assert main._host_allowed(host) is ok


def test_allowed_origins_cover_all_ports():
    for port in (7000, 8000, 9000):
        assert f"http://localhost:{port}" in main._ALLOWED_ORIGINS


def test_unknown_api_path_is_json_404_not_index_html():
    """FE gọi /api/... không tồn tại (VD backend cũ) phải nhận 404 JSON, không phải index.html 200."""
    import pytest
    from fastapi.testclient import TestClient
    if not any(getattr(r, "path", "") == "/{full_path:path}" for r in main.app.routes):
        pytest.skip("chưa build frontend/dist nên không có route phục vụ frontend")
    c = TestClient(main.app, base_url="http://localhost:7000")
    r = c.get("/api/khong-ton-tai")
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    assert c.get("/projects/abc").headers["content-type"].startswith("text/html")   # route react-router vẫn ra SPA
