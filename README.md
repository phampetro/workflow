# PyFlow Studio

Nền tảng tự động hóa workflow chạy **local** trên máy người dùng: kéo-thả các khối (Python, SQL, Excel, Telegram, Browser…), nối lại thành sơ đồ, đặt lịch cron / trigger qua Telegram, chạy trong virtual environment riêng cho từng project.

- **Backend**: FastAPI + SQLAlchemy async + APScheduler + Playwright, dữ liệu ở SQLite.
- **Frontend**: React 19 + Vite + Ant Design 6 + React Flow (@xyflow/react) + Zustand.
- **Kênh realtime**: Server-Sent Events (SSE) cho log workflow đang chạy.
- **Trạng thái deploy**: chạy 1 process uvicorn duy nhất trên `127.0.0.1:7000`, không đứng sau reverse proxy, không multi-worker. Frontend Vite dev server ở `127.0.0.1:9000`.

---

## 📇 Bảng tổng quan (đọc trước khi làm gì)

| Khía cạnh | Sự thật |
|---|---|
| Ngôn ngữ | Backend Python 3.8+ (test 3.14), Frontend Node 18+ |
| Server model | Single-process, single-loop uvicorn — KHÔNG multi-worker |
| Auth | Header `X-User-Id` từ localStorage, không session/token — dùng cho local, không public |
| DB | SQLite `backend/data/pyflow.db` — dev tự migrate cột mới ở startup ([database.py:30](backend/database.py:30)) |
| Data dir | `backend/data/pj_{slug}/wf_{slug}/{input,output}/` + `.venv/` per project |
| Port | BE `7000`, FE `9000` (đổi ở [.claude/launch.json](.claude/launch.json), [vite.config.js](frontend/vite.config.js), 4 file FE, [backend/main.py](backend/main.py), 3 startup script) |
| Multi-user | Có bảng `user`, cột `is_active` — **chỉ user active mới có schedule + Telegram Listener chạy** ([main.py:35](backend/main.py:35), [users.py:85](backend/routers/users.py:85)) |
| Recovery | Startup mark run RUNNING mồ côi thành ERROR + auto bật lại Telegram Listener theo cờ `workflow.listener_on` |
| Realtime log | SSE `/api/runs/{run_id}/logs/stream` — client auto-reconnect với `offset` để không mất log |
| Cross-tab sync | `BroadcastChannel('pyflow_active_runs')` đồng bộ trạng thái Chạy/Dừng giữa các tab cùng origin |
| ORM | SQLAlchemy 2.x async cho API, `sqlite3` sync cho executor thread (2 kênh song song trên cùng file DB) |

---

## 🚀 Cài đặt & khởi động

### Cài lần đầu

```bash
# Windows
setup.bat

# macOS/Linux
./setup.sh
```

Setup tạo `backend/.venv`, cài `requirements.txt`, cài Chromium cho Playwright, chạy `npm install` cho frontend.

### Khởi động

```bash
# Windows (mở 2 cửa sổ cmd)
start.bat

# Windows chạy ẩn (chạy nền, không mở cửa sổ)
wscript start_hide.vbs

# macOS/Linux
./start.sh
```

Cả 3 script đều: giải phóng port 7000 + 9000 → khởi BE → khởi FE → mở trình duyệt tới `http://localhost:9000`.

### Cập nhật (git pull + reinstall + restart)

```bash
update_and_restart.bat  # Windows
./update_and_restart.sh # Linux/Mac
```

---

## 📂 Cấu trúc thư mục

