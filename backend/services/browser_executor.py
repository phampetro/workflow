"""
Browser Executor — Chạy các bước tự động hóa web qua Playwright.
Sử dụng mô hình đồng bộ (sync_playwright) để có thể "treo" trình duyệt qua nhiều khối.
"""
import base64
import json
import os
import re
import traceback
import time
from typing import Optional, Callable

# ─── Cấu hình action types ──────────────────────────────────────────────────

ACTION_LABELS = {
    # Điều hướng
    "navigate":         "🌐 Mở URL",
    "go_back":          "⬅️ Quay lại",
    "go_forward":       "➡️ Tiến tới",
    "reload":           "🔄 Tải lại trang",
    "wait_for_load":    "⌛ Chờ trang tải",
    # Tương tác
    "click":            "🖱️ Click",
    "double_click":     "🖱️ Double click",
    "right_click":      "🖱️ Right click",
    "hover":            "🖱️ Hover",
    "scroll_to":        "📜 Cuộn đến phần tử",
    "scroll_page":      "📜 Cuộn trang",
    # Nhập liệu
    "fill":             "⌨️ Nhập văn bản",
    "type_slowly":      "⌨️ Gõ từng ký tự",
    "clear":            "✂️ Xóa nội dung",
    "press_key":        "⌨️ Nhấn phím",
    "upload_file":      "📎 Upload file",
    "click_and_download": "📥 Tải file",
    # Form & Select
    "select_option":    "📋 Chọn dropdown",
    "check":            "☑️ Tick checkbox",
    "uncheck":          "☐ Bỏ tick checkbox",
    # Modal & Popup
    "wait_for_selector": "⏳ Chờ phần tử",
    "accept_dialog":    "✅ Chấp nhận dialog",
    "dismiss_dialog":   "❌ Đóng dialog",
    # Thu thập dữ liệu
    "get_text":         "📝 Lấy text",
    "get_attribute":    "🏷️ Lấy attribute",
    "get_all_text":     "📝 Lấy tất cả text",
    "get_url":          "🔗 Lấy URL hiện tại",
    "screenshot":       "📷 Chụp màn hình",
    "evaluate_js":      "⚡ Chạy JavaScript",
    # Chờ đợi
    "wait":             "⏱️ Dừng chờ",
    "wait_for_url":     "⏳ Chờ URL thay đổi",
}


class BrowserStepResult:
    def __init__(self, success: bool, output=None, error: str = None, stopped: bool = False):
        self.success = success
        self.output = output
        self.error = error
        self.stopped = stopped


def get_locator(page, selector: str):
    """Phân giải selector đặc biệt như label=..., placeholder=..."""
    if not selector:
        return page.locator("")
    s = selector.strip()
    if s.startswith("label="):
        return page.get_by_label(s[6:].strip())
    elif s.startswith("placeholder="):
        return page.get_by_placeholder(s[12:].strip())
    elif s.startswith("alt="):
        return page.get_by_alt_text(s[4:].strip())
    elif s.startswith("title="):
        return page.get_by_title(s[6:].strip())
    return page.locator(selector)


