# CLAUDE.md — Hướng dẫn cho Claude khi làm việc trên PyFlow Studio

File này Claude Code tự đọc mỗi session. Đọc [README.md](README.md) trước để nắm cấu trúc dự án và các gotchas kỹ thuật (kiến trúc, DB, executor, multi-user, port, v.v.).

---

## Nguyên tắc chung

- Ngôn ngữ chính khi giao tiếp: **tiếng Việt** (user Việt Nam, mọi log/UI/commit message đã tiếng Việt).
- Bám sát các **gotchas** trong README §"Điểm cần lưu ý" — đó là những chỗ đã trả giá bằng bug thật, đừng revert.
- Fix root cause thay vì workaround. Nếu phải workaround, ghi rõ lý do trong comment.

## Khi làm việc trên Frontend (React/JSX/CSS)

**BẮT BUỘC đọc và áp dụng skill `ui-ux-pro-max`** tại [`.agents/skills/ui-ux-pro-max/SKILL.md`](.agents/skills/ui-ux-pro-max/SKILL.md).

Skill có 10 nhóm rule theo priority. Bắt buộc pass **Priority 1-3 (CRITICAL + HIGH)** cho MỌI PR động vào UI:

1. **Accessibility** — 4.5:1 contrast, focus rings, `aria-label` cho icon-only button, `alt`/`aria` cho ảnh, `label`+`for` cho input, không dùng màu làm signal duy nhất.
2. **Touch & Interaction** — feedback trong ~100ms, không dựa vào hover, disable button khi async, error rõ + gần trường lỗi.
3. **Performance** — virtualize list ≥50 items (dùng `react-window` hoặc `react-virtuoso`), `loading="lazy"` cho ảnh below-fold, reserve space cho async content (CLS < 0.1), debounce/throttle scroll/resize.

Priority 4-10 (Style/Layout/Typography/Animation/Forms/Nav/Charts) — bám theo Pre-Delivery Checklist ở cuối SKILL.md trước khi báo xong.

### Cách nhanh dùng skill

```bash
# Lấy design system recommendation cho 1 phần UI mới
python .agents/skills/ui-ux-pro-max/scripts/search.py "<mô tả product/style>" --design-system -p "PyFlow Studio"

# Deep-dive 1 khía cạnh
python .agents/skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <ux|style|color|typography|chart|react>
```

### Quy ước semantic tokens của dự án

Dùng CSS variables định nghĩa trong [`frontend/src/index.css`](frontend/src/index.css), **không hardcode hex** trong component:
- Background: `--bg-base`, `--bg-surface`, `--bg-elevated`, `--bg-hover`
- Text: `--text-primary`, `--text-secondary`, `--text-muted`
- Border: `--border-default`, `--border-subtle`, `--border-accent`
- Accent: `--accent-primary`, `--accent-secondary`, `--accent-warning`, `--accent-danger`, `--accent-success`
- Font size: `--text-xs..--text-3xl`

Mỗi biến đã có override cho `:root[data-theme="light"]`. Khi thêm token mới phải khai báo cả 2 chế độ.

⚠ **Bộ `--accent-*` có bản riêng cho light theme** (`#0f766e`, `#b45309`, `#15803d`…) vì bản dark dùng trên nền trắng chỉ đạt 2,1–3,7:1. Thêm accent mới phải đo contrast trên `--bg-surface` của **cả 2 theme**, tối thiểu 4,5:1.

⚠ **Trong `theme.components` của `ConfigProvider` ([App.jsx](frontend/src/App.jsx)), mỗi component CHỈ ĐƯỢC khai MỘT key.** Khai 2 lần thì key sau xoá sạch key trước — đã từng làm mất `activeShadow` (vòng focus) của Select suốt một thời gian dài mà không ai thấy.

⚠ **Animation dùng chung khai trong `index.css`, không nhúng `<style>` trong component.** `@keyframes spin` từng không tồn tại trong khi 4 file cùng khai `.spinning` → mọi spinner trong app đứng im. CSS của khối canvas nằm ở [BlockNode.css](frontend/src/components/BlockNode.css).

Nếu buộc phải dùng màu ngoài palette (VD màu log level, syntax highlight), phải:
- Đặt thành CSS variable riêng (VD `--log-info`, `--log-success`) trong `index.css`.
- Khai đủ cho cả dark + light theme (`:root[data-theme="light"]`).
- Verify contrast ≥ 4.5:1 với nền tương ứng.

### Icon

- Dùng **`lucide-react`** (đã cài, tree-shakeable). Không dùng emoji làm icon UI structural.
- Icon-only button PHẢI có `aria-label` mô tả hành động: `<Button icon={<Play />} aria-label="Chạy workflow" />`.
- Kích thước icon nhất quán: `size={14}` cho small button, `size={16}` cho medium, `size={18}` cho large. Không mix random.
- Trong text log/message có thể dùng emoji (`✅`, `❌`, `⏹`, `🎧`…) vì đây là content chứ không phải icon UI — đã tồn tại trong log BE, giữ nguyên.

