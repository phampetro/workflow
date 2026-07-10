# PyFlow Studio — README

## Giới thiệu
Nền tảng tự động hóa workflow với Python blocks, đặt lịch cron, quản lý virtual environment per project, chạy local.

## Cấu trúc
```
workflow/
├── start.bat              ← Khởi động toàn bộ (DÙNG CÁI NÀY)
├── frontend/              ← React + Vite UI (port 5173)
│   └── src/
│       ├── pages/         ← Dashboard, ProjectDetail, WorkflowEditor
│       ├── components/    ← BlockNode, LogViewer, SchedulerPanel, BlockEditorModal
│       ├── store/         ← Zustand state
│       └── api/           ← Axios client
├── backend/               ← Flask Python API (port 8000)
│   ├── main.py            ← Toàn bộ backend (API + Scheduler + Executor)
│   ├── data/
│   │   ├── pyflow.db      ← SQLite database
│   │   └── envs/          ← Virtual envs per project
│   └── start.bat          ← Khởi động backend riêng lẻ
```

## Khởi động

### Cách 1: Chạy cả 2 cùng lúc (khuyến nghị)
```
Double-click: start.bat
```

### Cách 2: Chạy riêng lẻ
**Backend:**
```bash
cd backend
.venv\Scripts\python main.py
```

**Frontend:**
```bash
cd frontend
npm run dev
```

## API Endpoints

| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/health` | Health check |
| GET/POST | `/api/projects` | Quản lý projects |
| GET/PUT/DELETE | `/api/projects/{id}` | Project CRUD |
| GET/POST | `/api/projects/{id}/workflows` | Workflows của project |
| GET/PUT/DELETE | `/api/workflows/{id}` | Workflow CRUD |
| POST | `/api/workflows/{id}/run` | Chạy workflow |
| POST | `/api/workflows/{id}/stop` | Dừng workflow |
| GET | `/api/workflows/{id}/runs` | Lịch sử chạy |
| GET | `/api/runs/{run_id}/logs/stream` | SSE log streaming |
| GET/POST | `/api/workflows/{id}/schedules` | Quản lý lịch |
| PATCH | `/api/schedules/{id}/toggle` | Bật/tắt lịch |
| GET | `/api/projects/{id}/packages` | Xem packages |
| POST | `/api/projects/{id}/packages/install` | Cài package |
| POST | `/api/projects/{id}/packages/uninstall` | Gỡ package |

## Yêu cầu hệ thống
- Python 3.8+ (đã test với 3.14)
- Node.js 18+
- Windows hoặc macOS
