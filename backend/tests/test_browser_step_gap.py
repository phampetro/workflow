"""Khối Trình duyệt: nghỉ STEP_GAP_SEC sau bước THAO TÁC, không nghỉ sau bước chỉ đọc/chờ.

Chạy Playwright THẬT (headless) trên một trang HTML cục bộ; đếm số lần nghỉ.
"""
import pytest

from services import browser_executor as be


def _chromium_available():
    try:
        return bool(be.find_installed_chromium() or be._find_system_browser())
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _chromium_available(), reason="máy không có Chromium/Chrome")


def test_gap_only_after_interaction_steps(tmp_path, monkeypatch):
    page = tmp_path / "p.html"
    page.write_text('<html><body><input id="q"><p id="t">xin chao</p></body></html>', encoding="utf-8")
    gaps = []
    monkeypatch.setattr(be, "_sleep_unless_stopped", lambda sec, ev: gaps.append(sec) or False)
    steps = [
        {"action": "navigate", "value": page.as_uri()},          # thao tác → nghỉ trước bước 2
        {"action": "get_text", "selector": "#t", "key_name": "a"},  # chỉ đọc → không nghỉ trước bước 3
        {"action": "fill", "selector": "#q", "value": "abc"},  # bước 3 (thao tác)
        {"action": "wait", "value": "0"},                     # "Dừng chờ": không cộng thêm nghỉ
        {"action": "get_url", "key_name": "u"},               # sau wait (bị động) → không nghỉ
    ]
    try:
        res = be.run_browser_block("b1", "wf", "run-gap-test", steps, headless=True, output_dir=str(tmp_path))
    finally:
        be.cleanup_browser("run-gap-test")
    assert res["success"], res
    assert res["output_data"]["a"] == "xin chao"
    # nghỉ: trước bước 2 (sau navigate). Trước bước 3: không (sau get_text). Trước bước 4:
    # không (bước wait). Trước bước 5: không (sau wait). → đúng 1 lần.
    assert gaps == [be.STEP_GAP_SEC]
