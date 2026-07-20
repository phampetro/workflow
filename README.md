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

## Các khối Workflow (Block Types)

Hiện có **16 loại khối** (`btype`) được xử lý trong `backend/services/executor_blocks.py`, cộng thêm 1 loại khối đặc biệt (`error_trigger`) không nằm trong luồng chạy chính mà chỉ được kích hoạt khi có lỗi.

> Quy ước: `current_input` là dữ liệu đầu vào khối nhận được (từ khối nối trước nó); sau khi khối chạy, giá trị mới gán cho `current_input` sẽ là dữ liệu truyền tiếp cho khối kế tiếp theo cạnh nối. Nhiều khối gọi biến này là `output_data` bên trong code/script do chính khối đó sinh ra.

### 1. `start` — Bắt đầu workflow
Chỉ log, không đụng vào dữ liệu. **`current_input` giữ nguyên y hệt lúc vào** (thường là input ban đầu của lần chạy, hoặc `_initial_input` nếu chạy từ Telegram Listener).

### 2. `end` — Kết thúc workflow
Log rồi dừng vòng lặp ngay. Không có biến trả về vì workflow dừng tại đây.

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
  "raw_message": "toàn bộ JSON message gốc do Telegram trả về (chứa from.id, from.username, chat đầy đủ, entities...)"
}
```
Không có key `command` — tên lệnh khớp (`/xxx`) chỉ dùng nội bộ để quyết định có chạy workflow hay không, **không** được đưa vào biến trả về. Muốn biết lệnh nào đã gõ, phải tự tách từ `{{text}}` (ví dụ lấy từ đầu chuỗi) hoặc đọc trong `raw_message`.
Khi chạy thủ công (bấm nút Chạy, không phải do tin nhắn kích hoạt): chỉ bật listener nền, `current_input` không đổi, và workflow treo ở trạng thái RUNNING chờ tin nhắn tiếp theo.

Có **4 field đặt tên biến riêng** cho 4 giá trị chính (không gồm `raw_message` vì là blob JSON thô, ít khi cần đặt tên riêng): "Lưu chat_id/message_id/text/sender_name vào biến" — mặc định điền sẵn **trùng tên biến trả về** (`chat_id`/`message_id`/`text`/`sender_name`). Nếu workflow có nhiều khối Telegram Listener và muốn tránh nhầm lẫn, tự đổi thành tên riêng.

### 5. `telegram` — Gửi/Sửa/Trả lời tin nhắn Telegram
Sau khi gửi thành công, **chỉ 2 key được thêm/ghi đè**, mọi key khác trong `current_input` cũ được giữ nguyên:
- `sent_message_id`: id của tin nhắn (hoặc file) vừa gửi/sửa ra.
- `chat_id`: id chat đích vừa gửi tới.

Nếu `current_input` trước đó **không phải object** (ví dụ null hoặc 1 chuỗi/số), toàn bộ bị thay bằng (dữ liệu cũ không được giữ lại):
```json
{ "sent_message_id": "...", "message_id": "... (giống sent_message_id)", "chat_id": "..." }
```

Có **2 field đặt tên biến riêng**: "Lưu sent_message_id/chat_id vào biến" — mặc định điền sẵn **trùng tên biến trả về** (`sent_message_id`/`chat_id`). Nếu workflow có nhiều khối Telegram và muốn tránh khối sau ghi đè khối trước, tự đổi thành tên riêng.

### 6. `email` — Gửi Email SMTP
Chỉ gửi mail, log kết quả. **`current_input` không đổi**, dù thành công hay thất bại.

### 7. `delete_files` — Xóa tập tin Input/Output
Xóa file theo cấu hình (`delete_input`, `delete_output` — bool). **`current_input` không đổi**.

### 8. `browser` — Tự động hóa trình duyệt (Playwright)
Mỗi bước (step) trong cấu hình có 1 field `key_name` (tên biến bạn tự đặt) quyết định key nào sẽ được set trong kết quả trả về. Loại bước nào ghi dữ liệu ra biến (các bước khác như click/fill/wait không ghi gì):

| Action của bước | Giá trị ghi vào `key_name` |
|---|---|
| `get_text` | Chuỗi text lấy được từ phần tử (đã strip khoảng trắng) |
| `get_attribute` | Giá trị của attribute HTML được chỉ định |
| `get_all_text` | Mảng (list) chuỗi text của tất cả phần tử khớp selector |
| `get_url` | URL hiện tại của trang |
| `screenshot` | Chuỗi base64 dạng `data:image/png;base64,...` (ảnh chụp toàn trang) |
| `evaluate_js` | Kết quả trả về của đoạn JavaScript (`page.evaluate`) |
| `click_and_download` | Đường dẫn tuyệt đối file vừa tải về (lưu trong thư mục Output) |

Toàn bộ các `key_name` này được gộp thành 1 dict (`collected_data`), sau đó **merge vào `current_input` cũ** — giữ lại các key cũ (như `chat_id`, `sent_message_id` nếu có từ khối Telegram trước đó), key trùng tên bị ghi đè bởi giá trị mới từ Browser.

### 9. `python` — Chạy code Python tùy ý
Cơ chế cố định (không phụ thuộc nội dung code): script của bạn nhận biến `input_data` (được deserialize từ JSON, chính là `current_input` của khối trước), và có thể gán bất kỳ giá trị nào vào biến `output_data`. Sau khi chạy xong, hệ thống `json.dumps(output_data)` rồi gán ngược thành `current_input` cho khối kế tiếp. Nếu code **không gán `output_data`**, giá trị mặc định là `None` → khối kế tiếp sẽ nhận `current_input = None`. Vì vậy cấu trúc biến trả về hoàn toàn do người dùng tự quyết định qua code, không có key cố định.

### 10. `sql_to_excel` — SQL → Excel
```json
{ "file_name": "tên file Excel vừa xuất ra, kèm phần mở rộng (vd: sqltoexcel.xlsx)" }
```
File luôn được lưu vào thư mục Output. Tên file mặc định: `sqltoexcel.xlsx`. Field "Lưu tên file kết quả vào biến" mặc định điền sẵn **trùng tên biến trả về** `file_name`.

### 11. `merge_excel` — Ghép nhiều Excel
```json
{ "file_name": "tên file Excel đã gộp, kèm phần mở rộng (vd: merged.xlsx)" }
```
File luôn được lưu vào thư mục Output — không cần trả `file_path`/`status` vì không dùng để xử lý tiếp (muốn dùng file này ở khối sau thì chọn qua cơ chế chọn file có sẵn, không qua biến). Tên file mặc định: `merged.xlsx`. Field "Lưu tên file kết quả vào biến" mặc định điền sẵn **trùng tên biến trả về** `file_name`.

### 12. `pivot_excel` — Tổng hợp Pivot
```json
{ "file_name": "tên file Excel chứa bảng Pivot, kèm phần mở rộng (vd: pivot.xlsx)" }
```
Tương tự `merge_excel` — file luôn lưu vào thư mục Output. Tên file mặc định: `pivot.xlsx`. Field "Lưu tên file kết quả vào biến" mặc định điền sẵn **trùng tên biến trả về** `file_name`.

### 13. `excel_to_sql` — Import Excel → SQL
```json
{
  "rows_inserted": "số dòng đã import (int)",
  "table": "tên bảng SQL đích đã import vào"
}
```
Khối này có **2 field đặt tên biến riêng** (không dùng field "Lưu tên file kết quả vào biến" chung, vì có 2 giá trị độc lập cần lưu):
- "Lưu số dòng đã import vào biến" — mặc định điền sẵn **trùng tên biến trả về** `rows_inserted`.
- "Lưu tên bảng đích vào biến" — mặc định điền sẵn **trùng tên biến trả về** `table`.

Để trống 1 trong 2 (hoặc cả 2) thì chỉ bỏ qua việc lưu biến toàn cục cho giá trị đó — kết quả trả về của khối (`current_input`) vẫn luôn có đủ `rows_inserted`/`table` như bình thường.

### 14. `run_sql_exec` — Chạy Hàm SQL (EXEC)
```json
{
  "result": "mảng các dòng kết quả (mỗi dòng là 1 object cột→giá trị) — mảng rỗng [] nếu câu lệnh không trả về dòng nào",
  "row_count": "số dòng trong result nếu có trả dòng, ngược lại là số dòng bị ảnh hưởng (INSERT/UPDATE/DELETE)"
}
```
Có **2 field đặt tên biến riêng**: "Lưu kết quả (rows) vào biến" mặc định **trùng tên biến trả về** `result`, "Lưu số dòng vào biến" mặc định **trùng tên biến trả về** `row_count`.

### 15. `condition` — Rẽ nhánh điều kiện
**`current_input` hoàn toàn không bị đụng tới** — khối chỉ ĐỌC các key trong `current_input` hiện có để so sánh (theo tên biến `condVariable` bạn khai), rồi chọn cạnh ra `true`/`false` tương ứng. Dữ liệu truyền tiếp cho khối sau y hệt dữ liệu trước khi vào khối Condition.

### 16. `loop` — Vòng lặp
Nếu `current_input` trước đó không phải object, bọc thành `{"previous_input": <giá trị cũ>}`. Sau đó **luôn ghi đè thêm 1 key**:
```json
{ "...(các key cũ giữ nguyên)...", "loop_iteration": "số lần khối Loop này đã chạy (int, tăng dần mỗi vòng)" }
```
Riêng khối Loop còn quyết định đi nhánh `loop` (lặp lại) hay `endloop` (thoát) dựa theo số lần chạy hoặc điều kiện, không ảnh hưởng tới cấu trúc biến trả về.

### `error_trigger` — Bắt Lỗi toàn cục (không nằm trong luồng chạy chính)
Không phải 1 khối chạy bình thường trong dispatch chain — chỉ được kích hoạt tự động khi có khối khác gặp lỗi (nếu đã nối khối Bắt Lỗi trong sơ đồ). Toàn bộ dữ liệu hiện có trước đó **bị thay thế hoàn toàn** bằng:
```json
{
  "status": "error",
  "error_detail": "nội dung lỗi (chuỗi traceback hoặc thông báo lỗi)",
  "failed_block": "tên (label) của khối đã gây lỗi",
  "failed_block_id": "id của khối đã gây lỗi"
}
```

> Từ khi có tính năng "Kết nối Database dùng chung" (xem mục dưới), khối **Database** cũ đã được **xóa bỏ** — 3 khối `sql_to_excel`/`excel_to_sql`/`run_sql_exec` giờ tự chọn kết nối trực tiếp trong cấu hình của chính nó, không cần khối Database đứng trước nữa.

## Biến toàn cục (Global Variables)

Có **2 cơ chế truyền dữ liệu khác nhau** giữa các khối trong cùng 1 lần chạy — cần phân biệt rõ để tránh nhầm lẫn:

### 1. `workflow_env` — biến toàn cục thực sự (dùng cho `{{ten_bien}}`)
- Khởi tạo từ nội dung bạn khai ở **"Dữ liệu Workflow" → tab Biến môi trường** (file `input.json`).
- Sau khi **MỖI khối chạy xong** (không phân biệt loại), toàn bộ key trong biến trả về của khối đó (nếu là object/dict) sẽ được **gộp thẳng vào `workflow_env`**.
- Biến này dùng để thay thế `{{ten_bien}}` ở **bất kỳ ô cấu hình nào của bất kỳ khối nào sau đó** trong cùng lần chạy — không cần nối trực tiếp.
- **Lưu ý quan trọng:** nếu 2 khối khác nhau đều trả về key **trùng tên** (ví dụ nhiều khối `telegram` đều có key `chat_id`, hoặc nhiều khối `excel_to_sql` đều có key `table`), giá trị dùng cho `{{chat_id}}`/`{{table}}` ở các khối sau sẽ luôn là của **khối chạy gần nhất**, không phải khối cụ thể bạn nghĩ tới — cần đặt tên biến riêng (xem mục 3 bên dưới) hoặc kiểm tra ngay sau khối liên quan để tránh đọc nhầm.

### 2. `current_input` — chỉ truyền theo cạnh nối (KHÔNG toàn cục)
- Biến `input_data` bên trong 1 khối Python/script chỉ là **output của khối nối trực tiếp phía trước** (theo cạnh trong sơ đồ).
- Không liên quan đến `workflow_env` — nếu khối không nối trực tiếp sau khối bạn cần dữ liệu, `input_data` sẽ không có gì liên quan.

### 3. Đặt tên biến riêng để tránh bị ghi đè

Để giải quyết việc nhiều khối cùng loại dùng chung tên key (`status`, `result`, `table`...) đè lẫn nhau trong `workflow_env`, các khối có output nhiều giá trị đều có **field đặt tên biến riêng cho từng giá trị** (không phải 1 field chung bọc nguyên object — vì cơ chế `{{...}}` không hỗ trợ truy cập field con kiểu `{{ten_bien.field}}`, nên đặt tên riêng cho từng giá trị mới thực sự dùng được):

| Khối | Field đặt tên | Mặc định điền sẵn (trùng tên biến trả về) |
|---|---|---|
| `sql_to_excel` | Lưu tên file kết quả vào biến | `file_name` |
| `merge_excel` | Lưu tên file kết quả vào biến | `file_name` |
| `pivot_excel` | Lưu tên file kết quả vào biến | `file_name` |
| `excel_to_sql` | Lưu số dòng đã import / Lưu tên bảng đích | `rows_inserted` / `table` |
| `run_sql_exec` | Lưu kết quả (rows) / Lưu số dòng | `result` / `row_count` |
| `telegram` | Lưu sent_message_id / Lưu chat_id | `sent_message_id` / `chat_id` |
| `telegram_listener` | Lưu chat_id / message_id / text / sender_name | `chat_id` / `message_id` / `text` / `sender_name` |

Mỗi field mặc định **trùng tên biến trả về thật** (dễ nhớ, khớp đúng tài liệu) — nghĩa là mặc định chưa giải quyết việc trùng tên nếu bạn dùng **nhiều khối cùng loại** trong 1 workflow (vd 3 khối `excel_to_sql` đều mặc định `table` thì vẫn đè nhau y như trước). Muốn tránh đè, **tự đổi tên riêng** cho từng khối (vd `table_don_hang`, `table_khach_hang`...). Để trống thì chỉ dùng hành vi mặc định cũ (biến vẫn gộp phẳng vào `workflow_env`); đặt tên (khác tên biến gốc) thì giá trị còn được lưu thêm vào `workflow_env[tên_bạn_đặt]` — dùng `{{tên_bạn_đặt}}` ở bất kỳ khối nào sau đó mà không sợ khối khác ghi đè.

- `sql_to_excel`/`merge_excel`/`pivot_excel` chỉ có 1 giá trị (`file_name`) nên chỉ có 1 field, dùng field "Lưu tên file kết quả vào biến" chung.
- Trong giao diện, các field đặt tên biến luôn nằm **ở cuối cùng** phần cấu hình của khối (sau tất cả field khác), để không lẫn với cấu hình chính.
- Khối **Trình Duyệt** (`browser`) **không có field này** — mỗi bước đã có sẵn `key_name` để tự đặt tên field riêng (vd `ten_khach_hang`, `gia`); đây đã là cách đặt tên biến riêng cho khối này, chỉ là ở cấp độ từng bước thay vì cấp độ khối.
- Khối **Condition** và **Python Block** không có field này — Condition vẫn chỉ đọc theo `current_input` (chuỗi nối), Python Block vẫn chỉ nhận `input_data` từ khối liền trước, không đọc được biến đặt tên qua `workflow_env`.

## Kết nối Database dùng chung

- Quản lý tại **"Dữ liệu Workflow" → tab Database**: thêm/sửa/xóa nhiều cấu hình kết nối (đặt tên riêng từng kết nối), có nút "Test kết nối" trước khi lưu.
- Lưu trong bảng `db_connection` (SQLite, `backend/data/pyflow.db`) — không lưu trong `input.json` để tránh lẫn với gợi ý biến `{{...}}`.
- 3 khối `sql_to_excel`, `excel_to_sql`, `run_sql_exec` đều có field bắt buộc **"Kết nối Database"** — chọn thẳng từ danh sách đã lưu, mỗi khối tự kết nối độc lập, không phụ thuộc vị trí trong sơ đồ hay khối nào khác.
- **Scope theo từng workflow** (`db_connection.workflow_id`), không dùng chung cả project — mỗi workflow tự quản lý kết nối riêng của nó. Đánh đổi: nếu nhiều workflow trong cùng project dùng chung 1 DB, phải khai báo kết nối riêng cho từng workflow (không tái sử dụng được giữa các workflow). Đổi lại, **Export/Import** (cả export 1 workflow lẫn export cả project) tự động mang theo đúng kết nối của từng workflow và tự remap lại `savedConnectionId` sang id mới khi import — không cần cấu hình lại tay sau khi chuyển sang máy/project khác (xem `backend/services/export_import.py`).

## Yêu cầu hệ thống
- Python 3.8+ (đã test với 3.14)
- Node.js 18+
- Windows hoặc macOS
