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

## Không được làm

- Không commit `backend/data/`, `*.db`, `.env`, `node_modules/`, `.venv/` (đã gitignore).
- Không đổi port 7000/9000 (đã hardcode ở nhiều nơi — nếu thực sự cần đổi, xem README §Gotchas → Port).
- Không thêm multi-worker uvicorn (state in-memory sẽ vỡ).
- Không add auth token/session giả trong FE — hệ thống local-only, `X-User-Id` là đủ.
- Không revert các fix ETag/rename/SSE reconnect/BroadcastChannel/ThreadPoolExecutor riêng — đều có lý do đã ghi.
