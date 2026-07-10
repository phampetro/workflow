"""
PyFlow Studio — Backend
Cấu trúc thư mục:
backend/
├── main.py              ← FastAPI app entry
├── database.py          ← SQLite + SQLModel setup
├── models.py            ← Data models
├── routers/
│   ├── projects.py      ← Projects CRUD
│   ├── workflows.py     ← Workflows CRUD
│   ├── schedules.py     ← Schedule management
│   └── runs.py          ← Run history
├── services/
│   ├── venv_manager.py  ← Virtual env per project
│   ├── executor.py      ← Python block execution engine
│   └── scheduler.py     ← APScheduler service
└── ws/
    └── log_socket.py    ← WebSocket log streaming
"""
