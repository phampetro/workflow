# backend/CLAUDE.md — quy tắc khi làm ở backend

Nạp kèm [CLAUDE.md gốc](../CLAUDE.md). Tham chiếu chi tiết: [README.md](../README.md).

## Kiến trúc chạy

- FastAPI async + SQLAlchemy 2.x async. Trong route dùng `AsyncSession`; trong thread executor dùng `sqlite3` sync qua **`connect_sqlite()`** (2 kênh song song trên cùng file, WAL).
- Gọi executor phải qua `_WORKFLOW_EXECUTOR` (256 worker) ở [services/executor.py](services/executor.py), **không** `asyncio.to_thread` (cạn default pool khi có nhiều Telegram Listener idle).
- `run_workflow_internal` tách 3 đoạn session ngắn; **`execute_workflow()` chạy NGOÀI mọi session** (workflow có Telegram Listener sống hàng tuần, giữ session là cạn pool).
- Rename thư mục project/workflow phải qua `rename_project_dir` / `rename_workflow_dir` **trước** commit DB; commit fail thì đổi tên lại.
- Xoá workflow/project phải gọi `_stop_and_wait_workflow_runs` **trước** `rmtree`.
- Update endpoint nhận `expected_updated_at` → lệch với DB thì trả 409 (ETag).
- Telegram Listener persist qua cột `workflow.listener_on`; startup [main.py](main.py) `reload_telegram_listeners` bật lại cho user active.
- Message **hiển thị cho người dùng** trả về kèm field `code` (+ tham số) để FE dịch qua `t()`; không trả chuỗi ngôn ngữ cứng. Mẫu: `check_update()`/`execute_update()` trong [routers/system.py](routers/system.py). (Log runtime khi chạy workflow cố tình chỉ tiếng Việt — xem README.)

## Khối (block)

- Mỗi loại khối là một handler `handler(ctx, step)` trong [services/block_handlers/](services/block_handlers/__init__.py); vòng điều phối ở `runner.py`. Handler báo luồng bằng giá trị trả về `None`/`SKIP`/`BREAK`/`ABORT` (docstring `context.py`) — không tự `_finish_run` hay đụng `ctx.queue`, trừ khối Queue.
- Thêm khối: viết handler + khai vào `HANDLERS` của module + thêm test vào `tests/test_workflow_engine.py`.
- **Khối cần chạy script trong venv project** (SQL, Excel…): viết script cố định trong [services/block_scripts/](services/block_scripts/) rồi gọi `script_code("<tên>", params)` ([block_handlers/common.py](services/block_handlers/common.py)). Cấu hình đi vào **một biến `PARAMS`** (json + repr). **Không** quay lại sinh mã bằng f-string ghép giá trị — cách cũ phải nhớ `!r` cho từng giá trị, pivot từng nhúng thiếu. Script phải có trong `--add-data` của `tools/build_release.py` (build tự chặn nếu thiếu) và có test chạy thật trong `tests/test_block_scripts.py`.
- Cấu hình khối (`step.bdata`) **đã được nội suy sẵn** trước khi vào handler: handler **không được** gọi `interpolate` lần nữa trên giá trị trong `bdata` — nội suy 2 lần chính là chain-replace (từng có ở `excel_read`/`google_sheets_read`).
- Interpolate `{{var}}` dùng `re.sub` **1 lượt** trong `BlockStep.interpolate` ([context.py](services/block_handlers/context.py)) — không for-loop replace.

### Biến output của khối (BẮT BUỘC khi thêm/sửa khối)

**Tên biến người dùng gõ trên giao diện là TÊN DUY NHẤT của biến** — là key thật trong `current_input` (tức `input_data` của khối Python sau) *và* trong `workflow_env` (tức `{{ten_bien}}`). Không để "giao diện 1 tên, chạy 1 tên" (bug thật: khối EXEC đặt tên riêng nhưng code vẫn trả `result`, người dùng đọc `input_data['result']` ra rỗng, không log nào báo).

