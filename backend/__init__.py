"""
PyFlow Studio — Backend
Cấu trúc thư mục:
backend/
├── main.py                  ← FastAPI app entry
├── database.py              ← SQLite + SQLModel setup
├── models.py                ← Data models
├── routers/
│   ├── projects.py          ← Projects CRUD
│   ├── workflows.py         ← Workflows CRUD
│   ├── schedule_endpoints.py← Schedule management
│   ├── dashboard.py         ← Dashboard stats
│   ├── files.py             ← Workflow input/output files
│   └── users.py             ← Multi-user support
├── services/
│   ├── venv_manager.py      ← Virtual env per project
│   ├── executor.py          ← Python block execution engine
│   ├── executor_blocks.py   ← Block-type implementations
│   ├── export_import.py     ← Project/workflow export-import
│   ├── telegram_listener.py ← Telegram bot trigger listener
│   ├── browser_executor.py  ← Browser automation blocks
│   └── scheduler.py         ← APScheduler service
└── ws/
    └── log_socket.py        ← Live run log streaming (SSE)
"""
