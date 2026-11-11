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