1. Khai vào **`BLOCK_OUTPUT_VARS`** ([services/executor_blocks.py](services/executor_blocks.py)) dạng `btype: [(ten_key_goc, tenFieldTrenUI), ...]`, gọi `rename_output_keys(btype, bdata, output)` **ngay tại chỗ gán `current_input`**. Khai xong tự có log `📦 [<label>] Biến trả về: …` qua `describe_output_vars()`.
2. Thêm tên field vào **`NON_INTERPOLATED_KEYS`**. Ô tên biến không được nội suy: nhánh "gõ tên trần" của `interpolate()` sẽ thay ô tên biến bằng chính **giá trị** của nó từ vòng lặp thứ 2 → ghi vào key rác. *(test_conventions kiểm 2 bước này.)*
3. FE dùng `renderVarNameField()` trong `BlockEditorModal.jsx` (đã kèm validate `[A-Za-z_][A-Za-z0-9_]*`).
4. **Giá trị mặc định trên UI trùng tên key gốc** → `rename_output_keys` thành no-op, workflow cũ chạy y như trước.
5. **1 giá trị = 1 tên.** Không ghi thêm key cố định song song (kiểu `row_count` cũ của khối đọc Excel/Sheets — đã bỏ).
6. **Không lưu nguyên object dưới tên biến** — `{{ten.field}}` không hoạt động (từng có `workflow_env[outputVarName] = current_input` làm `{{file_name}}` ra cả dict).
7. **Payload từ bên ngoài không được nội suy.** `_initial_input` (tin nhắn Telegram) nằm trong `NON_INTERPOLATED_KEYS`: người ngoài nhắn `{{password_web}}` sẽ được thay bằng secret trong `input.json`.
8. **Trước khi đổi/bỏ một key**, quét `graph_json` trong `data/pyflow.db` xem workflow thật tham chiếu tên đó qua đâu — `{{...}}`, `condVariable` (Condition), `loopArrayVar` (Loop), string literal trong `code` của khối Python. Đừng đoán.
9. Khối tiêu thụ: Condition đọc `current_input` (không đọc `workflow_env`) — cố ý, thêm fallback sẽ đổi kết quả rẽ nhánh của workflow đang chạy. Loop đọc `loopArrayVar` (nhận cả `{{ten}}` lẫn tên trần). Khối Python đọc được **cả hai** kênh.

Không quay lại cơ chế "bí danh" (trả key gốc trong `current_input` rồi chỉ ghi tên custom vào `workflow_env`). Bảng field từng khối: README §"Biến toàn cục" mục 3.

### Khối cần thư viện pip (chạy trong venv project)

Phân biệt venv project với venv backend: xem đầu [services/pkg_scanner.py](services/pkg_scanner.py).

1. Khai package cố định của khối vào **`_BLOCK_BASE`** trong `pkg_scanner.py`, trong handler gọi **`ensure_block_packages(ctx, step, db_type)`**. Đây là **nguồn duy nhất** cho cả lúc chạy lẫn lúc quét "Tự động cài thư viện" — hai nơi khai riêng từng lệch nhau (quét báo đủ, chạy thật văng `ImportError`).
   Ghim phiên bản bằng `==` khi cần (ensure_packages và Tự động cài so ĐÚNG bản, lệch là cài lại). ⚠ **SQLAlchemy ghim 2.0.x mới nhất** (`pkg_scanner.SQLALCHEMY`, hiện 2.0.58 — KHÔNG thấp hơn bản tối thiểu pandas đòi, xem `pandas/compat/_optional.py`): bản 2.1 nạp bắt buộc file `.pyd` không chữ ký → **Smart App Control** của Windows 11 chặn ("Application Control policy has blocked this file") và không có đường lùi; 2.0 tự lùi về Python thuần. Nâng bản → thử trên máy bật Smart App Control trước.
2. Driver khác nhau theo loại DB → khai thêm `_DRIVER_BLOCKS` + `_DB_DRIVERS`.
3. Khối tự do (Python Block) không cần khai — quét `ast.parse()` lo; chỉ bổ sung `_MODULE_ALIAS` nếu tên module khác tên gói pip (VD `cv2`→`opencv-python`).

## Bảo mật (sản phẩm giao cho khách, không còn là "app local")

Có license + tự cập nhật, tức app chạy trên máy người khác. Các hàng rào dưới đã trả giá bằng lỗ hổng thật, **đừng gỡ**:

- **Route phục vụ frontend** ([main.py](main.py)) phải `resolve()` + kiểm `is_relative_to(dist)` — bỏ ra là `GET /..%2f..%2fbackend%2fdata%2fpyflow.db` tải được cả database. Đường `/api/...` không tồn tại trả **404 JSON** (không phải index.html).
- **`licensing.ENFORCE`** bật cứng theo `sys.frozen`, không chỉ đọc env (khách bấm thẳng `.exe` là mở khoá).
- **Mọi giá trị qua `interpolate()` có thể do người ngoài điều khiển** (tin nhắn Telegram, ô Google Sheet): tên bảng SQL qua `_VALID_TABLE_NAME`; tên file qua `safe_filename()` (kể cả file đính kèm Telegram/Email); truyền vào script qua `PARAMS`, không ghép vào mã; nội suy luôn **một lượt `re.sub`** (`interpolate`, `_interpolate_once` ở [browser_executor.py](services/browser_executor.py)).
- **`_csrf_guard`** kiểm `Origin`/`Sec-Fetch-Site` (CORS chỉ chặn ĐỌC, không chặn GỬI). **`_host_guard`** chỉ nhận `Host` loopback — chống DNS rebinding; truy cập qua IP LAN bị 403 là đúng ý đồ.
- **Secret trong DB mã hoá DPAPI phạm vi máy** ([services/secret_store.py](services/secret_store.py)): `DbConnection.password`, `CloudConnection.refresh_token` dùng cột `EncryptedText` ([models.py](models.py)) — ORM đọc/ghi chữ thường. **Đường `sqlite3` thô phải tự `secret_store.encrypt/decrypt`** (VD `get_saved_db_connection`, khối cloud). Phạm vi máy (không theo user) vì máy dev từng đổi user Windows. Đổi entropy `pyflow-secret-v1` = mọi secret đã lưu không đọc được nữa.
- **Không trả `password` của `DbConnection` ra API**; ô mật khẩu để trống khi sửa = giữ nguyên. **Ngoại lệ có chủ đích:** file export ZIP kèm mật khẩu chữ thường (quyết định của chủ dự án để backup/khôi phục) — đừng "vá"; chỉ nhắc người dùng không chia sẻ file export.
- **Token đám mây không bao giờ ra khỏi máy**: không trả ra API (chỉ cờ `connected`), **không** đóng gói vào export (import xong đăng nhập lại). OAuth giữ `state` + PKCE ([services/cloud_storage.py](services/cloud_storage.py)); Microsoft xoay refresh token mỗi lần làm mới → phải lưu token mới. Client ID: [docs/cloud-upload-setup.md](../docs/cloud-upload-setup.md).
- **`update.zip` PHẢI được ký và verify** ([services/update_signing.py](services/update_signing.py)) — kênh phân phối code tới máy khách. Client từ chối bản thiếu `update.zip.sig`, không fallback `zipball_url`. Dùng cặp khoá Ed25519 của license nhưng **tách miền**: chuỗi ký là `b"pyflow-update-v1:" + sha256_hex`. Đổi tiền tố = mọi bản đã phát hành bị từ chối.

## SQLite

- `database.py` bật WAL + `busy_timeout=15000` qua `apply_sqlite_pragmas()` cho **cả 2 engine**. Thread executor phải dùng **`connect_sqlite()`** — một kết nối quên bật là đủ gây `database is locked`, run kẹt RUNNING. *(test_conventions cấm `sqlite3.connect(` ngoài `database.py`.)*
- Không bọc `execute_workflow()` trong `async with AsyncSessionLocal()`.

- **Bảo trì tự động** ([services/maintenance.py](services/maintenance.py), chạy lúc khởi động + mỗi 24h): log run cũ hơn 30 ngày (trừ 20 lần gần nhất mỗi workflow) thay bằng 1 dòng thông báo — **giữ dòng run** cho thống kê; `VACUUM` khi trống ≥ 5MB; backup `data/backups/pyflow-YYYYMMDD.db` bằng `VACUUM INTO`, giữ 7 bản.

## Multi-user

Chỉ **1 user `is_active=True`** tại một thời điểm; **chỉ schedule/listener của user active mới chạy** — design có chủ đích, đừng "fix". Xem README §Multi-user.

## Venv của project (Python đóng gói + uv)

