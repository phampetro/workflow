"""Test đầu-cuối giao diện: backend THẬT (dữ liệu tạm, PYFLOW_DATA_DIR) phục vụ
frontend/dist, trình duyệt THẬT (Playwright) bấm như người dùng.

Luồng chính: tạo user → tạo project → tạo workflow → mở editor (không được tự ghi khi
chưa sửa) → mở form cấu hình khối → quay lại. Bắt cả lỗi console.

Chạy: cần frontend/dist (npm run build) và cổng 8000 trống (CSRF guard chỉ nhận
origin 7000/8000/9000). CI chạy ở job "e2e".
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
DIST = BACKEND.parent / "frontend" / "dist" / "index.html"
PORT = 8000
BASE = f"http://127.0.0.1:{PORT}"


def _port_busy():
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(not DIST.exists(), reason="chưa build frontend/dist"),
    pytest.mark.skipif(_port_busy(), reason=f"cổng {PORT} đang bận"),
]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("e2e_data")
    env = dict(os.environ, PYFLOW_DATA_DIR=str(data))
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1",
                             "--port", str(PORT)], cwd=BACKEND, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{BASE}/health", timeout=2)
                break
            except Exception:
                time.sleep(0.5)
        else:
            pytest.fail("backend không lên")
        yield data
    finally:
        proc.terminate()
        proc.wait(timeout=20)


@pytest.fixture(scope="module")
def page(server):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(channel="chrome", headless=True)   # Chrome cài sẵn (máy dev, CI Windows)
        except Exception:
            browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1400, "height": 900}, locale="vi-VN")
        pg = ctx.new_page()
        pg.console_errors = []
        pg.on("console", lambda m: m.type == "error" and pg.console_errors.append(m.text))
        pg.on("pageerror", lambda e: pg.console_errors.append(str(e)))
        pg.writes = []
        pg.on("request", lambda r: r.method in ("POST", "PUT", "PATCH", "DELETE") and pg.writes.append(f"{r.method} {r.url}"))
        yield pg
        browser.close()


def test_main_flow(page, server):
    pg = page
    pg.goto(BASE)

    # 1. Tạo user đầu tiên rồi chọn nó
    pg.get_by_role("button", name="Thêm người dùng mới").click()
    pg.get_by_placeholder("Nhập tên người dùng...").fill("E2E")
    pg.get_by_role("button", name="Tạo", exact=True).click()
    pg.locator(".ant-modal").get_by_text("E2E", exact=True).click()
    pg.wait_for_timeout(500)

    # 2. Tạo project
    pg.get_by_role("button", name="Tạo Project").first.click()
    pg.get_by_placeholder("VD: Data ETL Pipeline").fill("Du an E2E")
    pg.locator(".ant-modal").get_by_role("button", name="Tạo Project").click()
    pg.get_by_role("button", name="Mở project Du an E2E").click()

    # 3. Tạo workflow (trang project tải theo nhu cầu — React.lazy)
    pg.get_by_role("button", name="Workflow mới").click()
    modal = pg.locator(".ant-modal").filter(has=pg.locator("input")).last
    modal.locator("input").first.fill("WF E2E")
    modal.get_by_role("button").filter(has_text="Tạo").last.click()

    # 4. Mở editor. Workflow MỚI chưa có graph trong DB → lần mở đầu lưu graph mặc định
    # (Bắt đầu → Kết thúc) đúng 1 lần — cần có để chạy được. Mở LẠI mà không sửa gì thì
    # KHÔNG được ghi (autosave chỉ khi graph đổi — trước đây mở là PUT).
    pg.get_by_role("button", name="Mở workflow WF E2E").click()
    pg.locator(".react-flow__node").first.wait_for()
    pg.wait_for_timeout(3000)                                   # > debounce autosave 1.5s
    assert pg.locator(".react-flow__node").count() >= 2         # start + end mặc định
    pg.get_by_role("button", name="Quay lại").first.click()
    pg.get_by_role("button", name="Mở workflow WF E2E").click()
    pg.locator(".react-flow__node").first.wait_for()
    writes_before = len(pg.writes)
    pg.wait_for_timeout(3000)
    assert pg.writes[writes_before:] == [], pg.writes[writes_before:]

    # 5. Mở form cấu hình khối (BlockEditorModal) rồi đóng
    pg.locator(".react-flow__node").first.dblclick()
    drawer = pg.locator(".ant-drawer-open")
    drawer.wait_for()
    assert "blockEditor." not in drawer.inner_text()           # không lộ key dịch thô
    drawer.locator(".ant-drawer-close").click()

    # 6. Quay lại danh sách
    pg.get_by_role("button", name="Quay lại").first.click()
    pg.get_by_role("button", name="Mở workflow WF E2E").wait_for()

    assert pg.console_errors == [], pg.console_errors