def execute_step(page, step: dict, collected_data: dict, log_callback, block_id: str, output_dir: str = "", stop_event=None) -> BrowserStepResult:
    """Thực thi một bước browser action."""
    action = step.get("action", "")
    selector = step.get("selector", "")
    value = step.get("value", "")
    attribute = step.get("attribute", "")
    key_name = step.get("key_name", "result")
    timeout = int(step.get("timeout", 20000))

    label = ACTION_LABELS.get(action, f"[{action}]")

    def log(level, msg):
        if log_callback:
            log_callback(block_id, level, f"   {label}: {msg}")

    try:
        # ── Điều hướng ────────────────────────────────────────────────────
        if action == "navigate":
            log("info", f"→ {value}")
            page.goto(value, timeout=timeout, wait_until="domcontentloaded")

        elif action == "go_back":
            page.go_back(timeout=timeout)
            log("info", "OK")

        elif action == "go_forward":
            page.go_forward(timeout=timeout)
            log("info", "OK")

        elif action == "reload":
            page.reload(timeout=timeout)
            log("info", "OK")

        elif action == "wait_for_load":
            page.wait_for_load_state("load", timeout=timeout)
            log("info", "Trang đã tải xong")

        # ── Tương tác ─────────────────────────────────────────────────────
        elif action == "click":
            get_locator(page, selector).first.click(timeout=timeout)
            log("info", f"'{selector}' ✓")

        elif action == "double_click":
            get_locator(page, selector).first.dblclick(timeout=timeout)
            log("info", f"'{selector}' ✓")

        elif action == "right_click":
            get_locator(page, selector).first.click(button="right", timeout=timeout)
            log("info", f"'{selector}' ✓")

        elif action == "hover":
            get_locator(page, selector).first.hover(timeout=timeout)
            log("info", f"'{selector}' ✓")

        elif action == "scroll_to":
            get_locator(page, selector).first.scroll_into_view_if_needed(timeout=timeout)
            log("info", f"'{selector}' ✓")

        elif action == "scroll_page":
            if value == "down":
                page.evaluate("window.scrollBy(0, window.innerHeight)")
            elif value == "up":
                page.evaluate("window.scrollBy(0, -window.innerHeight)")
            elif value == "bottom":
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            elif value == "top":
                page.evaluate("window.scrollTo(0, 0)")
            else:
                try:
                    px = int(value)
                    page.evaluate(f"window.scrollBy(0, {px})")
                except Exception:
                    pass
            log("info", f"→ {value} ✓")

        # ── Nhập liệu ─────────────────────────────────────────────────────
        elif action == "fill":
            get_locator(page, selector).first.fill(value, timeout=timeout)
            log("info", f"'{selector}' = '{value}' ✓")

        elif action == "type_slowly":
            get_locator(page, selector).first.type(value, delay=80, timeout=timeout)
            log("info", f"'{selector}' = '{value}' ✓")

        elif action == "clear":
            get_locator(page, selector).first.fill("", timeout=timeout)
            log("info", f"'{selector}' đã xóa ✓")

        elif action == "press_key":
            actual_key = value if value else "Enter"
            if selector:
                get_locator(page, selector).first.press(actual_key, timeout=timeout)
            else:
                page.keyboard.press(actual_key)
            log("info", f"Key '{actual_key}' ✓")

        elif action == "upload_file":
            get_locator(page, selector).first.set_input_files(value, timeout=timeout)
            log("info", f"Đã upload '{value}' 📤")

        elif action == "click_and_download":
            log("info", f"Đang chờ tải file khi click '{selector}'...")
            with page.expect_download(timeout=timeout) as download_info:
                get_locator(page, selector).first.click(timeout=timeout)
            
            download = download_info.value
            
            custom_file_name = step.get("file_name", "").strip()
            if custom_file_name:
                custom_file_name = re.sub(r'[\\/*?:"<>|]', '_', custom_file_name)
                _, ext = os.path.splitext(download.suggested_filename)
                if not custom_file_name.lower().endswith(ext.lower()):
                    original_filename = f"{custom_file_name}{ext}"
                else:
                    original_filename = custom_file_name
            else:
                original_filename = download.suggested_filename
            
            target_dir = output_dir if output_dir else os.getcwd()
            os.makedirs(target_dir, exist_ok=True)
            
            save_path = os.path.join(target_dir, original_filename)
            download.save_as(save_path)
            
            collected_data[key_name] = save_path
            log("success", f"Đã tải xong file: {original_filename} 📥")

        # ── Form & Select ─────────────────────────────────────────────────
        elif action == "select_option":
            try:
                idx = int(value)
                get_locator(page, selector).first.select_option(index=idx, timeout=timeout)
            except (ValueError, TypeError):
                get_locator(page, selector).first.select_option(label=value, timeout=timeout)
            log("info", f"'{selector}' = '{value}' ✓")

        elif action == "check":
            get_locator(page, selector).first.check(timeout=timeout)
            log("info", f"'{selector}' ✓")

        elif action == "uncheck":
            get_locator(page, selector).first.uncheck(timeout=timeout)
            log("info", f"'{selector}' ✓")

        # ── Modal & Dialog ────────────────────────────────────────────────
        elif action == "wait_for_selector":
            wait_state = step.get("state", "visible")
            if wait_state not in ("visible", "hidden", "attached", "detached"):
                wait_state = "visible"
            get_locator(page, selector).first.wait_for(state=wait_state, timeout=timeout)
            state_label = {"visible": "đã xuất hiện", "hidden": "đã biến mất", "attached": "đã được thêm vào DOM", "detached": "đã bị xóa khỏi DOM"}[wait_state]
            log("info", f"'{selector}' {state_label} ✓")

        elif action == "accept_dialog":
            page.once("dialog", lambda d: d.accept())
            log("info", "Đã đăng ký xử lý dialog ✓")

        elif action == "dismiss_dialog":
            page.once("dialog", lambda d: d.dismiss())
            log("info", "Đã đăng ký dismiss dialog ✓")

        # ── Thu thập dữ liệu ──────────────────────────────────────────────
        elif action == "get_text":
            text = get_locator(page, selector).first.inner_text(timeout=timeout)
            collected_data[key_name] = text.strip()
            log("info", f"'{selector}' → '{text.strip()[:80]}' ✓")

        elif action == "get_attribute":
            attr_val = get_locator(page, selector).first.get_attribute(attribute, timeout=timeout)
            collected_data[key_name] = attr_val
            log("info", f"'{selector}'.{attribute} → '{attr_val}' ✓")

        elif action == "get_all_text":
            elements = get_locator(page, selector)
            count = elements.count()
            texts = []
            for i in range(count):
                t = elements.nth(i).inner_text()
                texts.append(t.strip())
            collected_data[key_name] = texts
            log("info", f"'{selector}' → {len(texts)} phần tử ✓")

        elif action == "get_url":
            collected_data[key_name] = page.url
            log("info", f"→ '{page.url}' ✓")

        elif action == "screenshot":
            screenshot_bytes = page.screenshot(full_page=True)
            b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            collected_data[key_name] = f"data:image/png;base64,{b64}"
            log("info", f"Đã chụp màn hình → '{key_name}' ✓")

        elif action == "evaluate_js":
            result = page.evaluate(value)
            collected_data[key_name] = result
            log("info", f"JS executed → '{key_name}' ✓")

        # ── Chờ đợi ───────────────────────────────────────────────────────
        elif action == "wait":
            seconds = float(value) if value else 1
            log("info", f"Chờ {seconds}s...")
            waited = 0.0
            interval = 0.3
            while waited < seconds:
                if stop_event and stop_event.is_set():
                    log("warning", "⏹ Bị dừng theo yêu cầu người dùng")
                    return BrowserStepResult(success=False, error="stopped", stopped=True)
                sleep_time = min(interval, seconds - waited)
                time.sleep(sleep_time)
                waited += sleep_time
            log("info", "Done ✓")

        elif action == "wait_for_url":
            page.wait_for_url(value, timeout=timeout)
            log("info", f"URL chứa '{value}' ✓")

        else:
            log("warning", f"Action không được nhận dạng: '{action}'")

        return BrowserStepResult(success=True)

    except Exception as e:
        error_msg = str(e)
        log("error", f"✗ {error_msg[:200]}")
        return BrowserStepResult(success=False, error=error_msg)