### Animation

- Duration 150-300ms cho micro-interaction, ≤ 400ms cho complex transition.
- Bọc CSS animation trong `@media (prefers-reduced-motion: no-preference)` hoặc dùng CSS custom property để user pref tự tắt.
- Không animate `width/height/top/left` — chỉ `transform`/`opacity`.

### Cross-tab & realtime

- Trạng thái Chạy/Dừng đã dùng `BroadcastChannel('pyflow_active_runs')` — mọi mutation `activeRuns` từ FE phải qua `useStore.setActiveRun/clearActiveRun` để tự động phát cho tab khác.
- Log SSE có auto-reconnect với `offset += received` — không tự close EventSource trong `onerror`.

## Khi làm việc trên Backend (Python)

- Async FastAPI + SQLAlchemy 2.x async. Trong route dùng `AsyncSession`; trong executor thread (`services/executor_blocks.py`) dùng `sqlite3` sync (2 kênh song song trên cùng file, WAL mode).
- Executor call phải dùng `_WORKFLOW_EXECUTOR` (256 workers) từ [`services/executor.py`](backend/services/executor.py), **không** `asyncio.to_thread` (cạn default pool nếu có nhiều Telegram Listener idle).
- Rename thư mục project/workflow phải qua `rename_project_dir` / `rename_workflow_dir` **trước** commit DB; rollback nếu commit fail.
- Xoá workflow/project phải gọi `_stop_and_wait_workflow_runs` **trước** khi `rmtree` folder.
- Interpolate `{{var}}` dùng `re.sub` 1 lượt trong [`services/executor_blocks.py`](backend/services/executor_blocks.py) — **không** for-loop replace (chain-replace nguy cơ rò rỉ biến).
- Update endpoint nhận `expected_updated_at` → so với DB, trả 409 nếu lệch (ETag pattern).
- Telegram Listener persist qua cột `workflow.listener_on` — set True khi bật, False khi dừng; startup [`main.py`](backend/main.py) `reload_telegram_listeners` tự bật lại cho user active.

## Quy ước biến output của khối (BẮT BUỘC khi thêm/sửa khối)

**Nguyên tắc gốc: tên biến người dùng gõ trên giao diện là TÊN DUY NHẤT của biến.** Nó là key thật trong `current_input` (tức `input_data` của khối Python sau) *và* trong `workflow_env` (tức `{{ten_bien}}`). Không bao giờ để "giao diện 1 tên, chạy 1 tên" — đây là bug đã trả giá thật (khối EXEC đặt tên riêng nhưng code vẫn trả `result`, người dùng đọc `input_data['result']` ra rỗng mà không có log nào báo).

Khi thêm khối mới có trả dữ liệu ra, hoặc thêm giá trị trả về cho khối cũ:

1. **Khai vào `BLOCK_OUTPUT_VARS`** trong [`services/executor_blocks.py`](backend/services/executor_blocks.py) theo dạng `btype: [(ten_key_goc, tenFieldTrenUI), ...]`, rồi gọi `rename_output_keys(btype, bdata, output)` **ngay tại chỗ gán `current_input`**. Không tự viết `workflow_env[ten_custom] = ...` rải rác — cơ chế bí danh cũ đã bỏ. Khai xong là **tự có** dòng log `📦 [<label>] Biến trả về: <tên thật> (N phần tử)` qua `describe_output_vars()`; đừng tự log tên biến ở từng khối.
2. **Thêm tên field vào `NON_INTERPOLATED_KEYS`** cùng file. Ô tên biến **không được nội suy**: `interpolate()` có nhánh "gõ tên trần không cần `{{}}`" (`if val in ctx: return str(ctx[val])`), nên nếu không loại trừ thì từ vòng lặp thứ 2 ô tên biến bị thay bằng chính **giá trị** của biến đó → dữ liệu ghi vào key rác, `{{ten_bien}}` đứng im ở giá trị vòng đầu.
3. **FE dùng `renderVarNameField()`** trong [`BlockEditorModal.jsx`](frontend/src/components/BlockEditorModal.jsx) — đã kèm `VAR_NAME_RULE` (validate `[A-Za-z_][A-Za-z0-9_]*`) và `VAR_NAME_HINT`. Không tự viết `Form.Item` + `Input` trần cho ô tên biến.
4. **Giá trị mặc định trên UI phải trùng tên key gốc.** Nhờ vậy `rename_output_keys` thành no-op và workflow cũ chạy y như trước — đây là lý do việc đổi sang "tên UI là tên thật" không phá workflow nào.
5. **1 giá trị = 1 tên.** Không ghi thêm key cố định song song bên cạnh tên custom (kiểu `row_count` cũ của khối đọc Excel/Sheets — đã bỏ).
6. **Không lưu nguyên object dưới tên biến.** `{{...}}` không truy cập field con (`{{ten.field}}` không hoạt động) nên mỗi giá trị phải có 1 field đặt tên riêng. Từng có `workflow_env[outputVarName] = current_input` làm `{{file_name}}` trả về cả dict — đã bỏ, đừng thêm lại.
7. **Payload từ bên ngoài không được nội suy.** `_initial_input` (tin nhắn Telegram) nằm trong `NON_INTERPOLATED_KEYS` vì người ngoài nhắn `{{password_web}}` sẽ khiến chuỗi đó bị thay bằng chính secret trong `input.json`. Dữ liệu nhận từ ngoài đi vào set này, không phải ô cấu hình.
8. **Trước khi đổi/bỏ một key**, quét `graph_json` trong `backend/data/pyflow.db` xem workflow thật đang tham chiếu tên đó qua đâu — `{{...}}` trong cấu hình, `condVariable` của Condition, `loopArrayVar` của Loop, và string literal trong `code` của khối Python. Đừng đoán.
9. **Khối tiêu thụ biến:** Condition đọc `current_input` (không đọc `workflow_env`) — cố ý, vì thêm fallback sẽ đổi kết quả rẽ nhánh của các workflow đang chạy. Loop đọc `loopArrayVar` (chấp cả `{{ten}}` và tên trần). Khối Python đọc được **cả hai** kênh.