```
workflow/
├── setup.bat / setup.sh              ← Cài venv + pip + npm install lần đầu
├── start.bat / start.sh              ← Khởi động BE + FE (kèm giải phóng port)
├── start_hide.vbs                    ← Chạy ẩn trên Windows (background)
├── update_and_restart.{bat,sh}       ← git pull + reinstall + restart
├── .claude/
│   └── launch.json                   ← Cấu hình dev-server cho Claude Code preview
│
├── backend/                          ← FastAPI backend (Python)
│   ├── main.py                       ← Entry: lifespan (init_db, cleanup_stuck_runs,
│   │                                     reload_schedules, reload_telegram_listeners),
│   │                                     CORS, mount routers, uvicorn on 7000
│   ├── database.py                   ← Async engine + auto-migration (thêm cột thiếu)
│   ├── models.py                     ← SQLAlchemy models: User, Project, Workflow,
│   │                                     Schedule, WorkflowRun, Setting, DbConnection
│   ├── requirements.txt
│   ├── .venv/                        ← Virtual env của chính backend (không phải per-project)
│   │
│   ├── routers/                      ← HTTP endpoints (theo tài nguyên)
│   │   ├── users.py                  ← User CRUD + activate_user (reload lịch/listener)
│   │   ├── projects.py               ← Project CRUD + rename folder khi đổi tên
│   │   ├── workflows.py              ← Workflow CRUD + run/stop + ETag save +
│   │   │                                _stop_and_wait_workflow_runs + SSE stream
│   │   ├── files.py                  ← Upload/download input/output file
│   │   ├── database.py               ← DB connection CRUD + test connection
│   │   ├── schedule_endpoints.py     ← Schedule CRUD + toggle (bật/tắt)
│   │   ├── dashboard.py              ← Thống kê tổng hợp
│   │   ├── ai_codegen.py             ← Stream code Python từ LLM (OpenAI-compatible)
│   │   └── system.py                 ← Info app + check update + auto-update
│   │
│   ├── services/                     ← Nghiệp vụ (không lộ HTTP)
│   │   ├── executor.py               ← Bridge async ↔ thread; sở hữu
│   │   │                                ThreadPoolExecutor(max_workers=256) riêng
│   │   ├── executor_blocks.py        ← 2000+ dòng: dispatch từng btype trong queue,
│   │   │                                nội suy {{var}}, cập nhật workflow_env,
│   │   │                                gọi _finish_run, quản lý listener flag
│   │   ├── browser_executor.py       ← Playwright: chạy các step Browser
│   │   ├── telegram_listener.py      ← httpx long-polling getUpdates + trigger workflow
│   │   ├── scheduler.py              ← APScheduler (AsyncIOScheduler) + build_cron_trigger
│   │   ├── venv_manager.py           ← Tạo/xóa/rename thư mục pj_{slug}/wf_{slug}/.venv
│   │   └── export_import.py          ← Zip in/out project & workflow (kèm remap DbConnection)
│   │
│   ├── ws/
│   │   └── log_socket.py             ← In-memory pub/sub log (subscribe/broadcast/history)
│   │
│   └── data/                         ← ⚠ Sinh khi chạy, không commit
│       ├── pyflow.db                 ← SQLite chính (users, projects, workflows, runs,
│       │                                schedules, db_connection, setting)
│       └── pj_{slug}/                ← 1 thư mục per project (slug từ tên project)
│           ├── .venv/                ← Virtual env riêng của project (dùng cho khối Python)
│           └── wf_{slug}/            ← 1 thư mục per workflow
│               ├── input/            ← File input người dùng upload + input.json (env vars)
│               └── output/           ← File do khối sinh ra (excel merged, screenshot…)
│
└── frontend/                         ← React + Vite
    ├── vite.config.js                ← Port 9000, inject __APP_UPDATED_AT__ từ git log
    ├── package.json                  ← antd 6, @xyflow/react 12, monaco-editor, zustand
    ├── index.html
    └── src/
        ├── main.jsx                  ← ReactDOM + StrictMode + ConfigProvider antd
        ├── App.jsx                   ← Router + user picker + theme
        │
        ├── pages/
        │   ├── Dashboard.jsx         ← Grid projects, tạo/import/export/xóa project
        │   ├── ProjectDetail.jsx     ← Danh sách workflow trong project + venv/packages
        │   └── WorkflowEditor.jsx    ← Canvas React Flow, autosave debounce 1.5s,
        │                                Chạy/Dừng, mở Logs/Scheduler/History
        │
        ├── components/
        │   ├── BlockNode.jsx         ← Node hiển thị trên canvas (16 loại khối)
        │   ├── BlockEditorModal.jsx  ← 2000+ dòng: form cấu hình từng loại khối
        │   ├── LogViewer.jsx         ← Drawer SSE log (auto-scroll, download log)
        │   ├── SchedulerPanel.jsx    ← Drawer quản lý cron schedule + banner user-active
        │   ├── WorkflowHistoryPanel.jsx  ← Bảng lịch sử run + tag trạng thái
        │   ├── InputJsonModal.jsx    ← Sửa input.json (env vars) + upload input file
        │   ├── UserPickerModal.jsx   ← Chọn/tạo/xóa user + activate (đổi workspace)
        │   ├── AiSettingsModal.jsx   ← Cấu hình LLM cho AI codegen
        │   ├── AboutModal.jsx        ← Version, check update, chạy update
        │   ├── DeleteEdge.jsx        ← Custom edge có nút xóa
        │   └── Navbar.jsx
        │
        ├── api/
        │   └── client.js             ← axios instance baseURL=7000 +
        │                                createLogStream (SSE auto-reconnect) +
        │                                streamAiCodegen (POST fetch + ReadableStream)
        │
        ├── store/
        │   └── useStore.js           ← Zustand: currentUser, activeRuns, runLogs +
        │                                BroadcastChannel liên-tab
        │
        ├── hooks/
        │   └── useUndoRedo.js        ← Snapshot nodes/edges cho Ctrl+Z / Ctrl+Y
        │
        └── config/
            └── appInfo.js            ← Tên, version, link repo
```

---

## 🏗 Kiến trúc & luồng chạy