- Bản phát hành kèm `runtime/python/` (CPython độc lập) + `runtime/uv.exe` cạnh `backend/`. `venv_manager.get_system_python()` dùng Python này; bản build cũ thiếu `runtime/` mới tìm Python cài trên máy. Bản dev dùng Python + uv của `backend/.venv`.
- Tạo venv qua **`venv_manager.create_venv_blocking()`** (nguồn duy nhất): `uv venv --seed --clear` (kèm pip để code người dùng và `pip list` vẫn chạy), uv lỗi thì lùi về `python -m venv`.
- Cài gói qua **`venv_manager.install_attempts()`**: uv trước, **pip làm đường lùi** — máy khách có thể cấu hình proxy/index nội bộ trong `pip.ini` mà uv không đọc. uv chạy với `UV_NATIVE_TLS=1` (CA của mạng công ty chỉ nằm trong Windows store).
- ⚠ Tên thư mục `runtime/python` **cố định**: venv ghi đường dẫn Python gốc vào `pyvenv.cfg`; đổi tên/vị trí = mọi venv bị coi là hỏng (`venv_is_stale`) và phải dựng lại.

## Cập nhật trên máy khách (đổi chỗ có hoàn tác)

- `routers/system.py` tải `update.zip` + `.sig`, **verify chữ ký**, rồi chép [services/update_scripts/apply_update.ps1](services/update_scripts/apply_update.ps1) + ghi `updater.bat` ra cạnh thư mục cài đặt và thoát.
- `apply_update.ps1`: giải nén vào `_update_stage\` → chuyển `backend\ frontend\ runtime\` cũ vào `_update_backup\` → đưa bản mới vào → **mang `backend\_internal\data` sang** → khởi động, chờ `/health` (120s). Không lên → tắt, **trả mọi thứ về như cũ kể cả dữ liệu**, chạy lại bản cũ, ghi `data\.update_failed` → lần khởi động sau backend báo `update_rolled_back` cho giao diện.
- **Gói runtime tách riêng**: `update.zip` không kèm `runtime/`; release có thêm `runtime-<python>-uv<ver>.pyrt` (+`.sig`). Máy khách so với `runtime/VERSION`, chỉ tải khi thiếu/khác → `-RuntimeZip`. Script chỉ đổi chỗ phần **có trong bản mới** (`$script:swapped`) — không kèm runtime thì runtime đang có giữ nguyên, hoàn tác cũng không gỡ. ⚠ Đuôi `.pyrt` (không phải `.zip`) là có chủ đích: code cập nhật cũ lấy `.zip` đầu tiên.
- Mã thoát 0/10 = script đã xử lý; mã khác (PowerShell bị chặn chạy `.ps1`) → `updater.bat` lùi về cách cũ (giải nén đè).
- ⚠ **Không bao giờ `Remove-Item` thư mục còn chứa dữ liệu khách** — mọi chỗ xoá trong script đều kiểm điều này. File phải lưu **UTF-8 có BOM** và code chỉ ASCII (PS 5.1 đọc file không BOM theo ANSI, `—` thành `”` và vỡ cú pháp) — `tests/test_apply_update.py` kiểm cả điều này lẫn 3 đường chạy thật.
- Lần cập nhật **đầu tiên** lên bản có cơ chế này vẫn do `updater.bat` của bản CŨ trên máy khách thực hiện (giải nén đè + dọn file theo manifest trong `start.vbs`); cơ chế mới có hiệu lực từ lần cập nhật kế tiếp.

## Phát hành

- `backend\.venv\Scripts\python.exe tools\build_release.py [--bump patch|minor|major] [--no-upload]` (tự chạy lại bằng Python của `backend\.venv`, kiểm khoá ký trước khi build). `--no-upload` = build thử: không upload, không gắn tag, trả lại `release_version.json`.
- Version theo **git tag `vX.Y.Z`**: HEAD đúng tại tag → build lại số đó; không thì lấy bản lớn nhất (tag, `release_version.json`) rồi tăng. Upload GitHub Releases xong tự gắn tag + push. Không bao giờ ra số nhỏ hơn bản trước.
- Bản dev: `/api/system/info` hiện "tag gần nhất + số commit sau đó" (VD `2.4.164+3`).

## Không được làm (backend)

- Không dùng `asyncio.create_task` trần trong routers — dùng `_spawn()` (task có thể bị GC giữa chừng). *(test_conventions kiểm.)*
- Không pop listener khỏi `_active_listeners`/`_stop_events`/`_active_configs` theo key — so **danh tính task** (`is`), nếu không 2 listener cùng bot token chạy song song, mỗi tin nhắn kích hoạt workflow 2 lần.
- Không bỏ `run_id` khỏi đường dẫn `runs/<run_id>/<khối>/main.py` — 2 run song song ghi đè code của nhau.
- Không bỏ field nào khỏi `NON_INTERPOLATED_KEYS`, không thêm field "tên biến" mà quên khai vào đó.