# Global registry for keeping browser sessions alive across blocks in the same run
_active_browser_sessions = {}

def cleanup_browser(run_id: str):
    """Đóng dọn dẹp browser của một lượt chạy khi workflow kết thúc."""
    if run_id in _active_browser_sessions:
        session = _active_browser_sessions.pop(run_id)
        try:
            session["context"].close()
        except Exception:
            pass
        try:
            if session.get("browser"):
                session["browser"].close()
        except Exception:
            pass
        try:
            session["pw"].stop()
        except Exception:
            pass

def run_browser_block(
    block_id: str,
    workflow_id: str,
    run_id: str,
    steps: list,
    input_data=None,
    headless: bool = True,
    log_callback: Optional[Callable] = None,
    output_dir: str = "",
    stop_event=None,
    browser_profile_dir: str = "",
) -> dict:
    """
    Chạy một block Browser với Playwright.
    Sử dụng sync_playwright và tái sử dụng browser nếu chạy nhiều block trong cùng 1 run_id.
    """
    def log(level, msg):
        if log_callback:
            log_callback(block_id, level, msg)

    log("info", f"🌐 Block Browser [{block_id}] — {len(steps)} bước | headless={headless}")

    collected_data = {}
    
    # Khởi tạo sẵn giá trị rỗng cho các biến sắp được lấy
    # Tránh việc step bị lỗi/bỏ qua dẫn đến giữ nguyên giá trị của vòng lặp trước đó.
    for step in steps:
        action = step.get("action", "")
        if action in ["get_text", "get_attribute", "get_all_text", "get_url", "screenshot", "evaluate_js", "click_and_download"]:
            key = step.get("key_name", "result")
            collected_data[key] = ""

    try:
        from playwright.sync_api import sync_playwright

        if run_id not in _active_browser_sessions:
            log("info", "🚀 Khởi động trình duyệt mới cho lượt chạy này...")
            pw = sync_playwright().start()
            
            if browser_profile_dir:
                os.makedirs(browser_profile_dir, exist_ok=True)
                context = pw.chromium.launch_persistent_context(
                    user_data_dir=browser_profile_dir,
                    headless=headless,
                    args=["--no-sandbox", "--disable-dev-shm-usage"],
                    viewport={"width": 1280, "height": 800},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    )
                )
                page = context.pages[0] if context.pages else context.new_page()
                browser = None
            else:
                browser = pw.chromium.launch(
                    headless=headless,
                    args=["--no-sandbox", "--disable-dev-shm-usage"]
                )
                context = browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    )
                )
                page = context.new_page()
            
            _active_browser_sessions[run_id] = {
                "pw": pw,
                "browser": browser,
                "context": context,
                "page": page
            }
        else:
            log("info", "♻️ Tái sử dụng trình duyệt đang mở...")

        session = _active_browser_sessions[run_id]
        page = session["page"]

        step_count = len(steps)
        for i, step in enumerate(steps, 1):
            if stop_event and stop_event.is_set():
                log("warning", "⏹ Đã dừng theo yêu cầu người dùng")
                return {
                    "success": False,
                    "output_data": collected_data if collected_data else None,
                    "error": "stopped",
                    "stopped": True,
                }

            if not step.get("action"):
                continue

            action = step.get("action", "")
            label = ACTION_LABELS.get(action, action)
            note_str = f" — {step['note']}" if step.get("note") else ""
            log("info", f"   [{i}/{step_count}] {label}{note_str}")

            new_step = {**step}
            current_vars = {}
            if input_data and isinstance(input_data, dict):
                current_vars.update(input_data)
            current_vars.update(collected_data)
            
            if current_vars:
                for step_key, step_val in new_step.items():
                    if isinstance(step_val, str) and "{{" in step_val:
                        for k, v in current_vars.items():
                            step_val = step_val.replace(f"{{{{{k}}}}}", str(v))
                        new_step[step_key] = step_val
            step = new_step

            result = execute_step(page, step, collected_data, log_callback, block_id, output_dir, stop_event=stop_event)

            if not result.success:
                if getattr(result, "stopped", False):
                    return {
                        "success": False,
                        "output_data": collected_data if collected_data else None,
                        "error": "stopped",
                        "stopped": True,
                    }
                if step.get("continue_on_error", False):
                    log("warning", f"   ⚠ Bước {i} lỗi — bỏ qua (continue_on_error=true)")
                else:
                    log("error", f"   ✗ Dừng do bước {i} thất bại")
                    return {
                        "success": False,
                        "output_data": collected_data if collected_data else None,
                        "error": result.error,
                    }

        out = collected_data if collected_data else None
        log("success", f"✓ Browser Block hoàn thành — {len(collected_data)} dữ liệu thu thập")
        return {
            "success": True,
            "output_data": out,
            "error": None,
        }

    except Exception as e:
        err = traceback.format_exc()
        log("error", f"✗ Lỗi nội bộ Browser Block: {e}")
        return {
            "success": False,
            "output_data": collected_data if collected_data else None,
            "error": str(e),
        }
