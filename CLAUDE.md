# CLAUDE.md — PyFlow Studio

Claude Code tự đọc file này mỗi session. Quy tắc riêng từng phần nằm cạnh code và được nạp khi làm ở đó:

- [backend/CLAUDE.md](backend/CLAUDE.md) — executor, khối, biến output, bảo mật, SQLite, phát hành.
- [frontend/CLAUDE.md](frontend/CLAUDE.md) — i18n, checklist giao diện, token màu, icon.
- [README.md](README.md) — tài liệu tham chiếu: kiến trúc, từng loại khối, API, gotchas.

## Nguyên tắc chung

- Giao tiếp bằng **tiếng Việt** (user Việt Nam; log, UI, commit message đều tiếng Việt).
- Fix root cause, không workaround. Buộc phải workaround thì ghi rõ lý do trong comment.
- Bám sát gotchas trong README §"Điểm cần lưu ý" và hai file CLAUDE.md con — đó là những chỗ đã trả giá bằng bug thật, đừng revert.
- **Bám pattern đã có**, không dựng cấu trúc song song. Trước khi thêm field/route/component, tìm pattern gần giống rồi làm y cách đó (VD lưu 1 setting theo user: `models.py` cột mới → `database.py` migration nhẹ → `routers/users.py` endpoint `PATCH` riêng → `api/client.js` + `useStore.js`, giống `language`/`workflow_view_mode`).
- **Không tự ý phá cấu trúc.** Yêu cầu buộc đổi thứ đang tồn tại (tên field đang dùng, route, bảng DB, kiến trúc component) hoặc còn mơ hồ → dừng lại hỏi bằng `AskUserQuestion`, nêu 2-3 phương án. Không tự quyết rồi âm thầm làm khác ý.

## Kiểm tra trước khi báo xong

| Việc | Lệnh (chạy trong thư mục tương ứng) |
|---|---|
| Test backend | `backend\.venv\Scripts\python.exe -m pytest` (lần đầu: `pip install -r requirements-dev.txt`) |
| Lint Python | `backend\.venv\Scripts\python.exe -m ruff check . ../tools` |
| Lint JS | `npx oxlint src` (trong `frontend/`) |
| Build FE | `npm run build` |
| Test đầu-cuối giao diện | `npm run build` rồi `backend\.venv\Scripts\python.exe -m pytest -m e2e tests/e2e` (trong `backend/`, cần cổng 8000 trống) |

- **CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) chạy đủ các việc trên mỗi lần push lên `main`, trên Windows runner. Push xong xem kết quả CI.
- [`backend/tests/test_conventions.py`](backend/tests/test_conventions.py) biến các quy tắc dễ quên thành test (ô tên biến ↔ `NON_INTERPOLATED_KEYS`, cấm `sqlite3.connect` trần, vi/en cùng bộ key, mọi `t('a.b')` có key…). **Test đỏ = vừa vi phạm quy tắc — sửa code, đừng nới test.**
- Hook [`.claude/hooks/check-locale.js`](.claude/hooks/check-locale.js) tự kiểm JSON mỗi khi sửa file locale.
- Sửa UI → preview + verify qua `mcp__Claude_Browser__preview_start` ([.claude/launch.json](.claude/launch.json)), đọc console, không có warning antd/React mới.
- Sửa executor/handler → chạy 1 workflow thật cuối cùng để chắc không regression. **Chặn mọi request ghi (XHR/fetch/sendBeacon) trước khi mở editor của workflow thật** — autosave từng ghi đè workflow của user khi test.

## Commit

Tiếng Việt, commit thẳng `main` (đã thống nhất), mỗi thay đổi một commit:

```
<type>: <mô tả ngắn>

<body theo section Backend/Frontend/… nếu là thay đổi nhiều phần>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Type: `fix`/`feat`/`refactor`/`chore`/`docs`/`perf`. Repo nằm trong thư mục thuộc user Windows cũ → lệnh git cần `git -c "safe.directory=D:/Local Dev/workflow" …` (code của app đã tự kèm cờ này).

## Chỉ hỗ trợ Windows

Có chủ đích: bản đóng gói do PyInstaller build trên Windows, không cross-compile. Toàn bộ nhánh POSIX đã gỡ (09/2026) — trước đó là cái vỏ cho bản macOS chưa từng tồn tại. **Không thêm lại** `sys.platform == "darwin"`, `xdg-open`, `pkill`, `chrome-mac*`, file `.sh`, `start_mac.command`.

⚠ Đừng nhầm là "rác macOS":
- `.replace('\\', '/')` khi nhúng đường dẫn Windows vào mã Python sinh ra — bỏ đi thì `\n`, `\t` trong path thành ký tự điều khiển.
- `mac-node:` ở `licensing.py` là **MAC address** card mạng (vân tay máy).
- `licensing._raw_machine_id()` phải giữ chuỗi `win:{MachineGuid}` — mọi license đã cấp ký trên chuỗi đó.

## Không được làm (chung)

- Không commit `backend/data/`, `*.db`, `.env`, `node_modules/`, `.venv/`, `Releases/`, `pyflow-studio/`, `secrets/`, `*.spec` (đã gitignore).
- Không đổi port 7000/9000 (bản đóng gói: 8000) — hardcode nhiều nơi, xem README §Gotchas → Port.
- Không thêm multi-worker uvicorn (state in-memory sẽ vỡ).
- Không thêm auth token/session giả ở FE — app local-only, `X-User-Id` là đủ.
- Không revert các fix ETag/rename/SSE reconnect/BroadcastChannel/ThreadPoolExecutor riêng — đều có lý do đã ghi.