Chi tiết đầy đủ + bảng field theo từng khối: README §"Biến toàn cục (`{{var}}` & `workflow_env`)" mục 3.

## Bảo mật (sản phẩm CÓ giao cho khách — không còn là "app local")

Có hệ thống license + `Releases/` + tự cập nhật, tức app chạy trên máy người khác. Các hàng rào dưới đây đã trả giá bằng lỗ hổng thật, **đừng gỡ**:

- **Route phục vụ frontend** ([main.py](backend/main.py)) phải `resolve()` + kiểm `is_relative_to(dist)`. Bỏ ra là `GET /..%2f..%2fbackend%2fdata%2fpyflow.db` tải được nguyên database (chứa mật khẩu DB + API key LLM plaintext).
- **`licensing.ENFORCE`** phải bật cứng theo `sys.frozen`, KHÔNG chỉ đọc env — cờ env chỉ nằm trong `start.vbs`, khách bấm thẳng `.exe` là mở khoá toàn bộ.
- **Mọi giá trị đi qua `interpolate()` đều có thể do người ngoài điều khiển** (tin nhắn Telegram, ô Google Sheet). Vì vậy:
  - Nhúng vào code sinh ra phải dùng `!r` (xem `sql_query` trong khối `sql_to_excel`).
  - Tên bảng SQL phải qua `_VALID_TABLE_NAME`.
  - Tên file phải qua `safe_filename()` — kể cả file đính kèm Telegram/Email.
  - Nội suy phải là **một lượt `re.sub`** (`interpolate` ở executor, `_interpolate_once` ở [browser_executor.py](backend/services/browser_executor.py)). For-loop `replace` gây chain-replace làm rò mật khẩu từ `input.json`.
- **`_csrf_guard`** trong main.py kiểm `Origin`/`Sec-Fetch-Site`: CORS chỉ chặn ĐỌC response, không chặn GỬI request.
- **Không trả `password` của `DbConnection` ra API** và không đóng gói vào file export. Ô mật khẩu để trống khi sửa = giữ nguyên.
- **`update.zip` PHẢI được ký và verify** ([services/update_signing.py](backend/services/update_signing.py)). Đây là kênh phân phối code tới máy khách: không verify thì ai sửa được asset của GitHub Release là mọi máy khách bấm "Cập nhật" sẽ chạy code lạ. Client **từ chối** bản cập nhật không có `update.zip.sig`, và không còn fallback về `zipball_url`.
  Dùng lại đúng cặp khoá Ed25519 của license, nhưng **tách miền**: chuỗi ký là `b"pyflow-update-v1:" + sha256_hex`, nên chữ ký update không thể đem dùng làm license và ngược lại. Đổi tiền tố này = mọi bản đã phát hành bị từ chối.

## SQLite: WAL

`database.py` bật WAL + `busy_timeout=15000` qua `apply_sqlite_pragmas()` cho **cả 2 engine**. Trong thread executor phải dùng **`connect_sqlite()`**, không `sqlite3.connect()` trần — một kết nối quên bật là đủ gây `database is locked` và làm run kẹt RUNNING.

`run_workflow_internal` tách 3 đoạn session ngắn; **`execute_workflow()` chạy NGOÀI mọi session** (workflow có Telegram Listener sống hàng tuần, giữ session là cạn pool).

