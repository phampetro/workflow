# frontend/CLAUDE.md — quy tắc khi làm ở frontend

Nạp kèm [CLAUDE.md gốc](../CLAUDE.md). React 19 + Vite + Ant Design 6 + React Flow + Zustand.

## Song ngữ Việt/Anh (bắt buộc)

- Mọi chuỗi giao diện tĩnh mới (nút, label, modal, tooltip, toast, validate) → thêm key vào **cả** `src/i18n/locales/vi.json` và `en.json`, dùng `t('...')`. Không hardcode chuỗi trong JSX, không dùng `defaultValue` tiếng Việt thay cho key (giao diện tiếng Anh sẽ hiện tiếng Việt).
- Message từ backend: đọc field `code` rồi dịch qua `t()` (mẫu: `AboutModal.jsx`), không hiển thị nguyên văn `message`.
- Hook `.claude/hooks/check-locale.js` tự kiểm JSON sau mỗi lần sửa locale — dấu ngoặc kép cong (" ") gõ nhầm làm hỏng âm thầm cả file, kéo theo lỗi Vite HMR ở file không liên quan. Test `test_conventions.py` kiểm vi/en cùng bộ key và mọi `t('a.b')` tĩnh đều có key.

## Checklist giao diện (phải qua trước khi báo xong)

Rút từ skill [`ui-ux-pro-max`](../.agents/skills/ui-ux-pro-max/SKILL.md) phần áp dụng cho dự án này. Skill đầy đủ vẫn dùng được khi thiết kế màn mới (`python .agents/skills/ui-ux-pro-max/scripts/search.py "<mô tả>" --design-system -p "PyFlow Studio"`).

**Accessibility**
- Tương phản chữ ≥ **4,5:1** trên nền của **cả 2 theme**.
- Icon-only button có `aria-label` mô tả hành động: `<Button icon={<Play />} aria-label={t('...')} />`.
- Input có label gắn đúng; ảnh có `alt`. Không dùng màu làm tín hiệu duy nhất (kèm icon/chữ).
- Giữ vòng focus thấy được.

**Tương tác**
- Phản hồi trong ~100ms; nút async phải `loading`/`disabled` khi đang chạy (VD nút Import trên Navbar).
- Không dựa vào hover để lộ thông tin quan trọng (VD lý do cần cài gói hiện ngay dưới gói, không giấu trong tooltip).
- Lỗi rõ ràng, đặt gần trường lỗi.

**Hiệu năng**
- Danh sách ≥ 50 phần tử → virtualize (`react-window`/`react-virtuoso`).
- Ảnh dưới màn hình đầu `loading="lazy"`; giữ chỗ cho nội dung async (CLS < 0.1); debounce/throttle scroll/resize.

## Token màu & CSS

Dùng CSS variable trong [src/index.css](src/index.css), **không hardcode hex** trong component:
- Nền: `--bg-base`, `--bg-surface`, `--bg-elevated`, `--bg-hover`
- Chữ: `--text-primary`, `--text-secondary`, `--text-muted`
- Viền: `--border-default`, `--border-subtle`, `--border-accent`
- Nhấn: `--accent-primary`, `--accent-secondary`, `--accent-warning`, `--accent-danger`, `--accent-success`
- Cỡ chữ: `--text-xs..--text-3xl`

Mọi biến có bản `:root[data-theme="light"]`; thêm token mới phải khai cả 2 chế độ và đo tương phản. ⚠ Bộ `--accent-*` có bản riêng cho light theme (`#0f766e`, `#b45309`, `#15803d`…) vì bản dark trên nền trắng chỉ đạt 2,1–3,7:1. Màu ngoài palette (màu log level, syntax highlight) → thành biến riêng (`--log-info`…) đủ 2 theme.

⚠ Trong `theme.components` của `ConfigProvider` ([src/App.jsx](src/App.jsx)) mỗi component **chỉ khai MỘT key** — khai 2 lần thì key sau xoá sạch key trước (từng mất `activeShadow` của Select).

⚠ Animation dùng chung khai trong `index.css`, không nhúng `<style>` trong component (`@keyframes spin` từng không tồn tại → mọi spinner đứng im). CSS khối canvas ở [BlockNode.css](src/components/BlockNode.css).

## Icon & animation

- Icon dùng **`lucide-react`**; không dùng emoji làm icon UI. Cỡ: `14` nút nhỏ, `16` vừa, `18` lớn — không trộn tuỳ ý. Emoji trong nội dung log (`✅`, `❌`, `⏹`) là content, giữ nguyên.
- Animation 150–300ms (≤ 400ms cho chuyển cảnh phức tạp), chỉ animate `transform`/`opacity`, bọc trong `@media (prefers-reduced-motion: no-preference)`.

## Realtime & đồng bộ tab

- Trạng thái Chạy/Dừng dùng `BroadcastChannel('pyflow_active_runs')` — mọi thay đổi `activeRuns` phải qua `useStore.setActiveRun/clearActiveRun`. Nút Chạy/Dừng theo **trạng thái run trong DB** (poll), không theo dòng log cuối.
- Log SSE tự reconnect với `offset += received` — không tự đóng EventSource trong `onerror`.
- Autosave workflow debounce 1.5s kèm `expected_updated_at`; 409 → hỏi "Tải lại / Ghi đè".

## Form cấu hình khối

`components/BlockEditorModal.jsx` là khung (state chung, `onSave`, layout drawer). Phần tự đóng gói được nằm ở `components/block-editor/`: `BrowserStepEditorPanel`, `ExcelEditStepsEditor`, `InputFieldsEditor`, `PositionSelector`, `constants.js` (mã mặc định, `getVarNameRule/Hint`). Thêm editor dạng danh sách mới → làm theo mẫu `ExcelEditStepsEditor`: state vẫn ở modal (vì `onSave` cần), component con nhận `value` + `setValue` và giữ các hàm thao tác.

⚠ Khi tách/đổi tên bằng tìm-thay, **dùng ranh giới từ** (`\bten\b`): thay `excelEditSteps` trần từng đổi luôn key dịch `blockEditor.excelEditStepsTitle` → key không tồn tại (test_conventions bắt được).

## Lint

`npx oxlint src` — chỉ lỗi làm đỏ CI. Đã bật `no-undef` (env browser): thiếu import là lỗi lúc build, không đợi người dùng bấm mới văng (từng thiếu `toast` khi tách panel Trình duyệt). Cảnh báo còn lại chủ yếu là `react-hooks/exhaustive-deps`: **đừng thêm dependency hàng loạt cho hết cảnh báo** — nhiều effect cố ý chỉ chạy khi mở form; thêm sai là chạy lặp hoặc ghi đè dữ liệu người dùng đang gõ.
