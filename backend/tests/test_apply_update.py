"""Chạy THẬT services/update_scripts/apply_update.ps1 trên một thư mục cài đặt giả.

Kiểm 3 đường: bản mới lên → đổi chỗ + giữ dữ liệu; bản mới không lên → tự quay về
bản cũ, dữ liệu nguyên vẹn, có cờ .update_failed; zip hỏng → không đụng gì.
Dữ liệu khách nằm trong backend/_internal/data — mất nó là sự cố nghiêm trọng nhất.
"""
import shutil
import socket
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "services" / "update_scripts" / "apply_update.ps1"
pytestmark = pytest.mark.skipif(shutil.which("powershell") is None, reason="cần Windows PowerShell")

SERVER = '''
import http.server, os, sys
port, pidfile = int(sys.argv[1]), sys.argv[2]
open(pidfile, "w").write(str(os.getpid()))
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/health" else 404); self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", port), H).serve_forever()
'''


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _vbs_mark(name):
    """start.vbs chỉ ghi 1 file đánh dấu ở thư mục cài đặt (biết bản nào đã được chạy)."""
    return ('Set fso = CreateObject("Scripting.FileSystemObject")\r\n'
            'd = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))\r\n'
            f'fso.CreateTextFile(d & "\\{name}").Close\r\n')


def _vbs_server(port, pidfile):
    q = 'Chr(34)'
    return (f'Set sh = CreateObject("WScript.Shell")\r\n'
            f'Set fso = CreateObject("Scripting.FileSystemObject")\r\n'
            f'here = fso.GetParentFolderName(WScript.ScriptFullName)\r\n'
            f'sh.Run {q} & "{sys.executable}" & {q} & " " & {q} & here & "\\server.py" & {q} & " {port} " & {q} & "{pidfile}" & {q}, 0, False\r\n')


@pytest.fixture
def install(tmp_path):
    root = tmp_path / "PyFlow Studio"                       # có dấu cách như máy thật
    data = root / "backend" / "_internal" / "data"
    data.mkdir(parents=True)
    (data / "pyflow.db").write_text("DU-LIEU-KHACH")
    (data / "pj_x").mkdir()
    (data / "pj_x" / "input.json").write_text("{}")
    (root / "backend" / "pyflow-backend.exe").write_text("old")
    (root / "backend" / "version.txt").write_text("old")
    (root / "backend" / "start.vbs").write_text(_vbs_mark("old_started.txt"))
    (root / "frontend").mkdir()
    (root / "frontend" / "index.html").write_text("old")
    return root


def _make_zip(root, start_vbs, server=False, broken=False):
    z = root / "update.zip"
    if broken:
        z.write_bytes(b"khong phai zip")
        return z
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("backend/pyflow-backend.exe", "new")
        f.writestr("backend/version.txt", "new")
        f.writestr("backend/start.vbs", start_vbs)
        f.writestr("backend/_internal/base_library.zip", "x")
        if server:
            f.writestr("backend/server.py", SERVER)
        f.writestr("frontend/index.html", "new")
        f.writestr("runtime/python/python.exe", "py")
    return z


def _run(root, zip_path, port, timeout_sec):
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT),
         "-Install", str(root), "-Zip", str(zip_path),
         "-HealthUrl", f"http://127.0.0.1:{port}/health",
         "-HealthTimeoutSec", str(timeout_sec), "-WaitOldExitSec", "0"],
        capture_output=True, text=True, timeout=180)


def _wait_file(p, sec=15):
    end = time.time() + sec
    while time.time() < end and not p.exists():
        time.sleep(0.3)
    return p.exists()


def test_success_swaps_in_new_version_and_keeps_data(install, tmp_path):
    port, pidfile = _free_port(), tmp_path / "server.pid"
    z = _make_zip(install, _vbs_server(port, pidfile), server=True)
    try:
        r = _run(install, z, port, 60)
        assert r.returncode == 0, (r.stdout, r.stderr, (install / "update.log").read_text(encoding="utf-8-sig"))
        assert (install / "backend" / "version.txt").read_text() == "new"
        assert (install / "frontend" / "index.html").read_text() == "new"
        assert (install / "runtime" / "python" / "python.exe").exists()
        data = install / "backend" / "_internal" / "data"
        assert (data / "pyflow.db").read_text() == "DU-LIEU-KHACH"
        assert (data / "pj_x" / "input.json").exists()
        assert not (data / ".update_failed").exists()
        assert not (install / "_update_backup").exists() and not (install / "_update_stage").exists()
        assert not z.exists()
    finally:
        if pidfile.exists():
            subprocess.run(["taskkill", "/F", "/PID", pidfile.read_text().strip()], capture_output=True)