```
┌───────────────────────────┐          ┌────────────────────────────────────────┐
│  Browser (localhost:9000) │  HTTP    │  FastAPI (localhost:7000, single-loop) │
│  React + Vite + Antd 6    │◄────────►│  routers/*.py  → services/*.py         │
│                           │  SSE     │                                        │
│  BroadcastChannel liên-tab│◄────────►│  ws/log_socket.py (pub/sub in-memory)  │
└───────────────────────────┘          │                                        │
                                       │  ┌──────────────────────────────────┐  │
                                       │  │ APScheduler (in-memory, load     │  │
                                       │  │ khi startup từ Schedule DB)      │  │
                                       │  └──────────────────────────────────┘  │
                                       │  ┌──────────────────────────────────┐  │
                                       │  │ Telegram Listener (task riêng    │  │
                                       │  │ per workflow, httpx long-poll)   │  │
                                       │  └──────────────────────────────────┘  │
                                       │  ┌──────────────────────────────────┐  │
                                       │  │ ThreadPoolExecutor(max=256)      │  │
                                       │  │ chạy execute_workflow_thread     │  │
                                       │  │ (dispatch từng khối theo queue)  │  │
                                       │  └──────────────────────────────────┘  │
                                       └────────────────┬───────────────────────┘
                                                        │
                                                        ▼
                                    ┌───────────────────────────────────┐
                                    │  SQLite  backend/data/pyflow.db   │
                                    │  Files   backend/data/pj_*/wf_*/  │
                                    └───────────────────────────────────┘
```

### Vòng đời 1 lần chạy (run) workflow

1. **Trigger**: người dùng bấm Chạy (`POST /api/workflows/{id}/run`), APScheduler đến giờ, hoặc Telegram Listener nhận tin nhắn khớp lệnh có `runWorkflow=True`.
2. Router tạo `WorkflowRun(status=RUNNING)` trong DB, cấp `run_id`, tạo `asyncio.Event` làm stop-flag, lưu vào `_stop_flags[run_id]` và `_workflow_run_ids[workflow_id]`.
3. `execute_workflow` gọi `loop.run_in_executor(_WORKFLOW_EXECUTOR, execute_workflow_thread, …)` — chạy trong ThreadPoolExecutor **riêng 256 worker** (không dùng default pool, tránh listener idle làm cạn).
4. `execute_workflow_thread` (sync, trong thread):
   - Đọc `graph_json` (JSON reactflow), build queue BFS bắt đầu từ node `start` (hoặc `telegram_listener` nếu run được kích hoạt bởi tin nhắn).
   - Vòng `while queue:` — pop 1 node, nội suy `{{var}}` từ `workflow_env`, dispatch theo `btype`, log qua `sync_log_cb` (bridge về loop chính bằng `run_coroutine_threadsafe`).
   - Sau mỗi khối: gộp `current_input` (nếu là dict) vào `workflow_env` để `{{var}}` ở khối sau đọc được.
   - Vòng lặp thoát khi: gặp `end` (`break`), queue rỗng, `stop_event.is_set()`, hoặc lỗi.
5. `_finish_run(run_id, status)`: UPDATE `workflow_run` DB (sync sqlite3), dọn khỏi 3 dict toàn cục.
6. Router (async) trong `finally`: đọc log từ `_run_history[run_id]` ghi vào cột `logs_json` DB để xem lại sau, gọi `cleanup_log(run_id)` xoá cache.

### Realtime log

- `broadcast_log(run_id, block_id, level, msg)` (log_socket.py) làm 2 việc: append vào `_run_history[run_id]` (list) + put vào mọi `asyncio.Queue` đã `subscribe(run_id)`.
- Endpoint SSE `GET /api/runs/{run_id}/logs/stream?offset=N`: prefill queue với `history[offset:]` (không mất log dù kết nối sau), rồi await queue liên tục.
- FE `createLogStream` (client.js): đếm `received`, khi `onerror` **không** đóng cứng (khác EventSource default) mà tự reconnect sau 3s với `offset += received` — sống sót qua drop kết nối tạm.

---

## 🧩 Các khối Workflow (Block Types)

Hiện có **16 loại khối** (`btype`) được xử lý trong `backend/services/executor_blocks.py`, cộng thêm 1 loại đặc biệt (`error_trigger`) không nằm trong luồng chạy chính mà chỉ được kích hoạt khi có lỗi.

> Quy ước: `current_input` là dữ liệu đầu vào khối nhận được (từ khối nối trước nó); sau khi khối chạy, giá trị mới gán cho `current_input` sẽ là dữ liệu truyền tiếp cho khối kế tiếp theo cạnh nối. Nhiều khối gọi biến này là `output_data` bên trong code/script do chính khối đó sinh ra.

### 1. `start` — Bắt đầu workflow
Chỉ log, không đụng vào dữ liệu. **`current_input` giữ nguyên y hệt lúc vào** (thường là input ban đầu của lần chạy, hoặc `_initial_input` nếu chạy từ Telegram Listener).

### 2. `end` — Kết thúc workflow
Log rồi dừng vòng lặp ngay. Không có biến trả về vì workflow dừng tại đây. Khối này **không bắt buộc** — queue rỗng tự nhiên (chạy tới node cuối, không còn edge) cũng kết thúc workflow và giải phóng tài nguyên đầy đủ như `end`. Chỉ dùng khi cần cắt sớm giữa chừng (đặc biệt trong nhánh điều kiện: `end` `break` cả các nhánh song song đang chờ trong queue).

