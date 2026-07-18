"""
Browser Executor — Chạy các bước tự động hóa web qua Playwright.

Luồng thực thi:
1. Nhận danh sách steps (JSON) từ block browser
2. Khởi động browser context
3. Thực thi từng step tuần tự
4. Trả về output_data (text, attributes, screenshot...)

Chế độ:
- headless=True  (mặc định): Chạy ngầm, không hiển thị cửa sổ
- headless=False (debug mode): Mở cửa sổ Chrome thật để quan sát
"""
import asyncio
import base64
import json
import os
import re
import traceback
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


async def execute_step(page, step: dict, collected_data: dict, log_callback, block_id: str, output_dir: str = "", stop_event=None) -> BrowserStepResult:
    """Thực thi một bước browser action."""
    action = step.get("action", "")
    selector = step.get("selector", "")
    value = step.get("value", "")
    attribute = step.get("attribute", "")
    key_name = step.get("key_name", "result")
    timeout = int(step.get("timeout", 10000))

    label = ACTION_LABELS.get(action, f"[{action}]")

    async def log(level, msg):
        if log_callback:
            await log_callback(block_id, level, f"   {label}: {msg}")

    try:
        # ── Điều hướng ────────────────────────────────────────────────────
        if action == "navigate":
            await log("info", f"→ {value}")
            await page.goto(value, timeout=timeout, wait_until="domcontentloaded")

        elif action == "go_back":
            await page.go_back(timeout=timeout)
            await log("info", "OK")

        elif action == "go_forward":
            await page.go_forward(timeout=timeout)
            await log("info", "OK")

        elif action == "reload":
            await page.reload(timeout=timeout)
            await log("info", "OK")

        elif action == "wait_for_load":
            # "networkidle" không đáng tin cho web hiện đại - trang gần như luôn có
            # kết nối nền (analytics, websocket, ads...) nên hiếm khi thực sự idle,
            # dẫn tới chờ hết timeout dù trang đã tải xong. "load" (sự kiện window.onload
            # - HTML + toàn bộ tài nguyên đã tải) là tín hiệu ổn định hơn nhiều.
            await page.wait_for_load_state("load", timeout=timeout)
            await log("info", "Trang đã tải xong")

        # ── Tương tác ─────────────────────────────────────────────────────
        elif action == "click":
            await page.locator(selector).first.click(timeout=timeout)
            await log("info", f"'{selector}' ✓")

        elif action == "double_click":
            await page.locator(selector).first.dblclick(timeout=timeout)
            await log("info", f"'{selector}' ✓")

        elif action == "right_click":
            await page.locator(selector).first.click(button="right", timeout=timeout)
            await log("info", f"'{selector}' ✓")

        elif action == "hover":
            await page.locator(selector).first.hover(timeout=timeout)
            await log("info", f"'{selector}' ✓")

        elif action == "scroll_to":
            await page.locator(selector).first.scroll_into_view_if_needed(timeout=timeout)
            await log("info", f"'{selector}' ✓")

        elif action == "scroll_page":
            if value == "down":
                await page.evaluate("window.scrollBy(0, window.innerHeight)")
            elif value == "up":
                await page.evaluate("window.scrollBy(0, -window.innerHeight)")
            elif value == "bottom":
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            elif value == "top":
                await page.evaluate("window.scrollTo(0, 0)")
            else:
                try:
                    px = int(value)
                    await page.evaluate(f"window.scrollBy(0, {px})")
                except Exception:
                    pass
            await log("info", f"→ {value} ✓")

        # ── Nhập liệu ─────────────────────────────────────────────────────
        elif action == "fill":
            await page.locator(selector).first.fill(value, timeout=timeout)
            await log("info", f"'{selector}' = '{value}' ✓")

        elif action == "type_slowly":
            await page.locator(selector).first.type(value, delay=80, timeout=timeout)
            await log("info", f"'{selector}' ✓")

        elif action == "clear":
            await page.locator(selector).first.fill("", timeout=timeout)
            await log("info", f"'{selector}' đã xóa ✓")

        elif action == "press_key":
            if selector:
                await page.locator(selector).first.press(value, timeout=timeout)
            else:
                await page.keyboard.press(value)
            await log("info", f"Key '{value}' ✓")

        elif action == "upload_file":
            await page.locator(selector).first.set_input_files(value, timeout=timeout)
            await log("info", f"Đã upload '{value}' 📤")

        elif action == "click_and_download":
            await log("info", f"Đang chờ tải file khi click '{selector}'...")
            async with page.expect_download(timeout=timeout) as download_info:
                await page.locator(selector).first.click(timeout=timeout)
            
            download = await download_info.value
            
            # Sử dụng tên gốc của file hoặc tên tự đặt
            custom_file_name = step.get("file_name", "").strip()
            if custom_file_name:
                # Thay thế các ký tự đặc biệt (có thể gây lỗi như /, \) thành _
                custom_file_name = re.sub(r'[\\/*?:"<>|]', '_', custom_file_name)
                _, ext = os.path.splitext(download.suggested_filename)
                if not custom_file_name.lower().endswith(ext.lower()):
                    original_filename = f"{custom_file_name}{ext}"
                else:
                    original_filename = custom_file_name
            else:
                original_filename = download.suggested_filename
            
            # Nếu output_dir không có, dùng current working dir làm dự phòng
            target_dir = output_dir if output_dir else os.getcwd()
            os.makedirs(target_dir, exist_ok=True)
            
            save_path = os.path.join(target_dir, original_filename)
            await download.save_as(save_path)
            
            # Lưu đường dẫn vào biến output
            collected_data[key_name] = save_path
            await log("success", f"Đã tải xong file: {original_filename} 📥")

        # ── Form & Select ─────────────────────────────────────────────────
        elif action == "select_option":
            try:
                idx = int(value)
                await page.locator(selector).first.select_option(index=idx, timeout=timeout)
            except (ValueError, TypeError):
                await page.locator(selector).first.select_option(label=value, timeout=timeout)
            await log("info", f"'{selector}' = '{value}' ✓")

        elif action == "check":
            await page.locator(selector).first.check(timeout=timeout)
            await log("info", f"'{selector}' ✓")

        elif action == "uncheck":
            await page.locator(selector).first.uncheck(timeout=timeout)
            await log("info", f"'{selector}' ✓")

        # ── Modal & Dialog ────────────────────────────────────────────────
        elif action == "wait_for_selector":
            # state="hidden" dùng để chờ 1 loading spinner biến mất (dấu hiệu tin cậy
            # cho việc dữ liệu AJAX/SPA đã tải xong), thay vì chỉ chờ phần tử xuất hiện.
            wait_state = step.get("state", "visible")
            if wait_state not in ("visible", "hidden", "attached", "detached"):
                wait_state = "visible"
            await page.locator(selector).first.wait_for(state=wait_state, timeout=timeout)
            state_label = {"visible": "đã xuất hiện", "hidden": "đã biến mất", "attached": "đã được thêm vào DOM", "detached": "đã bị xóa khỏi DOM"}[wait_state]
            await log("info", f"'{selector}' {state_label} ✓")

        elif action == "accept_dialog":
            page.once("dialog", lambda d: asyncio.ensure_future(d.accept()))
            await log("info", "Đã đăng ký xử lý dialog ✓")

        elif action == "dismiss_dialog":
            page.once("dialog", lambda d: asyncio.ensure_future(d.dismiss()))
            await log("info", "Đã đăng ký dismiss dialog ✓")

        # ── Thu thập dữ liệu ──────────────────────────────────────────────
        elif action == "get_text":
            text = await page.locator(selector).first.inner_text(timeout=timeout)
            collected_data[key_name] = text.strip()
            await log("info", f"'{selector}' → '{text.strip()[:80]}' ✓")

        elif action == "get_attribute":
            attr_val = await page.locator(selector).first.get_attribute(attribute, timeout=timeout)
            collected_data[key_name] = attr_val
            await log("info", f"'{selector}'.{attribute} → '{attr_val}' ✓")

        elif action == "get_all_text":
            elements = page.locator(selector)
            count = await elements.count()
            texts = []
            for i in range(count):
                t = await elements.nth(i).inner_text()
                texts.append(t.strip())
            collected_data[key_name] = texts
            await log("info", f"'{selector}' → {len(texts)} phần tử ✓")

        elif action == "get_url":
            collected_data[key_name] = page.url
            await log("info", f"→ '{page.url}' ✓")

        elif action == "screenshot":
            screenshot_bytes = await page.screenshot(full_page=True)
            b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
            collected_data[key_name] = f"data:image/png;base64,{b64}"
            await log("info", f"Đã chụp màn hình → '{key_name}' ✓")

        elif action == "evaluate_js":
            result = await page.evaluate(value)
            collected_data[key_name] = result
            await log("info", f"JS executed → '{key_name}' ✓")

        # ── Chờ đợi ───────────────────────────────────────────────────────
        elif action == "wait":
            seconds = float(value) if value else 1
            await log("info", f"Chờ {seconds}s...")
            # Chia nhỏ để kiểm tra dừng định kỳ - nếu không, "wait" dài (VD: 300s)
            # sẽ không bị ngắt được khi người dùng bấm Dừng workflow.
            waited = 0.0
            interval = 0.3
            while waited < seconds:
                if stop_event and stop_event.is_set():
                    await log("warning", "⏹ Bị dừng theo yêu cầu người dùng")
                    return BrowserStepResult(success=False, error="stopped", stopped=True)
                sleep_time = min(interval, seconds - waited)
                await asyncio.sleep(sleep_time)
                waited += sleep_time
            await log("info", "Done ✓")

        elif action == "wait_for_url":
            await page.wait_for_url(value, timeout=timeout)
            await log("info", f"URL chứa '{value}' ✓")

        else:
            await log("warning", f"Action không được nhận dạng: '{action}'")

        return BrowserStepResult(success=True)

    except Exception as e:
        error_msg = str(e)
        await log("error", f"✗ {error_msg[:200]}")
        return BrowserStepResult(success=False, error=error_msg)