def test_new_version_not_healthy_rolls_back_with_data(install):
    z = _make_zip(install, _vbs_mark("new_started.txt"))     # bản mới không mở /health
    r = _run(install, z, _free_port(), 6)
    assert r.returncode == 10, r.stderr
    assert _wait_file(install / "new_started.txt")            # đã thử chạy bản mới
    assert (install / "backend" / "version.txt").read_text() == "old"
    assert (install / "frontend" / "index.html").read_text() == "old"
    assert not (install / "runtime").exists()                 # bản cũ không có runtime
    data = install / "backend" / "_internal" / "data"
    assert (data / "pyflow.db").read_text() == "DU-LIEU-KHACH"
    assert (data / ".update_failed").read_text(encoding="utf-8-sig").startswith("health")
    assert _wait_file(install / "old_started.txt")            # bản cũ được chạy lại


def test_broken_zip_touches_nothing(install):
    z = _make_zip(install, "", broken=True)
    r = _run(install, z, _free_port(), 5)
    assert r.returncode == 10
    assert (install / "backend" / "version.txt").read_text() == "old"
    assert (install / "backend" / "_internal" / "data" / "pyflow.db").read_text() == "DU-LIEU-KHACH"
    assert not (install / "_update_backup").exists()
    assert _wait_file(install / "old_started.txt")


def test_script_is_safe_for_windows_powershell_51():
    """PS 5.1 đọc .ps1 không BOM theo ANSI: '—' trong chuỗi thành '”' và vỡ cú pháp."""
    raw = SCRIPT.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf"), "apply_update.ps1 phải lưu UTF-8 CÓ BOM"
    for n, line in enumerate(raw[3:].decode("utf-8").splitlines(), 1):
        code = line if not line.lstrip().startswith("#") else ""
        code = code.split("  #", 1)[0]
        assert code.isascii(), f"dòng {n}: chỉ dùng ASCII ngoài chú thích — {line!r}"


def _port_free(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def _run_bat(root):
    from routers import system
    bat = root / "updater.bat"
    bat.write_text(system._UPDATER_BAT, encoding="utf-8")
    return subprocess.run(["cmd.exe", "/c", str(bat)], capture_output=True, text=True, timeout=240, cwd=root)


@pytest.mark.skipif(not _port_free(8000), reason="cổng 8000 đang bận (bản đóng gói đang chạy?)")
def test_updater_bat_end_to_end_uses_new_script(install, tmp_path):
    """updater.bat THẬT (tham số "%~dp0." với đường dẫn có dấu cách) → apply_update.ps1."""
    from routers import system
    pidfile = tmp_path / "server.pid"
    _make_zip(install, _vbs_server(8000, pidfile), server=True)
    shutil.copy2(system._UPDATE_SCRIPT, install / "apply_update.ps1")
    try:
        _run_bat(install)
        assert (install / "backend" / "version.txt").read_text() == "new"
        assert (install / "backend" / "_internal" / "data" / "pyflow.db").read_text() == "DU-LIEU-KHACH"
        assert not (install / "updater.bat").exists() and not (install / "apply_update.ps1").exists()
    finally:
        if _wait_file(pidfile, 5):
            subprocess.run(["taskkill", "/F", "/PID", pidfile.read_text().strip()], capture_output=True)


def test_updater_bat_falls_back_to_overlay_when_script_cannot_run(install):
    """Không chạy được .ps1 (VD chính sách công ty) → vẫn cập nhật bằng cách cũ, dữ liệu còn nguyên."""
    _make_zip(install, _vbs_mark("new_started.txt"))
    # cố ý KHÔNG chép apply_update.ps1 → powershell -File báo lỗi, mã khác 0/10
    _run_bat(install)
    assert (install / "backend" / "version.txt").read_text() == "new"
    assert (install / "backend" / "_internal" / "data" / "pyflow.db").read_text() == "DU-LIEU-KHACH"
    assert _wait_file(install / "new_started.txt")
    assert not (install / "update.zip").exists()


def test_backend_reports_rolled_back_marker_once(tmp_path, monkeypatch):
    """data/.update_failed → /update-status trả code update_rolled_back, rồi xoá cờ."""
    from routers import system
    from services import venv_manager
    monkeypatch.setattr(venv_manager, "DATA_DIR", tmp_path)
    (tmp_path / ".update_failed").write_text("health: ban moi khong khoi dong duoc", encoding="utf-8-sig")
    system._set_update_error(None)
    system._load_rolled_back_marker()
    assert system.get_update_status()["error"] == {
        "code": "update_rolled_back", "detail": "health: ban moi khong khoi dong duoc"}
    assert not (tmp_path / ".update_failed").exists()
    system._set_update_error(None)