### 3. `delay` — Dừng chờ N giây
Chỉ `time.sleep`, có kiểm tra dừng sớm mỗi 0.5s. **`current_input` giữ nguyên**, không thêm/bớt key nào.

### 4. `telegram_listener` — Lắng nghe lệnh Telegram
Khi có tin nhắn khớp lệnh cấu hình, workflow được kích hoạt lại với:
```json
{
  "chat_id": "id của chat gửi tin nhắn",
  "message_id": "id tin nhắn Telegram",
  "text": "nội dung tin nhắn (chuỗi text người dùng gõ)",
  "sender_name": "first_name của người gửi (rỗng nếu không lấy được)",
  "raw_message": "toàn bộ JSON message gốc do Telegram trả về"
}
```
Không có key `command` — tên lệnh khớp (`/xxx`) chỉ dùng nội bộ để định tuyến, **không** được đưa vào biến trả về. Muốn biết lệnh nào đã gõ, tự tách từ `{{text}}` hoặc đọc trong `raw_message`.

Khi chạy thủ công (bấm nút Chạy, không phải do tin nhắn): chỉ bật listener nền, workflow treo ở trạng thái RUNNING chờ tin nhắn (poll `stop_event` mỗi 0.5s). Khi user Dừng → set cờ `workflow.listener_on = False` trong DB, stop listener, thoát vòng.

Có **4 field đặt tên biến riêng** cho 4 giá trị chính (`raw_message` là blob JSON nên không có field): mặc định điền sẵn **trùng tên biến trả về**. Nếu workflow có nhiều listener và cần tránh trùng, tự đổi tên.

### 5. `telegram` — Gửi/Sửa/Trả lời tin nhắn Telegram
Sau khi gửi thành công, **chỉ 2 key được thêm/ghi đè**, mọi key khác trong `current_input` cũ được giữ nguyên:
- `sent_message_id`: id tin nhắn (hoặc file) vừa gửi/sửa ra.
- `chat_id`: id chat đích vừa gửi tới.

Nếu `current_input` trước đó **không phải object** (null hoặc chuỗi/số), toàn bộ bị thay bằng:
```json
{ "sent_message_id": "...", "message_id": "... (giống sent_message_id)", "chat_id": "..." }
```

Có **2 field đặt tên biến riêng**: mặc định trùng `sent_message_id` / `chat_id`.

### 6. `email` — Gửi Email SMTP
Chỉ gửi mail, log kết quả. **`current_input` không đổi**, dù thành công hay thất bại.

### 7. `delete_files` — Xóa tập tin Input/Output
Xóa file theo cấu hình (`delete_input`, `delete_output` — bool). **`current_input` không đổi**. Không xóa `input.json`.

### 8. `browser` — Tự động hóa trình duyệt (Playwright)
Mỗi bước (step) trong cấu hình có 1 field `key_name` (tên biến bạn tự đặt) quyết định key nào sẽ được set trong kết quả trả về. Loại bước ghi dữ liệu ra biến (các bước khác như click/fill/wait không ghi gì):

| Action của bước | Giá trị ghi vào `key_name` |
|---|---|
| `get_text` | Chuỗi text lấy được từ phần tử (đã strip) |
| `get_attribute` | Giá trị của attribute HTML được chỉ định |
| `get_all_text` | Mảng chuỗi text của tất cả phần tử khớp selector |
| `get_url` | URL hiện tại của trang |
| `screenshot` | Chuỗi base64 `data:image/png;base64,...` (ảnh chụp toàn trang) |
| `evaluate_js` | Kết quả trả về của đoạn JavaScript (`page.evaluate`) |
| `click_and_download` | Đường dẫn tuyệt đối file vừa tải về (lưu trong Output) |

Toàn bộ các `key_name` này được gộp thành 1 dict rồi **merge vào `current_input` cũ** — giữ lại key cũ (như `chat_id`, `sent_message_id` từ khối Telegram trước), key trùng tên bị ghi đè bởi giá trị mới.

### 9. `python` — Chạy code Python tùy ý
Script nhận biến `input_data` (deserialize từ JSON, chính là `current_input` của khối trước), có thể gán bất kỳ giá trị nào vào `output_data`. Sau khi chạy xong, hệ thống `json.dumps(output_data)` rồi gán ngược thành `current_input` cho khối kế. **Nếu không gán `output_data`** → mặc định `None` → khối kế nhận `current_input = None`. Cấu trúc biến trả về hoàn toàn do người dùng quyết định qua code.

Code chạy trong `.venv` của project (subprocess `python -c` từ `backend/data/pj_{slug}/.venv/`). Muốn dùng thư viện: cài vào venv qua tab "Packages" trong Project Detail.

### 10. `sql_to_excel` — SQL → Excel
```json
{ "file_name": "sqltoexcel.xlsx" }
```
File luôn lưu vào thư mục Output. Field "Lưu tên file kết quả vào biến" mặc định trùng `file_name`.

### 11. `merge_excel` — Ghép nhiều Excel
```json
{ "file_name": "merged.xlsx" }
```
File luôn lưu vào Output. Mặc định biến `file_name`.

### 12. `pivot_excel` — Tổng hợp Pivot
```json
{ "file_name": "pivot.xlsx" }
```