async def run_browser_block(
    block_id: str,
    workflow_id: str,
    steps: list,
    input_data=None,
    headless: bool = True,
    log_callback: Optional[Callable] = None,
    output_dir: str = "",
    stop_event=None,
) -> dict:
    """
    Chạy một block Browser với Playwright.

    Args:
        block_id:     ID của block
        workflow_id:  ID workflow
        steps:        List các bước [{action, selector, value, ...}]
        input_data:   Dữ liệu từ block trước (dùng để fill form v.v.)
        headless:     True = chạy ngầm, False = hiện cửa sổ browser (debug mode)
        log_callback: Hàm ghi log async (block_id, level, message)
        stop_event:   Đối tượng có .is_set() - kiểm tra giữa mỗi bước để có thể
                      ngắt block khi người dùng bấm Dừng workflow.

    Returns:
        {
            "success": bool,
            "output_data": dict | None,
            "error": str | None,
            "stopped": bool,
        }
    """
    async def log(level, msg):
        if log_callback:
            await log_callback(block_id, level, msg)

    await log("info", f"🌐 Block Browser [{block_id}] — {len(steps)} bước | headless={headless}")

    collected_data = {}

    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            browser = None
            context = None
            page = None
            try:
                browser = await pw.chromium.launch(
                    headless=headless,
                    args=["--no-sandbox", "--disable-dev-shm-usage"]
                )

                context = await browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    )
                )

                page = await context.new_page()

                step_count = len(steps)
                for i, step in enumerate(steps, 1):
                    # Kiểm tra dừng TRƯỚC mỗi bước - nếu không, chuỗi nhiều bước ngắn
                    # cộng dồn (hoặc 1 bước đang chạy) sẽ không phản hồi nút Dừng.
                    if stop_event and stop_event.is_set():
                        await log("warning", "⏹ Đã dừng theo yêu cầu người dùng")
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
                    await log("info", f"   [{i}/{step_count}] {label}{note_str}")

                    # Thay thế {{key}} trong tất cả các trường của step bằng input_data
                    new_step = {**step}
                    if input_data and isinstance(input_data, dict):
                        for step_key, step_val in new_step.items():
                            if isinstance(step_val, str) and "{{" in step_val:
                                for k, v in input_data.items():
                                    step_val = step_val.replace(f"{{{{{k}}}}}", str(v))
                                new_step[step_key] = step_val
                    step = new_step

                    result = await execute_step(page, step, collected_data, log_callback, block_id, output_dir, stop_event=stop_event)

                    if not result.success:
                        if getattr(result, "stopped", False):
                            return {
                                "success": False,
                                "output_data": collected_data if collected_data else None,
                                "error": "stopped",
                                "stopped": True,
                            }
                        if step.get("continue_on_error", False):
                            await log("warning", f"   ⚠ Bước {i} lỗi — bỏ qua (continue_on_error=true)")
                        else:
                            await log("error", f"   ✗ Dừng do bước {i} thất bại")
                            return {
                                "success": False,
                                "output_data": collected_data if collected_data else None,
                                "error": result.error,
                            }

                out = collected_data if collected_data else None
                await log("success", f"✓ Browser Block hoàn thành — {len(collected_data)} dữ liệu thu thập")
                return {
                    "success": True,
                    "output_data": out,
                    "error": None,
                }
            finally:
                # Luôn đóng page/context/browser dù thành công, step lỗi, hay exception
                # bất ngờ (VD: launch/new_context thất bại giữa chừng) - nếu không, tiến
                # trình Chromium bị rò rỉ (không giải phóng RAM/CPU) khi qua khối tiếp theo.
                for resource in (page, context, browser):
                    if resource is not None:
                        try:
                            await resource.close()
                        except Exception:
                            pass

    except Exception as e:
        err = traceback.format_exc()
        await log("error", f"✗ Lỗi nội bộ Browser Block: {e}")
        return {
            "success": False,
            "output_data": collected_data if collected_data else None,
            "error": str(e),
        }
