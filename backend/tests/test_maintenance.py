"""Bảo trì DB: dọn log run cũ (giữ dòng run) + backup hằng ngày giữ 7 bản."""
import json
import sqlite3
from datetime import datetime, timedelta

from services import maintenance as m


def _db(tmp_path):
    c = sqlite3.connect(tmp_path / "t.db")
    c.execute("CREATE TABLE workflow_run (id TEXT, workflow_id TEXT, started_at TEXT, finished_at TEXT, logs_json TEXT)")
    return c


def _add(c, rid, wf, days_ago, now):
    t = (now - timedelta(days=days_ago)).isoformat(sep=" ")
    c.execute("INSERT INTO workflow_run VALUES (?,?,?,?,?)", (rid, wf, t, t, json.dumps([{"message": "x" * 100}])))


def test_prunes_old_logs_but_keeps_recent_per_workflow_and_rows(tmp_path, monkeypatch):
    now = datetime(2026, 11, 15)
    monkeypatch.setattr(m, "KEEP_RECENT_PER_WORKFLOW", 2)
    c = _db(tmp_path)
    for i in range(4):                        # wf A: 4 run đều cũ → giữ 2 gần nhất
        _add(c, f"a{i}", "A", 40 + i, now)
    _add(c, "b0", "B", 5, now)                # mới → giữ
    _add(c, "b1", "B", 60, now)               # cũ nhưng nằm trong 2 lần gần nhất của B → giữ
    assert m.prune_run_logs(c, now) == 2
    logs = dict(c.execute("SELECT id, logs_json FROM workflow_run"))
    assert len(logs) == 6                                         # không xoá dòng run nào
    pruned = {k for k, v in logs.items() if '"pruned": true' in v}
    assert pruned == {"a2", "a3"}
    note = json.loads(logs["a3"])[0]
    assert note["level"] == "info" and "30" in note["message"]
    assert m.prune_run_logs(c, now) == 0                          # chạy lại không đụng gì


def test_backup_once_per_day_keeps_last_7(tmp_path):
    c = _db(tmp_path)
    _add(c, "r", "A", 0, datetime.now())
    c.commit()
    bdir = tmp_path / "backups"
    for d in range(9):
        m.backup_db(c, bdir, today=datetime(2026, 11, 1) + timedelta(days=d))
    assert m.backup_db(c, bdir, today=datetime(2026, 11, 9)) is None   # hôm nay có rồi
    files = sorted(p.name for p in bdir.glob("pyflow-*.db"))
    assert len(files) == 7 and files[-1] == "pyflow-20261109.db" and files[0] == "pyflow-20261103.db"
    restored = sqlite3.connect(bdir / files[-1])
    assert restored.execute("SELECT count(*) FROM workflow_run").fetchone()[0] == 1
    restored.close()