### 13. `excel_to_sql` — Import Excel → SQL
```json
{ "rows_inserted": 123, "table": "ten_bang_sql" }
```
Có **2 field đặt tên biến riêng**: "Lưu số dòng đã import" (mặc định `rows_inserted`), "Lưu tên bảng đích" (mặc định `table`). Để trống thì chỉ bỏ qua việc lưu biến toàn cục, `current_input` vẫn luôn có đủ.

### 14. `run_sql_exec` — Chạy Hàm SQL (EXEC / stored procedure)
```json
{
  "result": [{"col1": "..."}],
  "row_count": 5
}
```
Có **2 field đặt tên biến riêng**: mặc định `result` / `row_count`.

### 15. `condition` — Rẽ nhánh điều kiện
**`current_input` hoàn toàn không bị đụng** — khối chỉ ĐỌC các key trong `current_input` hiện có để so sánh (theo `condVariable` bạn khai), rồi chọn cạnh ra `true`/`false`. Dữ liệu truyền tiếp y hệt lúc vào.

### 16. `loop` — Vòng lặp
Nếu `current_input` trước đó không phải object, bọc thành `{"previous_input": <giá trị cũ>}`. Luôn ghi đè thêm 1 key:
```json
{ "...(các key cũ giữ nguyên)...", "loop_iteration": 3 }
```
Quyết định đi nhánh `loop` (lặp) hay `endloop` (thoát) dựa theo số lần chạy hoặc điều kiện. `loopDelay` giữa các vòng đã chia nhỏ 0.5s để bấm Dừng phản hồi ngay, không đợi hết delay.

### `error_trigger` — Bắt Lỗi toàn cục (không nằm trong luồng chính)
Không dispatch trong queue bình thường — chỉ tự kích hoạt khi có khối khác gặp lỗi (nếu đã nối). Toàn bộ dữ liệu hiện có **bị thay thế hoàn toàn**:
```json
{
  "status": "error",
  "error_detail": "traceback / message",
  "failed_block": "label khối gây lỗi",
  "failed_block_id": "id khối gây lỗi"
}
```

> Từ khi có "Kết nối Database dùng chung", khối **Database** cũ đã **xóa bỏ** — 3 khối SQL giờ tự chọn kết nối trực tiếp trong cấu hình của chính nó.

---

## 🌍 Biến toàn cục (`{{var}}` & `workflow_env`)

Có **2 cơ chế truyền dữ liệu khác nhau** giữa các khối trong cùng 1 lần chạy — cần phân biệt rõ:

### 1. `workflow_env` — biến toàn cục thực sự (dùng cho `{{ten_bien}}`)
- Khởi tạo từ nội dung khai ở **"Dữ liệu Workflow" → tab Biến môi trường** (file `backend/data/pj_*/wf_*/input/input.json`).
- Sau khi **MỖI khối chạy xong** (không phân biệt loại), toàn bộ key trong biến trả về (nếu là dict) được **gộp thẳng vào `workflow_env`**.
- Dùng để thay thế `{{ten_bien}}` ở **bất kỳ ô cấu hình nào của bất kỳ khối nào sau đó** trong cùng lần chạy — không cần nối trực tiếp.
- **Nội suy an toàn**: dùng `re.sub(r"\{\{(\w+)\}\}", …)` 1 lượt duy nhất (thay từ trái sang phải, giá trị được thay KHÔNG bị scan lại). Trước đây for-loop replace bị chain-replace, giá trị của `k1` chứa chuỗi `{{k2}}` sẽ bị thay tiếp — nay đã cố định.
- **Lưu ý**: nếu 2 khối cùng trả về key trùng tên (nhiều khối `telegram` đều có `chat_id`, nhiều `excel_to_sql` đều có `table`), giá trị dùng cho `{{chat_id}}`/`{{table}}` ở các khối sau sẽ luôn là của **khối chạy gần nhất**. Muốn tránh — đặt tên biến riêng (mục 3).

### 2. `current_input` — chỉ truyền theo cạnh nối (KHÔNG toàn cục)
- Biến `input_data` trong 1 khối Python chỉ là **output của khối nối trực tiếp phía trước** (theo cạnh trong sơ đồ).
- Không liên quan `workflow_env` — nếu khối không nối trực tiếp sau khối cần dữ liệu, `input_data` sẽ không có gì.

### 3. Đặt tên biến riêng để tránh bị ghi đè

Cơ chế `{{...}}` **không hỗ trợ truy cập field con** kiểu `{{ten_bien.field}}` — nên các khối có nhiều giá trị đều có nhiều field đặt tên (1 field / 1 giá trị) thay vì 1 field bọc nguyên object:

| Khối | Field đặt tên | Mặc định (trùng tên biến trả về) |
|---|---|---|
| `sql_to_excel` | Lưu tên file kết quả | `file_name` |
| `merge_excel` | Lưu tên file kết quả | `file_name` |
| `pivot_excel` | Lưu tên file kết quả | `file_name` |
| `excel_to_sql` | Lưu số dòng / Lưu tên bảng | `rows_inserted` / `table` |
| `run_sql_exec` | Lưu kết quả / Lưu số dòng | `result` / `row_count` |
| `telegram` | Lưu sent_message_id / chat_id | `sent_message_id` / `chat_id` |
| `telegram_listener` | Lưu chat_id / message_id / text / sender_name | `chat_id` / `message_id` / `text` / `sender_name` |

