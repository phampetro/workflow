"""Venv của project: Python đóng gói sẵn + uv, có đường lùi về pip / python -m venv."""
import subprocess
import sys
from pathlib import Path

import pytest

from services import venv_manager as vm


@pytest.fixture
def venv_at(tmp_path, monkeypatch):
    """Trỏ venv của project giả 'p1' vào thư mục tạm (không cần DB)."""
    venv = tmp_path / "pj" / ".venv"
    monkeypatch.setattr(vm, "get_venv_path", lambda pid: venv)
    monkeypatch.setattr(vm, "get_python_path", lambda pid: str(venv / "Scripts" / "python.exe"))
    return venv


def test_frozen_prefers_bundled_python(tmp_path, monkeypatch):
    exe = tmp_path / "backend" / "pyflow-backend.exe"
    py = tmp_path / "runtime" / "python" / "python.exe"
    uv = tmp_path / "runtime" / "uv.exe"
    for f in (exe, py, uv):
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe))
    assert vm.get_system_python() == str(py)
    assert vm.get_uv() == str(uv)


def test_frozen_without_runtime_falls_back_to_installed_python(tmp_path, monkeypatch):
    """Bản build cũ (chưa có runtime/) vẫn chạy như trước."""
    exe = tmp_path / "backend" / "pyflow-backend.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(exe))
    import shutil
    monkeypatch.setattr(shutil, "which", lambda name: r"C:\Python313\python.exe" if name == "python" else None)
    assert vm.get_system_python() == r"C:\Python313\python.exe"
    assert vm.get_uv() is None


def test_create_cmd_uses_uv_seed_but_not_with_py_launcher(venv_at, monkeypatch):
    monkeypatch.setattr(vm, "get_uv", lambda: r"C:\rt\uv.exe")
    cmd = vm.venv_create_cmd(r"C:\rt\python\python.exe", "p1")
    assert cmd[:4] == [r"C:\rt\uv.exe", "venv", "--seed", "--clear"]
    # py.exe là launcher, uv không dùng được → venv chuẩn
    assert vm.venv_create_cmd(r"C:\Windows\py.exe", "p1")[1:3] == ["-m", "venv"]


def test_install_attempts_uv_then_pip(venv_at, monkeypatch):
    monkeypatch.setattr(vm, "get_uv", lambda: r"C:\rt\uv.exe")
    tools = [name for name, _cmd, _env in vm.install_attempts("p1")]
    assert tools == ["uv", "pip"]
    _, uv_cmd, env = vm.install_attempts("p1")[0]
    assert "--python" in uv_cmd and env["UV_NATIVE_TLS"] == "1"
    monkeypatch.setattr(vm, "get_uv", lambda: None)
    assert [n for n, _c, _e in vm.install_attempts("p1")] == ["pip"]


def test_install_falls_back_to_pip_when_uv_fails(venv_at, monkeypatch):
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd[0])
        return subprocess.CompletedProcess(cmd, 1 if "uv" in cmd[0] else 0, "", "uv: lỗi proxy")

    monkeypatch.setattr(vm, "get_uv", lambda: r"C:\rt\uv.exe")
    monkeypatch.setattr(subprocess, "run", fake_run)
    vm.install_blocking("p1", ["six"])
    assert calls[0].endswith("uv.exe") and calls[1].endswith("python.exe")


@pytest.mark.skipif(not (Path(sys.executable).parent / "uv.exe").is_file(),
                    reason="cần uv trong backend/.venv (requirements-dev.txt)")
def test_real_uv_creates_venv_with_pip_and_installs(venv_at):
    """Chạy THẬT: uv tạo venv (--seed có pip) rồi cài 1 gói nhỏ."""
    vm.create_venv_blocking("p1")
    py = venv_at / "Scripts" / "python.exe"
    assert py.is_file()
    assert subprocess.run([str(py), "-m", "pip", "--version"], capture_output=True).returncode == 0
    vm.install_blocking("p1", ["six==1.17.0"])
    out = subprocess.run([str(py), "-c", "import six; print(six.__version__)"], capture_output=True, text=True)
    assert out.stdout.strip() == "1.17.0"
