"""Hạ tầng test chung.

Chạy: ``.venv\\Scripts\\python.exe -m pytest`` trong thư mục backend/.

``engine`` chạy ``execute_workflow_thread`` THẬT trên một DB SQLite tạm và thư mục
project tạm — không đụng ``backend/data``. Chỉ giả lập những gì cần venv/mạng:
``run_python_block_sync`` (khối Python + các khối sinh script con) và
``ensure_packages``. Nhờ vậy test khoá được hành vi của vòng lặp workflow (rẽ
nhánh, Loop, Queue, Bắt Lỗi, nội suy, đổi tên biến output) — đúng phần dễ vỡ nhất
khi sửa executor.
"""
import copy
import json
import sqlite3
import sys
import threading
import uuid
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services import executor_blocks as eb  # noqa: E402


class Engine:
    """Chạy 1 workflow từ graph, trả về trạng thái cuối + log + các lần gọi khối Python."""

    def __init__(self, tmp_path, monkeypatch):
        self.tmp = tmp_path
        self.db_path = tmp_path / "test.db"
        self.project_dir = tmp_path / "pj_test"
        self.workflow_name = "wf test"
        self.wf_dir = self.project_dir / f"wf_{eb.slugify(self.workflow_name)}"
        self.input_dir = self.wf_dir / "input"
        self.input_dir.mkdir(parents=True)
        # label khối Python -> hàm(input_data, workflow_env) trả (ok, output, error)
        self.python_behaviors = {}
        self.python_calls = []   # [(label, input_data, workflow_env, code)]
        self.logs = []           # [(bid, level, msg, event)]

        with sqlite3.connect(self.db_path) as c:
            c.executescript("""
                CREATE TABLE workflow_run (id TEXT PRIMARY KEY, status TEXT, finished_at TEXT,
                    duration_ms INTEGER, error_message TEXT, triggered_by TEXT);
                CREATE TABLE workflow (id TEXT PRIMARY KEY, name TEXT, listener_on INTEGER);
                CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT);
                CREATE TABLE db_connection (id TEXT PRIMARY KEY, db_type TEXT, host TEXT,
                    port TEXT, username TEXT, password TEXT, dbname TEXT);
                CREATE TABLE cloud_connection (id TEXT PRIMARY KEY, workflow_id TEXT, provider TEXT,
                    label TEXT, account TEXT, refresh_token TEXT);
            """)

        monkeypatch.setattr(eb, "connect_sqlite", lambda **kw: sqlite3.connect(self.db_path))
        monkeypatch.setattr(eb, "get_project_dir", lambda project_id: self.project_dir)
        monkeypatch.setattr(eb, "ensure_packages", lambda *a, **kw: None)
        monkeypatch.setattr(eb, "run_python_block_sync", self._fake_python)

    # ── giả lập ──────────────────────────────────────────────────────
    def _fake_python(self, project_id, block_id, workflow_id, code, input_data, **kw):
        label = kw.get("label") or block_id
        # Khối thật nhận BẢN SAO (JSON qua stdin) tại thời điểm gọi — chụp lại y như vậy,
        # nếu không các khối sau sửa tại chỗ current_input sẽ làm sai số liệu đã ghi.
        input_data = copy.deepcopy(input_data)
        env = copy.deepcopy(dict(kw.get("workflow_env") or {}))
        self.python_calls.append((label, copy.deepcopy(input_data), env, code))
        fn = self.python_behaviors.get(label)
        if fn is None:
            return True, input_data, None, 1
        ok, output, error = fn(input_data, env)
        return ok, output, error, 1

    def _log(self, bid, level, msg, event=None, **kw):
        self.logs.append((bid, level, str(msg), event))

    # ── tiện ích ─────────────────────────────────────────────────────
    def add_db_connection(self, conn_id="conn1", db_type="sqlserver"):
        with sqlite3.connect(self.db_path) as c:
            c.execute("INSERT INTO db_connection VALUES (?,?,?,?,?,?,?)",
                      (conn_id, db_type, "h", "", "u", "p", "d"))
        return conn_id

    def add_cloud_connection(self, conn_id="cc1", provider="google", account="a@congty.vn", token="rt"):
        with sqlite3.connect(self.db_path) as c:
            c.execute("INSERT INTO cloud_connection VALUES (?,?,?,?,?,?)",
                      (conn_id, "wf1", provider, account, account, token))
        return conn_id

    def write_input_json(self, data):
        (self.input_dir / "input.json").write_text(json.dumps(data), encoding="utf-8")

    def run(self, graph, triggered_by="manual", before_start=None):
        run_id = str(uuid.uuid4())
        with sqlite3.connect(self.db_path) as c:
            c.execute("INSERT INTO workflow_run (id, status, triggered_by) VALUES (?, 'running', ?)",
                      (run_id, triggered_by))
        self.run_id = run_id
        stop_event = threading.Event()
        self.stop_event = stop_event
        if before_start:
            before_start(run_id, stop_event)
        eb.execute_workflow_thread(run_id, "proj1", "wf1", self.workflow_name,
                                   json.dumps(graph), self._log, stop_event, language="vi")
        with sqlite3.connect(self.db_path) as c:
            status, error = c.execute(
                "SELECT status, error_message FROM workflow_run WHERE id=?", (run_id,)).fetchone()
        return status, error

    def called(self, label):
        return [c for c in self.python_calls if c[0] == label]

    def log_text(self):
        return "\n".join(m for _, _, m, _ in self.logs)


def graph(nodes, edges):
    """nodes: [(id, type, data)], edges: [(src, tgt)] hoặc [(src, tgt, sourceHandle)]."""
    return {
        "nodes": [{"id": i, "data": {"type": t, "label": i, **(d or {})}} for i, t, d in nodes],
        "edges": [{"source": e[0], "target": e[1], "sourceHandle": e[2] if len(e) > 2 else None}
                  for e in edges],
    }


@pytest.fixture
def engine(tmp_path, monkeypatch):
    return Engine(tmp_path, monkeypatch)