- Mặc định điền sẵn **trùng tên biến trả về thật** — dễ nhớ, khớp tài liệu; nhưng nếu dùng nhiều khối cùng loại thì vẫn đè nhau. Muốn tránh — tự đổi thành tên riêng (`table_don_hang`, `table_khach_hang`…).
- Trong UI, các field đặt tên luôn **ở cuối cấu hình** để không lẫn với field chính.
- Khối `browser` **không có field này** — mỗi step đã có `key_name` (cấp độ từng bước thay vì cấp độ khối).
- Khối `condition` và `python` **không có** — Condition chỉ đọc theo `current_input`; Python chỉ nhận `input_data` từ khối liền trước, không đọc được biến đặt tên qua `workflow_env`.

---

## 🔌 Kết nối Database dùng chung

- Quản lý ở **"Dữ liệu Workflow" → tab Database**: thêm/sửa/xóa nhiều kết nối, có "Test kết nối" trước khi lưu.
- Lưu ở bảng `db_connection` (SQLite) — không lưu trong `input.json` để tránh lẫn với gợi ý `{{...}}`.
- 3 khối `sql_to_excel`, `excel_to_sql`, `run_sql_exec` đều có field bắt buộc **"Kết nối Database"** — chọn từ danh sách đã lưu, mỗi khối kết nối độc lập.
- **Scope theo từng workflow** (`db_connection.workflow_id`). Đánh đổi: nhiều workflow trong 1 project dùng chung 1 DB phải khai riêng cho từng workflow. Đổi lại, **Export/Import** tự động mang theo đúng kết nối của từng workflow và **remap `savedConnectionId`** sang id mới khi import — không cần cấu hình lại tay khi chuyển máy/project (xem [export_import.py](backend/services/export_import.py)).

---

## 👥 Multi-user & workspace

Ứng dụng có bảng `user` với cột `is_active`, hoạt động như "workspace switching":

- Chỉ **1 user active** tại một thời điểm. FE lưu `currentUser` ở `localStorage`, gắn header `X-User-Id` vào mọi request qua axios interceptor.
- API `list_projects` filter theo `X-User-Id` — mỗi user chỉ thấy project của mình.
- Khi bấm activate 1 user (`POST /api/users/{id}/activate`):
  1. Dừng mọi Telegram Listener của user cũ (mọi wf_id trong `_active_listeners`).
  2. Xóa toàn bộ APScheduler job (`remove_all_jobs`).
  3. Nạp lại **schedule + listener của user mới** (JOIN `Project.user_id == active_user.id`).
  4. Trả `{schedules_loaded, listeners_loaded}` cho FE hiển thị toast.
- Khi restart backend, [main.py:lifespan](backend/main.py) chỉ nạp schedule + listener của **user đang `is_active=True`** — user active không bị mất khi tắt trình duyệt / restart máy.
- **UI hint**: khi hệ thống có ≥2 user, SchedulerPanel hiện Alert xanh thông báo "Lịch chỉ chạy khi user X đang active".

⚠ **Auth**: `X-User-Id` chỉ là header thuần, không có session/token/password. **Ứng dụng dành cho local**, không được deploy public. CORS whitelist chỉ `localhost:9000`.

---

## 📅 Scheduler

- APScheduler `AsyncIOScheduler`, in-memory jobstore. State không lưu ở APScheduler — luôn nạp lại từ bảng `schedule` DB khi cần.
- `cron_expr` lưu dạng **JSON**:
  ```json
  {"schedule_type":"week","hour":"08","minute":"00","days":["mon","tue"],"start_date":"...","end_date":"..."}
  ```
  Chuỗi cron chuẩn "phút giờ ngày tháng thứ" vẫn được hỗ trợ để tương thích ngược ([scheduler.py:52](backend/services/scheduler.py:52)).
- Job wrapper: `trigger_workflow_job → trigger_workflow_from_scheduler` — **skip nếu còn run RUNNING** cho workflow đó (chống chồng chéo khi cron dày hơn thời gian workflow chạy). Ghi log cảnh báo, không tạo run mới.
- Sau mỗi lần chạy, `_record_schedule_run` UPDATE `last_run_at` + `next_run_at`.

---

## 🤖 Telegram Listener