## Multi-user

Hệ thống có nhiều user, chỉ **1 user `is_active=True`** tại 1 thời điểm. **Chỉ schedule/listener của user active mới chạy** — đây là design intentional, đừng "fix". Xem README §Multi-user để biết cách activate + reload.

## Testing / Verify

- Sau khi sửa UI, phải **preview + verify** qua `mcp__Claude_Browser__preview_start` (config sẵn ở [`.claude/launch.json`](.claude/launch.json)). Đọc console messages, xác nhận không có warning antd/React mới.
- Chạy 1 workflow thật cuối cùng để verify không regression.
- Trước khi báo xong, chạy Pre-Delivery Checklist của skill (mục "Pre-Delivery Checklist" ở cuối SKILL.md).

## Commit style

Tiếng Việt, format:
```
<type>: <mô tả ngắn>

<body chi tiết theo section (Backend/Frontend/…) nếu là compound change>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

Type: `fix`/`feat`/`refactor`/`chore`/`docs`/`perf`.

## Chỉ hỗ trợ Windows

Dự án là **Windows-only có chủ đích**. Bản đóng gói do PyInstaller build trên Windows, mà PyInstaller **không cross-compile** — muốn có bản macOS thì phải có một máy Mac để build, và đó là việc đã quyết định không làm.

Toàn bộ nhánh POSIX đã được gỡ (09/2026): 4 file `.sh` ở gốc, `start_mac.command` trong build script, nhánh `updater.sh`, `xdg-open`/`open` ở `files.py`, `chrome-mac*`/`~/Library/Caches` ở `browser_executor.py`, `bin/python` ở `venv_manager.py`, `ioreg` ở `licensing.py`.

Bối cảnh: phần macOS trước đây là **cái vỏ viết sẵn cho bản build chưa từng tồn tại** — `start_mac.command` gọi `./pyflow-backend` trong khi zip chỉ có `pyflow-backend.exe`. Nó không hoạt động ngày nào, chỉ gây hiểu nhầm.

⚠ Hai thứ **KHÔNG được nhầm là "rác macOS"**:
- `.replace('\', '/')` trong `executor_blocks.py` — dùng khi nhúng đường dẫn Windows vào **mã Python sinh ra**; bỏ đi thì `
`, `	`, `
` trong path thành ký tự điều khiển.
- `mac-node:` ở `licensing.py` — đó là **MAC address** của card mạng (fallback vân tay máy), không liên quan macOS.
- `licensing._raw_machine_id()` phải giữ nguyên chuỗi `win:{MachineGuid}`: mọi license đã cấp đều ký trên đúng chuỗi đó.

## Không được làm

- Không commit `backend/data/`, `*.db`, `.env`, `node_modules/`, `.venv/` (đã gitignore).
- Không đổi port 7000/9000 (đã hardcode ở nhiều nơi — nếu thực sự cần đổi, xem README §Gotchas → Port).
- Không thêm multi-worker uvicorn (state in-memory sẽ vỡ).
- Không add auth token/session giả trong FE — hệ thống local-only, `X-User-Id` là đủ.
- Không revert các fix ETag/rename/SSE reconnect/BroadcastChannel/ThreadPoolExecutor riêng — đều có lý do đã ghi.
- Không bỏ `connect_sqlite()` để quay lại `sqlite3.connect()` trần (mất WAL/busy_timeout).
- Không bọc `execute_workflow()` trong `async with AsyncSessionLocal()` — cạn connection pool khi có Telegram Listener.
- Không dùng `asyncio.create_task` trần trong routers — dùng `_spawn()` để giữ tham chiếu mạnh (task có thể bị GC giữa chừng).
- Không pop listener khỏi `_active_listeners`/`_stop_events`/`_active_configs` theo key — phải so **danh tính task** (`is`), nếu không sẽ chạy 2 listener cùng bot token và mỗi tin nhắn kích hoạt workflow 2 lần.
- Không bỏ `run_id` khỏi đường dẫn `runs/<run_id>/<khối>/main.py` — 2 run song song sẽ ghi đè code của nhau.
- Không commit `Releases/` hay `pyflow-studio/` (build artifact) — xem `.gitignore`.
- Không thêm lại nhánh macOS/Linux (`sys.platform == "darwin"`, `xdg-open`, `pkill`, `chrome-mac*`, file `.sh`, `start_mac.command`). Xem §Chỉ hỗ trợ Windows.
- Không quay lại cơ chế "bí danh": trả key tên gốc trong `current_input` rồi chỉ ghi tên custom vào `workflow_env`. Xem §Quy ước biến output của khối.
- Không bỏ field nào ra khỏi `NON_INTERPOLATED_KEYS`, và không thêm field "tên biến" mới mà quên khai vào đó.
