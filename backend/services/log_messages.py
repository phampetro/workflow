"""Catalog thông báo song ngữ (VI/EN) cho log runtime workflow (Log Drawer).

Chỉ áp dụng cho log SINH RA TỪ THỜI ĐIỂM CHẠY — mỗi lượt chạy dùng NGUYÊN 1 ngôn
ngữ (ngôn ngữ của user active tại lúc bấm Chạy/Telegram/Schedule kích hoạt), lấy
từ `User.language`. Log của các run ĐÃ LƯU TRƯỚC ĐÂY là text tiếng Việt thuần,
không có key — không đụng vào, hiển thị y nguyên như cũ (không có việc migrate).

Không dùng cho: log hệ thống qua `logging` chuẩn (console/file — dev only, không
lên Log Drawer), và nội dung do CHÍNH workflow sinh ra (stdout/stderr của khối
Python người dùng viết, output pip, thông báo lỗi thô từ Telegram/DB API) — những
thứ đó là dữ liệu, không phải chuỗi giao diện của app.

Thêm message mới: thêm 1 entry vào MESSAGES với key mô tả ngắn gọn, đủ cả "vi"
và "en", rồi gọi `tr(language, "key", **kwargs)` tại điểm log_fn/log.
"""

MESSAGES = {
    # ── Vòng đời workflow ───────────────────────────────────────────────
    "workflow_start": {
        "vi": "🚀 Bắt đầu workflow (Dynamic Routing)",
        "en": "🚀 Starting workflow (Dynamic Routing)",
    },
    "workflow_done": {
        "vi": "✅ Workflow hoàn thành trong {ms}ms",
        "en": "✅ Workflow completed in {ms}ms",
    },
    "workflow_stopped_total": {
        "vi": "⏹ Đã dừng sau {ms}ms",
        "en": "⏹ Stopped after {ms}ms",
    },
    "workflow_failed": {
        "vi": "❌ Workflow thất bại sau {ms}ms",
        "en": "❌ Workflow failed after {ms}ms",
    },
    "workflow_system_error": {
        "vi": "❌ Lỗi hệ thống khi chạy workflow: {error}",
        "en": "❌ System error while running workflow: {error}",
    },
    "workflow_stopped_by_user": {
        "vi": "⏹ Đã dừng bởi người dùng",
        "en": "⏹ Stopped by user",
    },
    "workflow_prepare_dir_error": {
        "vi": "❌ Lỗi chuẩn bị thư mục workflow: {error}",
        "en": "❌ Error preparing workflow directory: {error}",
    },
    "no_start_block": {
        "vi": "❌ Không tìm thấy khối Bắt đầu!",
        "en": "❌ Start block not found!",
    },
    "infinite_loop_detected": {
        "vi": "❌ Phát hiện lặp vô hạn ở Node {node_id} (>2000 lần). Dừng luồng.",
        "en": "❌ Infinite loop detected at Node {node_id} (>2000 iterations). Stopping flow.",
    },
    "error_redirect": {
        "vi": "⚠️ Phát hiện lỗi{suffix}. Đang chuyển hướng sang khối Bắt Lỗi toàn cục...",
        "en": "⚠️ Error detected{suffix}. Redirecting to the global Error Handler block...",
    },
    "error_redirect_suffix": {
        "vi": " tại [{label}]",
        "en": " at [{label}]",
    },
    "unsupported_block_type": {
        "vi": "⚠️ Khối [{label}] có loại '{btype}' không còn được hỗ trợ — đã bỏ qua, "
              "dữ liệu truyền thẳng sang khối kế. Hãy xoá khối này khỏi sơ đồ.",
        "en": "⚠️ Block [{label}] has type '{btype}' which is no longer supported — skipped, "
              "data passed straight through to the next block. Please remove this block from the diagram.",
    },
    "finish_run_write_error": {
        "vi": "⚠ Không ghi được trạng thái kết thúc vào database: {error}",
        "en": "⚠ Could not write final status to database: {error}",
    },

    # ── Vòng đời 1 block (dùng chung mọi loại khối) ────────────────────
    "block_start": {
        "vi": "▶  Chạy block [{label}]",
        "en": "▶  Running block [{label}]",
    },
    "block_success": {
        "vi": "✓ Block hoàn thành ({duration}ms)",
        "en": "✓ Block completed ({duration}ms)",
    },
    "block_stopped": {
        "vi": "⏹ Block đã bị dừng ({duration}ms)",
        "en": "⏹ Block was stopped ({duration}ms)",
    },
    "block_failed": {
        "vi": "✗ Block thất bại ({duration}ms)",
        "en": "✗ Block failed ({duration}ms)",
    },
    "block_exception": {
        "vi": "✗ Lỗi: {error}",
        "en": "✗ Error: {error}",
    },
    "block_timeout": {
        "vi": "⏰ Timeout sau {timeout}s",
        "en": "⏰ Timed out after {timeout}s",
    },
    "output_vars_line": {
        "vi": "📦 [{label}] Biến trả về: {desc}",
        "en": "📦 [{label}] Output variable: {desc}",
    },
    "output_var_elements": {
        "vi": "{name} ({count} phần tử)",
        "en": "{name} ({count} items)",
    },
    "output_var_object": {
        "vi": "{name} (object, {count} khoá)",
        "en": "{name} (object, {count} keys)",
    },
    "output_var_empty": {
        "vi": "{name} (rỗng)",
        "en": "{name} (empty)",
    },

    # ── Cài thư viện (ensure_packages) ──────────────────────────────────
    "ensure_packages_installing": {
        "vi": "📦 [{label}] Đang tải & cài đặt: {packages}...",
        "en": "📦 [{label}] Downloading & installing: {packages}...",
    },
    "ensure_packages_stopped": {
        "vi": "⏹ Cài đặt bị dừng bởi người dùng",
        "en": "⏹ Installation stopped by user",
    },
    "ensure_packages_timeout": {
        "vi": "❌ Cài đặt timeout sau 5 phút",
        "en": "❌ Installation timed out after 5 minutes",
    },
    "ensure_packages_failed": {
        "vi": "❌ Cài đặt thất bại mã {code}",
        "en": "❌ Installation failed with code {code}",
    },

    # ── Telegram Listener (bật/tắt, không phải nội dung tin nhắn) ──────
    "listener_stop_error": {
        "vi": "⚠ Không tắt được listener: {error}",
        "en": "⚠ Could not stop listener: {error}",
    },

    # ── Loop ─────────────────────────────────────────────────────────
    "loop_delay": {
        "vi": "⏳ [Loop] Nghỉ {delay}s trước khi lặp lại...",
        "en": "⏳ [Loop] Waiting {delay}s before looping again...",
    },

    # ── Start/End/Delay/Input Variables/Queue ───────────────────────────
    "start_block": {
        "vi": "▶  [Start] {label}",
        "en": "▶  [Start] {label}",
    },
    "end_block": {
        "vi": "🏁 [End] {label}",
        "en": "🏁 [End] {label}",
    },
    "delay_waiting": {
        "vi": "⏳ [Delay] {label} - Đang chờ {delay} giây...",
        "en": "⏳ [Delay] {label} - Waiting {delay}s...",
    },
    "delay_stopped": {
        "vi": "⏹ Delay bị dừng sau {waited}s",
        "en": "⏹ Delay stopped after {waited}s",
    },
    "delay_done": {
        "vi": "✅ Đã chờ xong {delay} giây.",
        "en": "✅ Wait finished ({delay}s).",
    },
    "input_vars_not_configured": {
        "vi": "⚠️ [Biến đầu vào] {label} - Chưa cấu hình biến, bỏ qua.",
        "en": "⚠️ [Input Variables] {label} - No variables configured, skipping.",
    },
    "input_vars_waiting": {
        "vi": "⌨️ [Biến đầu vào] {label} - Chờ người dùng nhập {count} biến (tối đa {timeout}s)...",
        "en": "⌨️ [Input Variables] {label} - Waiting for user to enter {count} variable(s) (up to {timeout}s)...",
    },
    "input_vars_stopped": {
        "vi": "⏹ [Biến đầu vào] Bị dừng bởi người dùng",
        "en": "⏹ [Input Variables] Stopped by user",
    },
    "input_vars_timeout": {
        "vi": "⏱ Hết thời gian chờ nhập biến ({timeout}s) tại khối [{label}]",
        "en": "⏱ Timed out waiting for variable input ({timeout}s) at block [{label}]",
    },
    "input_vars_received": {
        "vi": "✅ [Biến đầu vào] Đã nhận: {names}",
        "en": "✅ [Input Variables] Received: {names}",
    },
    "queue_turn": {
        "vi": "⏳ [Xếp hàng] {label} - Đã tới lượt, chạy tiếp",
        "en": "⏳ [Queue] {label} - It's your turn, continuing",
    },

    # ── Telegram Listener (bật/tắt) ──────────────────────────────────
    "tg_listener_received": {
        "vi": "🎧 [Telegram Listener] {label} - Đã nhận tin nhắn và chạy workflow",
        "en": "🎧 [Telegram Listener] {label} - Message received, running workflow",
    },
    "tg_listener_enabling": {
        "vi": "🎧 [Telegram Listener] {label} - Đang bật Listener để chờ tin nhắn...",
        "en": "🎧 [Telegram Listener] {label} - Enabling listener, waiting for messages...",
    },
    "tg_listener_config_changed": {
        "vi": "🔄 Bot Token/lệnh đã đổi - khởi động lại Listener...",
        "en": "🔄 Bot Token/commands changed - restarting listener...",
    },
    "tg_listener_enabled": {
        "vi": "✅ Listener đã được bật. Đang lắng nghe tin nhắn Telegram...",
        "en": "✅ Listener enabled. Listening for Telegram messages...",
    },
    "tg_listener_already_running": {
        "vi": "ℹ️ Listener đã chạy sẵn.",
        "en": "ℹ️ Listener is already running.",
    },
    "tg_listener_enable_error": {
        "vi": "⚠ Lỗi khi bật listener: {error}",
        "en": "⚠ Error enabling listener: {error}",
    },
    "tg_listener_stopping": {
        "vi": "⏹ Đang tắt Listener theo yêu cầu người dùng...",
        "en": "⏹ Stopping listener at user's request...",
    },
    "tg_listener_dead": {
        "vi": "❌ Telegram Listener đã ngừng hoạt động (token bị thu hồi hoặc mất kết nối). Bấm Chạy lại sau khi kiểm tra cấu hình.",
        "en": "❌ Telegram Listener has stopped (token revoked or connection lost). Click Run again after checking your configuration.",
    },

    # ── Telegram gửi tin ─────────────────────────────────────────────
    "tg_missing_config": {
        "vi": "❌ [Telegram] {label} - Thiếu Bot Token hoặc Chat ID",
        "en": "❌ [Telegram] {label} - Missing Bot Token or Chat ID",
    },
    "tg_attachment_not_found": {
        "vi": "⚠ [Telegram] Không tìm thấy file đính kèm: {name}",
        "en": "⚠ [Telegram] Attachment not found: {name}",
    },
    "tg_sending": {
        "vi": "✉️ [Telegram] {label} - Đang gửi tin nhắn tới {chat_id}...",
        "en": "✉️ [Telegram] {label} - Sending message to {chat_id}...",
    },
    "tg_edit_invalid_id": {
        "vi": "❌ [Telegram] {label} - Lỗi: Chế độ 'Sửa tin nhắn' yêu cầu Message ID hợp lệ.",
        "en": "❌ [Telegram] {label} - Error: 'Edit message' mode requires a valid Message ID.",
    },
    "tg_msg_id_not_number": {
        "vi": "❌ [Telegram] {label} - Lỗi: Message ID phải là số (hiện tại là '{msg_id}'). Hãy kiểm tra lại biến.",
        "en": "❌ [Telegram] {label} - Error: Message ID must be a number (currently '{msg_id}'). Please check the variable.",
    },
    "tg_msg_id_not_number_short": {
        "vi": "❌ [Telegram] {label} - Lỗi: Message ID phải là số (hiện tại là '{msg_id}').",
        "en": "❌ [Telegram] {label} - Error: Message ID must be a number (currently '{msg_id}').",
    },
    "tg_edit_error": {
        "vi": "❌ [Telegram] {label} - Lỗi sửa tin nhắn: {description}",
        "en": "❌ [Telegram] {label} - Error editing message: {description}",
    },
    "tg_api_error": {
        "vi": "❌ [Telegram] {label} - Lỗi API: {description}",
        "en": "❌ [Telegram] {label} - API error: {description}",
    },
    "tg_attachment_sending": {
        "vi": "📎 [Telegram] {label} - Đính kèm file: {name}",
        "en": "📎 [Telegram] {label} - Attaching file: {name}",
    },
    "tg_send_file_error": {
        "vi": "❌ [Telegram] {label} - Lỗi gửi file {name}: {description}",
        "en": "❌ [Telegram] {label} - Error sending file {name}: {description}",
    },
    "tg_send_message_error": {
        "vi": "❌ [Telegram] {label} - Lỗi gửi tin nhắn: {description}",
        "en": "❌ [Telegram] {label} - Error sending message: {description}",
    },
    "tg_send_success": {
        "vi": "✅ [Telegram] {label} - Đã gửi thành công! (message_id={message_id})",
        "en": "✅ [Telegram] {label} - Sent successfully! (message_id={message_id})",
    },
    "tg_send_failed_exception": {
        "vi": "❌ [Telegram] {label} - Gửi thất bại: {error}",
        "en": "❌ [Telegram] {label} - Send failed: {error}",
    },

    # ── Email ────────────────────────────────────────────────────────
    "email_sending": {
        "vi": "📧 [Email] {label} - Đang gửi thư tới {to}...",
        "en": "📧 [Email] {label} - Sending email to {to}...",
    },
    "email_attachment_not_found": {
        "vi": "⚠ [Email] Không tìm thấy file đính kèm: {name}",
        "en": "⚠ [Email] Attachment not found: {name}",
    },
    "email_success": {
        "vi": "✅ [Email] {label} - Đã gửi thư thành công!",
        "en": "✅ [Email] {label} - Email sent successfully!",
    },
    "email_error": {
        "vi": "❌ [Email] {label} - Lỗi gửi thư: {error}",
        "en": "❌ [Email] {label} - Error sending email: {error}",
    },

    # ── Xóa file Input/Output ────────────────────────────────────────
    "delete_input_success": {
        "vi": "✅ [Xóa] Đã dọn dẹp thư mục Input.",
        "en": "✅ [Delete] Input folder cleaned up.",
    },
    "delete_input_error": {
        "vi": "❌ [Xóa] Lỗi xóa Input: {error}",
        "en": "❌ [Delete] Error deleting Input: {error}",
    },
    "delete_output_success": {
        "vi": "✅ [Xóa] Đã dọn dẹp thư mục Output.",
        "en": "✅ [Delete] Output folder cleaned up.",
    },
    "delete_output_error": {
        "vi": "❌ [Xóa] Lỗi xóa Output: {error}",
        "en": "❌ [Delete] Error deleting Output: {error}",
    },

    # ── Browser (wrapper trong executor_blocks.py) ──────────────────
    "browser_no_steps": {
        "vi": "⚠️ Block [{label}] không có bước nào, bỏ qua",
        "en": "⚠️ Block [{label}] has no steps, skipping",
    },
    "browser_running": {
        "vi": "🌐 Đang chạy Browser: {label}...",
        "en": "🌐 Running Browser: {label}...",
    },

    # ── Python block ─────────────────────────────────────────────────
    "python_no_code": {
        "vi": "⚠️ Block [{label}] không có code",
        "en": "⚠️ Block [{label}] has no code",
    },
    "python_running": {
        "vi": "⚡ Đang chạy: {label}...",
        "en": "⚡ Running: {label}...",
    },

    # ── SQL to Excel / Merge Excel / Pivot Excel ─────────────────────
    "sql_missing_query": {
        "vi": "⚠️ Block [{label}] không có câu lệnh SQL",
        "en": "⚠️ Block [{label}] has no SQL query",
    },
    "block_missing_db_connection": {
        "vi": "❌ Block [{label}] chưa chọn Kết nối Database",
        "en": "❌ Block [{label}] has no Database Connection selected",
    },
    "sql_to_excel_running": {
        "vi": "⚡ Đang chạy SQL to Excel: {label}...",
        "en": "⚡ Running SQL to Excel: {label}...",
    },
    "merge_excel_no_files": {
        "vi": "❌ Merge Excel: Bạn chưa chọn file nào để gộp!",
        "en": "❌ Merge Excel: No files selected to merge!",
    },
    "merge_excel_running": {
        "vi": "⚡ Đang chạy Merge Excel: {label}...",
        "en": "⚡ Running Merge Excel: {label}...",
    },
    "pivot_excel_no_files": {
        "vi": "❌ Pivot Excel: Bạn chưa chọn file nào để tổng hợp!",
        "en": "❌ Pivot Excel: No files selected to aggregate!",
    },
    "pivot_excel_running": {
        "vi": "📊 Đang chạy Pivot Excel: {label}...",
        "en": "📊 Running Pivot Excel: {label}...",
    },

    # ── Excel to SQL ─────────────────────────────────────────────────
    "excel_to_sql_missing_config": {
        "vi": "❌ Thiếu cấu hình: File nguồn hoặc Bảng đích",
        "en": "❌ Missing configuration: Source file or Target table",
    },
    "excel_to_sql_invalid_table_name": {
        "vi": "❌ Tên bảng đích không hợp lệ: {table_name}. Chỉ cho phép chữ, số, _ và dấu chấm (VD: dbo.don_hang).",
        "en": "❌ Invalid target table name: {table_name}. Only letters, digits, _ and dots are allowed (e.g. dbo.don_hang).",
    },
    "excel_to_sql_running": {
        "vi": "⚡ Đang Import Excel vào SQL Server: {label}...",
        "en": "⚡ Importing Excel into SQL Server: {label}...",
    },

    # ── Run SQL Function (EXEC) ──────────────────────────────────────
    "sql_exec_missing_query": {
        "vi": "⚠️ Block [{label}] không có câu lệnh SQL/EXEC",
        "en": "⚠️ Block [{label}] has no SQL/EXEC statement",
    },
    "sql_exec_running": {
        "vi": "⚡ Đang chạy Hàm/Thủ tục SQL: {label}...",
        "en": "⚡ Running SQL Function/Procedure: {label}...",
    },
    "sql_exec_no_timeout": {
        "vi": "   ⏳ Không giới hạn thời gian — chờ tới khi SQL trả kết quả (bấm Dừng để huỷ)",
        "en": "   ⏳ No time limit — waiting until SQL returns a result (click Stop to cancel)",
    },
    "sql_exec_timeout_limit": {
        "vi": "   ⏳ Giới hạn thời gian: {timeout}s",
        "en": "   ⏳ Time limit: {timeout}s",
    },

    # ── Google Sheets / Read Excel ───────────────────────────────────
    "gsheets_read_success": {
        "vi": "🟢 [Google Sheets] Đọc thành công {count} dòng vào biến '{output_var}' (Số dòng: '{row_count_var}')",
        "en": "🟢 [Google Sheets] Successfully read {count} rows into variable '{output_var}' (row count: '{row_count_var}')",
    },
    "gsheets_error": {
        "vi": "❌ [Google Sheets] {label} - {error}",
        "en": "❌ [Google Sheets] {label} - {error}",
    },
    "read_excel_success": {
        "vi": "🟢 [Đọc Excel] Đọc thành công {count} dòng từ '{file_name}' vào biến '{output_var}' (Số dòng: '{row_count_var}')",
        "en": "🟢 [Read Excel] Successfully read {count} rows from '{file_name}' into variable '{output_var}' (row count: '{row_count_var}')",
    },
    "read_excel_error": {
        "vi": "❌ [Đọc Excel] {label} - {error}",
        "en": "❌ [Read Excel] {label} - {error}",
    },

    # ── Condition ────────────────────────────────────────────────────
    "condition_no_conditions": {
        "vi": "⚠️ Block [{label}] không có điều kiện nào",
        "en": "⚠️ Block [{label}] has no conditions",
    },
    "condition_checking": {
        "vi": "🔀 [Condition] Kiểm tra {count} điều kiện ({op})",
        "en": "🔀 [Condition] Checking {count} condition(s) ({op})",
    },
    "condition_detail_line": {
        "vi": "   [{idx}] {var} ({actual}) {op} {cmp} ➜ {result}",
        "en": "   [{idx}] {var} ({actual}) {op} {cmp} ➜ {result}",
    },
    "condition_final_result": {
        "vi": "✅ Kết quả chung: {result}",
        "en": "✅ Overall result: {result}",
    },
    "condition_compare_error": {
        "vi": "❌ Lỗi so sánh: {error}",
        "en": "❌ Comparison error: {error}",
    },

    # ── Loop ─────────────────────────────────────────────────────────
    "loop_iteration_count": {
        "vi": "🔁 [Loop] Lần lặp {runs} / {max_count}",
        "en": "🔁 [Loop] Iteration {runs} / {max_count}",
    },
    "loop_branch_taken": {
        "vi": "✅ [Loop] Đi nhánh: {branch}",
        "en": "✅ [Loop] Branch taken: {branch}",
    },
    "loop_iteration_array": {
        "vi": "🔁 [Loop] Lần lặp {runs} / {total} (Mảng: {array_var})",
        "en": "🔁 [Loop] Iteration {runs} / {total} (Array: {array_var})",
    },
    "loop_branch_continue_array": {
        "vi": "✅ [Loop] Đi nhánh: loop (Dòng {runs}/{total})",
        "en": "✅ [Loop] Branch taken: loop (Row {runs}/{total})",
    },
    "loop_array_done": {
        "vi": "✅ [Loop] Hoàn tất {total} phần tử mảng -> Đi nhánh: endloop",
        "en": "✅ [Loop] Finished {total} array item(s) -> Branch: endloop",
    },
    "loop_condition_iteration": {
        "vi": "🔁 [Loop] Lần lặp {runs}/{max_count} - Kiểm tra {count} điều kiện ({op})",
        "en": "🔁 [Loop] Iteration {runs}/{max_count} - Checking {count} condition(s) ({op})",
    },
    "loop_max_reached": {
        "vi": "⚠️ [Loop] Đã dùng hết {max_count} lần quay lại cho phép - dừng dù điều kiện chưa đúng",
        "en": "⚠️ [Loop] Used up all {max_count} allowed retries - stopping even though the condition isn't met",
    },
    "loop_condition_result": {
        "vi": "✅ [Loop] Kết quả chung: {result} -> {branch}",
        "en": "✅ [Loop] Overall result: {result} -> {branch}",
    },
    "loop_compare_error": {
        "vi": "❌ Lỗi so sánh vòng lặp: {error}",
        "en": "❌ Loop comparison error: {error}",
    },

    # ── Browser: wrapper trong executor_blocks.py ────────────────────
    "workflow_failed_browser": {
        "vi": "❌ Workflow thất bại (Browser lỗi)",
        "en": "❌ Workflow failed (Browser error)",
    },
    "browser_exception": {
        "vi": "❌ Lỗi ngoại lệ Browser: {error}",
        "en": "❌ Browser exception: {error}",
    },

    # ── Browser: nhãn hành động (ACTION_LABELS) ──────────────────────
    "action_navigate": {"vi": "🌐 Mở URL", "en": "🌐 Open URL"},
    "action_go_back": {"vi": "⬅️ Quay lại", "en": "⬅️ Go back"},
    "action_go_forward": {"vi": "➡️ Tiến tới", "en": "➡️ Go forward"},
    "action_reload": {"vi": "🔄 Tải lại trang", "en": "🔄 Reload page"},
    "action_wait_for_load": {"vi": "⌛ Chờ trang tải", "en": "⌛ Wait for page load"},
    "action_click": {"vi": "🖱️ Click", "en": "🖱️ Click"},
    "action_double_click": {"vi": "🖱️ Double click", "en": "🖱️ Double click"},
    "action_right_click": {"vi": "🖱️ Right click", "en": "🖱️ Right click"},
    "action_hover": {"vi": "🖱️ Hover", "en": "🖱️ Hover"},
    "action_scroll_to": {"vi": "📜 Cuộn đến phần tử", "en": "📜 Scroll to element"},
    "action_scroll_page": {"vi": "📜 Cuộn trang", "en": "📜 Scroll page"},
    "action_fill": {"vi": "⌨️ Nhập văn bản", "en": "⌨️ Enter text"},
    "action_type_slowly": {"vi": "⌨️ Gõ từng ký tự", "en": "⌨️ Type character by character"},
    "action_clear": {"vi": "✂️ Xóa nội dung", "en": "✂️ Clear content"},
    "action_press_key": {"vi": "⌨️ Nhấn phím", "en": "⌨️ Press key"},
    "action_upload_file": {"vi": "📎 Upload file", "en": "📎 Upload file"},
    "action_click_and_download": {"vi": "📥 Tải file", "en": "📥 Download file"},
    "action_select_option": {"vi": "📋 Chọn dropdown", "en": "📋 Select dropdown"},
    "action_check": {"vi": "☑️ Tick checkbox", "en": "☑️ Tick checkbox"},
    "action_uncheck": {"vi": "☐ Bỏ tick checkbox", "en": "☐ Untick checkbox"},
    "action_wait_for_selector": {"vi": "⏳ Chờ phần tử", "en": "⏳ Wait for element"},
    "action_accept_dialog": {"vi": "✅ Chấp nhận dialog", "en": "✅ Accept dialog"},
    "action_dismiss_dialog": {"vi": "❌ Đóng dialog", "en": "❌ Close dialog"},
    "action_get_text": {"vi": "📝 Lấy text", "en": "📝 Get text"},
    "action_get_attribute": {"vi": "🏷️ Lấy attribute", "en": "🏷️ Get attribute"},
    "action_get_all_text": {"vi": "📝 Lấy tất cả text", "en": "📝 Get all text"},
    "action_get_url": {"vi": "🔗 Lấy URL hiện tại", "en": "🔗 Get current URL"},
    "action_screenshot": {"vi": "📷 Chụp màn hình", "en": "📷 Take screenshot"},
    "action_evaluate_js": {"vi": "⚡ Chạy JavaScript", "en": "⚡ Run JavaScript"},
    "action_wait": {"vi": "⏱️ Dừng chờ", "en": "⏱️ Wait"},
    "action_wait_for_url": {"vi": "⏳ Chờ URL thay đổi", "en": "⏳ Wait for URL change"},

    # ── Browser: log từng bước (execute_step) ────────────────────────
    "page_loaded": {"vi": "Trang đã tải xong", "en": "Page loaded"},
    "field_cleared": {"vi": "'{selector}' đã xóa ✓", "en": "'{selector}' cleared ✓"},
    "file_uploaded": {"vi": "Đã upload '{value}' 📤", "en": "Uploaded '{value}' 📤"},
    "waiting_download_click": {
        "vi": "Đang chờ tải file khi click '{selector}'...",
        "en": "Waiting for download after clicking '{selector}'...",
    },
    "download_done": {
        "vi": "Đã tải xong file: {filename} 📥",
        "en": "Download finished: {filename} 📥",
    },
    "wait_state_visible": {"vi": "đã xuất hiện", "en": "appeared"},
    "wait_state_hidden": {"vi": "đã biến mất", "en": "disappeared"},
    "wait_state_attached": {"vi": "đã được thêm vào DOM", "en": "added to the DOM"},
    "wait_state_detached": {"vi": "đã bị xóa khỏi DOM", "en": "removed from the DOM"},
    "selector_state_reached": {
        "vi": "'{selector}' {state} ✓",
        "en": "'{selector}' {state} ✓",
    },
    "dialog_accept_registered": {"vi": "Đã đăng ký xử lý dialog ✓", "en": "Dialog handler registered ✓"},
    "dialog_dismiss_registered": {"vi": "Đã đăng ký dismiss dialog ✓", "en": "Dismiss dialog handler registered ✓"},
    "get_all_text_result": {
        "vi": "'{selector}' → {count} phần tử ✓",
        "en": "'{selector}' → {count} element(s) ✓",
    },
    "screenshot_taken": {"vi": "Đã chụp màn hình → '{key_name}' ✓", "en": "Screenshot taken → '{key_name}' ✓"},
    "waiting_seconds": {"vi": "Chờ {seconds}s...", "en": "Waiting {seconds}s..."},
    "step_stopped_by_user": {"vi": "⏹ Bị dừng theo yêu cầu người dùng", "en": "⏹ Stopped by user"},
    "url_contains": {"vi": "URL chứa '{value}' ✓", "en": "URL contains '{value}' ✓"},
    "action_not_recognized": {
        "vi": "Action không được nhận dạng: '{action}'",
        "en": "Unrecognized action: '{action}'",
    },

    # ── Browser: khởi động / dọn dẹp / vòng đời block ────────────────
    "browser_cleanup_warning": {
        "vi": "⚠ Không đóng gọn được {what}: {error_type}: {error}",
        "en": "⚠ Could not cleanly close {what}: {error_type}: {error}",
    },
    "browser_thread_poisoned_warning": {
        "vi": "⚠ Thread này còn sót session Playwright không đóng được — đã đánh dấu, sẽ không mở trình duyệt mới trên nó nữa.",
        "en": "⚠ This thread still has a leftover Playwright session that couldn't be closed — marked, no new browser will be opened on it.",
    },
    "browser_block_header": {
        "vi": "🌐 Block Browser [{block_id}] — {count} bước | headless={headless}",
        "en": "🌐 Browser Block [{block_id}] — {count} step(s) | headless={headless}",
    },
    "browser_launching_new": {
        "vi": "🚀 Khởi động trình duyệt mới cho lượt chạy này...",
        "en": "🚀 Launching a new browser for this run...",
    },
    "browser_thread_poisoned_error": {
        "vi": "Thread này còn sót session Playwright của lượt chạy trước (bị Dừng giữa lúc trình duyệt đang mở). "
              "Không thể mở trình duyệt mới trên cùng thread — hãy khởi động lại backend, hoặc chạy lại để nhận thread khác.",
        "en": "This thread still has a leftover Playwright session from a previous run (Stopped while the browser was opening). "
              "Cannot open a new browser on the same thread — restart the backend, or run again to get a different thread.",
    },
    "browser_engine_playwright": {"vi": "Chromium riêng (Playwright)", "en": "Dedicated Chromium (Playwright)"},
    "browser_engine_label": {"vi": "🧭 Trình duyệt: {engine}", "en": "🧭 Browser: {engine}"},
    "browser_opening_window": {
        "vi": "🪟 Đang mở cửa sổ trình duyệt (headless={headless})...",
        "en": "🪟 Opening browser window (headless={headless})...",
    },
    "browser_launch_failed": {"vi": "✗ Không mở được trình duyệt: {error}", "en": "✗ Could not launch browser: {error}"},
    "browser_launch_failed_engine_line": {"vi": "   • Trình duyệt: {engine}", "en": "   • Browser: {engine}"},
    "browser_launch_failed_profile_line": {"vi": "   • Thư mục profile: {profile}", "en": "   • Profile folder: {profile}"},
    "browser_profile_not_used": {"vi": "(không dùng)", "en": "(not used)"},
    "browser_launch_failed_hint": {
        "vi": "   • Hay gặp: phần mềm bảo mật/EDR của công ty chặn kênh điều khiển (--remote-debugging-pipe), "
              "đường dẫn profile quá dài (>260 ký tự), hoặc Chrome hệ thống bị group policy giữ lại. "
              "Cài Chromium riêng bằng `pyflow-backend.exe install-browser` rồi thử lại.",
        "en": "   • Common causes: company security software/EDR blocking the control channel (--remote-debugging-pipe), "
              "profile path too long (>260 characters), or system Chrome locked down by group policy. "
              "Install a dedicated Chromium with `pyflow-backend.exe install-browser` and try again.",
    },
    "browser_ready_with_version": {
        "vi": "✅ Trình duyệt đã sẵn sàng — Chrome/{version}",
        "en": "✅ Browser ready — Chrome/{version}",
    },
    "browser_ready": {"vi": "✅ Trình duyệt đã sẵn sàng", "en": "✅ Browser ready"},
    "browser_reusing": {"vi": "♻️ Tái sử dụng trình duyệt đang mở...", "en": "♻️ Reusing the already-open browser..."},
    "browser_stopped_by_user": {"vi": "⏹ Đã dừng theo yêu cầu người dùng", "en": "⏹ Stopped by user"},
    "step_error_skipped": {
        "vi": "   ⚠ Bước {i} lỗi — bỏ qua (continue_on_error=true)",
        "en": "   ⚠ Step {i} failed — skipping (continue_on_error=true)",
    },
    "step_failed_stopping": {"vi": "   ✗ Dừng do bước {i} thất bại", "en": "   ✗ Stopping because step {i} failed"},
    "browser_block_done": {
        "vi": "✓ Browser Block hoàn thành — {count} dữ liệu thu thập",
        "en": "✓ Browser Block completed — {count} data item(s) collected",
    },
    "browser_block_internal_error": {
        "vi": "✗ Lỗi nội bộ Browser Block: {error}",
        "en": "✗ Internal Browser Block error: {error}",
    },
}


def tr_action(action: str, language: str, default: str) -> str:
    """Dịch nhãn hành động Browser (`ACTION_LABELS` trong browser_executor.py).

    Tách riêng khỏi `tr()` vì cần fallback về giá trị VI gốc (`default`, từ
    `ACTION_LABELS.get(...)`) khi action lạ chưa có trong catalog — không như
    `tr()` vốn fallback về chính cái key.
    """
    entry = MESSAGES.get(f"action_{action}")
    if entry is None:
        return default
    return entry.get(language) or entry.get("vi") or default


def tr(language: str, key: str, **kwargs) -> str:
    """Dịch 1 message theo `language` ('vi'/'en'). Fallback 'vi' rồi tới key thô
    nếu thiếu entry — không bao giờ raise để 1 message thiếu bản dịch không làm
    vỡ cả run đang chạy."""
    entry = MESSAGES.get(key)
    if entry is None:
        return key
    text = entry.get(language) or entry.get("vi") or key
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, IndexError):
            return text
    return text