- 1 task asyncio per workflow, chạy trong thread riêng với event loop mới (không dùng loop chính của uvicorn).
- `httpx` long-poll `getUpdates?timeout=30`; bỏ qua backlog tin nhắn tồn đọng khi khởi động (`offset=-1`) — tránh restart BE chạy lại hàng loạt tin cũ.
- Khớp tin nhắn: ưu tiên lệnh cụ thể (`/xxx`), wildcard (`*`/`""`) làm fallback. `runWorkflow=false` chỉ reply, không kích hoạt.
- **Persist qua restart**: cột `workflow.listener_on` (bool) được set True khi khối `telegram_listener` bật listener, False khi Dừng. Startup `reload_telegram_listeners` (main.py:35+) reset cờ + trigger lại các listener của user active.
- **Đổi Bot Token / commands giữa chừng có tác dụng**: khi rerun workflow, executor so `get_listener_config(wf_id)` với config mới — khác thì `stop_telegram_listener` rồi start lại với config mới. (Trước đây không, phải Dừng tay rồi Chạy lại.)

---

## 🌐 API Endpoints (tổng hợp)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/health` | Health check |
| GET/POST | `/api/users` | User CRUD |
| POST | `/api/users/{id}/activate` | Đổi workspace (dừng lịch/listener cũ, nạp mới), trả `schedules_loaded` + `listeners_loaded` |
| GET | `/api/dashboard/stats` | Thống kê tổng hợp |
| GET/POST | `/api/projects` | List (filter X-User-Id) + create |
| GET/PUT/DELETE | `/api/projects/{id}` | Update rename folder, delete cascade stop runs + rmtree |
| PUT | `/api/projects/reorder/items` | Kéo thả sort |
| POST | `/api/projects/{id}/venv/init` | Tạo lại venv thủ công |
| GET/POST | `/api/projects/{id}/packages{,/install,/uninstall}` | pip trong venv project |
| GET | `/api/projects/{id}/export` | Zip project |
| POST | `/api/projects/import` | Import zip |
| GET/POST | `/api/projects/{id}/workflows` | Workflow của project |
| PUT | `/api/projects/{id}/workflows/reorder` | Sort |
| POST | `/api/projects/{id}/workflows/import` | Import 1 workflow |
| GET/PUT/DELETE | `/api/workflows/{id}` | CRUD; PUT nhận `expected_updated_at` → 409 nếu lệch (ETag) |
| POST | `/api/workflows/{id}/duplicate` | Nhân bản |
| GET | `/api/workflows/{id}/export` | Zip 1 workflow (kèm DbConnection) |
| GET/PUT | `/api/workflows/{id}/input` | Đọc/ghi `input.json` (biến môi trường) |
| GET | `/api/workflows/{id}/files` | Danh sách file trong `input/` |
| POST | `/api/workflows/{id}/files` | Upload |
| DELETE | `/api/workflows/{id}/files/{filename}` | Xóa |
| GET | `/api/workflows/{id}/output-files` | File trong `output/` |
| POST | `/api/workflows/{id}/run` | Chạy → trả `run_id` |
| POST | `/api/workflows/{id}/stop` | Set stop_flag + kill process con |
| GET/DELETE | `/api/workflows/{id}/runs` | Lịch sử run + xoá lịch sử |
| GET | `/api/workflows/{id}/listener/status` | Trạng thái listener |
| GET | `/api/runs/{run_id}` | Chi tiết 1 run |
| GET | `/api/runs/{run_id}/logs/stream?offset=N` | **SSE**, prefill từ offset |
| GET/POST/PUT/PATCH/DELETE | `/api/workflows/{id}/schedules`, `/api/schedules/{id}[/toggle]` | Schedule CRUD |
| POST | `/api/database/tables` | List bảng của 1 kết nối |
| POST | `/api/database/columns` | List cột của 1 bảng |
| GET/POST/PUT/DELETE | `/api/database/connections{,?workflow_id=…}{,/{id}}` | DbConnection CRUD |
| GET/PUT | `/api/ai/settings` | Cấu hình LLM |
| POST | `/api/ai/test` | Test kết nối LLM |
| POST | `/api/ai/generate` | **Stream** SSE token code Python |
| GET | `/api/system/info` | Version + last-updated (từ `git log`) |
| GET | `/api/system/check-update` | So local vs remote |
| POST | `/api/system/update` | git pull + reinstall + restart |

---

## ⚠ Điểm cần lưu ý (GOTCHAS)

Đây là những chỗ **AI agent / developer mới dễ vấp**:

### Về server & thread
- **Single-loop, single-process**: `uvicorn.run(reload=False)`. Không có multi-worker → mọi state in-memory (`_active_runs`, `_workflow_run_ids`, `_active_listeners`, APScheduler jobstore) là một nguồn sự thật duy nhất. Đừng thêm worker mà không xử lý phân tán state.
- **ThreadPoolExecutor riêng 256 worker** cho executor ([executor.py:14](backend/services/executor.py:14)). KHÔNG dùng `asyncio.to_thread` cho executor call — sẽ cạn default pool (~32) khi có nhiều listener idle.
- **Khối `telegram_listener` chạy `while True: sleep(0.5)`** — chiếm 1 worker cho tới khi Dừng. Đó là lý do phải cấp pool riêng lớn.

