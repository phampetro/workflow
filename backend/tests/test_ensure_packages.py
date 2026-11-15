"""ensure_packages: nhớ kết quả kiểm gói theo venv; thời gian chờ/nút Dừng có tác dụng thật."""
import subprocess
import sys
import threading
import time

import pytest

from services import executor_blocks as eb


@pytest.fixture
def fake_venv(tmp_path, monkeypatch):
    sp = tmp_path / ".venv" / "Lib" / "site-packages"
    sp.mkdir(parents=True)
    monkeypatch.setattr(eb, "venv_exists", lambda pid: True)
    monkeypatch.setattr(eb.venv_manager, "get_venv_path", lambda pid: tmp_path / ".venv")
    monkeypatch.setattr(eb, "get_pip_cmd", lambda pid: ["pip"])
    eb._pkg_ok_cache.clear()
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, "openpyxl==3.1.5\npandas==3.0.3\n", "")
    monkeypatch.setattr(eb.subprocess, "run", fake_run)
    return sp, calls


def test_second_run_skips_pip_freeze(fake_venv):
    _sp, calls = fake_venv
    eb.ensure_packages("p", ["openpyxl", "pandas"])
    eb.ensure_packages("p", ["openpyxl"])
    eb.ensure_packages("p", ["pandas==3.0.3"])
    assert len(calls) == 1


def test_venv_change_triggers_recheck(fake_venv):
    sp, calls = fake_venv
    eb.ensure_packages("p", ["openpyxl"])
    time.sleep(0.05)
    (sp / "newpkg").mkdir()              # cài gói mới → mtime site-packages đổi
    eb.ensure_packages("p", ["openpyxl"])
    assert len(calls) == 2


def test_new_package_not_in_cache_is_checked(fake_venv):
    _sp, calls = fake_venv
    eb.ensure_packages("p", ["openpyxl"])
    eb.ensure_packages("p", ["pandas"])
    assert len(calls) == 2


SILENT = [sys.executable, "-c", "import time; time.sleep(60)", "--"]   # treo, không in gì


def test_install_idle_timeout_fires_even_without_output():
    t0 = time.time()
    with pytest.raises(RuntimeError, match="timeout"):
        eb._stream_install(SILENT, [], None, "b", "pip", None, "vi", idle_timeout=1)
    assert time.time() - t0 < 10


def test_stop_button_works_while_installer_is_silent():
    stop = threading.Event()
    threading.Timer(0.8, stop.set).start()
    t0 = time.time()
    with pytest.raises(RuntimeError, match="stopped"):
        eb._stream_install(SILENT, [], None, "b", "pip", stop, "vi", idle_timeout=300)
    assert time.time() - t0 < 10