### Về DB
- **2 kênh truy cập cùng file SQLite**: SQLAlchemy async cho API (`AsyncSessionLocal`), `sqlite3` sync trong executor thread (`_finish_run`, `_set_workflow_listener_flag`). WAL mode giúp không lock, nhưng vẫn phải cẩn thận: đừng long-open async session trong khi executor thread đang UPDATE cùng row.
- **Auto-migration** khi startup: [database.py:_sqlite_apply_schema_updates](backend/database.py:30) chỉ thêm cột thiếu, không xóa/đổi kiểu. Muốn đổi schema breaking → tự viết migration.
- Cột `graph_json` là **TEXT chứa JSON** — luôn `json.loads`/`json.dumps` trước khi đọc/ghi.

### Về folder trên đĩa
- Đường dẫn folder = `slugify(name)` — nếu đổi tên project/workflow, **phải rename folder** cùng lúc, ngược lại `get_project_dir` sẽ tính path mới trong khi folder cũ mồ côi (mất venv/input/output). [update_project](backend/routers/projects.py:144) và [update_workflow](backend/routers/workflows.py:258) đã xử lý bằng `rename_project_dir` / `rename_workflow_dir`. Nếu commit DB fail sau khi rename → rollback đổi tên folder về cũ.
- **Trước khi xóa** workflow/project: **phải** gọi `_stop_and_wait_workflow_runs(wf_id)` để kill run + đợi thread thoát, ngược lại thread executor còn ghi vào folder đang bị `shutil.rmtree` (race).

### Về concurrency
- Set `_workflow_run_ids[workflow_id]` có thể bị `_finish_run` pop key giữa `if ... in ...` và `for run_id in ...` → dùng `list(_workflow_run_ids.get(workflow_id, set()))` thay if-in-then-index (đã fix ở [executor_blocks.py:58](backend/services/executor_blocks.py:58)).
- **APScheduler `max_instances=1` chỉ bảo vệ hàm job** (return ngay lập tức) chứ không bảo vệ workflow thật. `trigger_workflow_from_scheduler` phải tự check `_workflow_run_ids` skip run trùng.

### Về nội suy `{{var}}`
- Dùng `re.sub` 1 lượt (đã fix), **KHÔNG** for-loop replace. Nếu revert lại for-loop, value chứa `{{...}}` (từ tin nhắn Telegram do người ngoài đặt) sẽ bị scan tiếp → rò rỉ biến nội bộ.
- Field `condVariable`, `key_name`, `code` **không nội suy** (interpolate_deep skip theo `current_key`) — chúng là "tên biến" hoặc "mã", không phải chuỗi template.

### Về Frontend
- Autosave workflow debounce 1.5s, gửi `expected_updated_at` (ETag). BE trả 409 nếu lệch → FE popup "Tải lại / Ghi đè".
- SSE `createLogStream` **không dùng auto-reconnect gốc** của EventSource — tự reconnect sau 3s với `offset += received` để không mất log ở khoảng đứt.
- `BroadcastChannel('pyflow_active_runs')` đồng bộ set/clear `activeRuns` giữa các tab cùng origin — 1 tab bấm Dừng, tab kia cập nhật nút ngay dù không mở Drawer Logs.
- Match log kết thúc trong LogViewer phải khớp CHÍNH XÁC chuỗi BE phát ở cuối `execute_workflow_thread`: `"✅ Workflow hoàn thành"` (không phải "Hoàn thành workflow"), `"❌ Lỗi hệ thống khi chạy workflow"`, `"⏹ Đã dừng"`. Đổi 1 chuỗi phải đổi cả 2 phía.

### Về khối cụ thể
- **`end` KHÔNG bắt buộc** — queue rỗng tự nhiên cũng kết thúc + `_finish_run` bình thường. `end` chỉ hữu ích khi cần cắt sớm giữa chừng (đặc biệt nó `break` toàn bộ vòng lặp → cắt luôn các nhánh song song đã enqueue).
- **`python` không gán `output_data`** → khối kế nhận `None`, không phải giữ nguyên `input_data`.
- **`browser`** merge `key_name`s vào `current_input` cũ (giữ key cũ), khác với `telegram` (chỉ set 2 key), khác với `error_trigger` (thay hoàn toàn).

### Về port
- BE 7000, FE 9000. Đã hardcode ở 11 file — nếu đổi lại phải sửa cả: [main.py](backend/main.py) (uvicorn + CORS), [vite.config.js](frontend/vite.config.js), [.claude/launch.json](.claude/launch.json), [client.js](frontend/src/api/client.js) (baseURL), 4 chỗ hardcode `http://localhost:7000` (App.jsx, Dashboard, ProjectDetail, InputJsonModal — dùng cho download link trực tiếp), 3 startup script, README.

---

## 🖥 Yêu cầu hệ thống

- **Python** 3.8+ (đã test 3.14)
- **Node.js** 18+
- **OS**: Windows 10/11, macOS, Linux
- **RAM**: 2 GB+ (Playwright + Chromium chiếm nhiều nếu chạy khối Browser)
- **Disk**: 500 MB cho venv + node_modules + Chromium; thêm dung lượng cho `backend/data/pj_*/` tuỳ workflow

---

## 📄 License & Contact

Xem [frontend/src/config/appInfo.js](frontend/src/config/appInfo.js) để biết version + link repo. Ứng dụng nội bộ, sử dụng local, không public.
