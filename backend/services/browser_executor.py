"""
Browser Executor — Chạy các bước tự động hóa web qua Playwright.
Sử dụng mô hình đồng bộ (sync_playwright) để có thể "treo" trình duyệt qua nhiều khối.
"""
import base64
import json
import os
import re
import sys
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


# Các action có dùng selector và được hưởng lợi từ fallback chain.
# (Không gồm wait_for_selector vì nó có state hidden/detached, không nên pre-check attached.)
_SELECTOR_FALLBACK_ACTIONS = {
    "click", "double_click", "right_click", "hover", "scroll_to",
    "fill", "type_slowly", "clear", "press_key", "upload_file", "click_and_download",
    "select_option", "check", "uncheck",
    "get_text", "get_attribute", "get_all_text",
}


def resolve_selector(page, candidates, timeout: int) -> str:
    """Thử lần lượt các selector (bền → giòn), trả về cái đầu tiên gắn được vào DOM.

    Đây là "self-healing" chống React/Angular re-render: nếu selector chính đã đổi
    (class băm, id auto...), executor tự chuyển sang selector dự phòng còn hợp lệ.
    Cái cuối cùng luôn được trả về (kể cả chưa attach) để action tự chờ full timeout.
    """
    valid = [c for c in candidates if c]
    if not valid:
        return ""
    if len(valid) == 1:
        return valid[0]
    per = max(800, int(timeout / len(valid)))
    for i, sel in enumerate(valid):
        if i == len(valid) - 1:
            return sel
        try:
            get_locator(page, sel).first.wait_for(state="attached", timeout=per)
            return sel
        except Exception:
            continue
    return valid[-1]


def execute_step(page, step: dict, collected_data: dict, log_callback, block_id: str, output_dir: str = "", stop_event=None) -> BrowserStepResult:
    """Thực thi một bước browser action."""
    action = step.get("action", "")
    selector = step.get("selector", "")
    value = step.get("value", "")
    attribute = step.get("attribute", "")
    key_name = step.get("key_name", "result")
    timeout = int(step.get("timeout", 20000))

    # Fallback selector chain (do recorder sinh ra): thử lần lượt để chống UI đổi DOM.
    raw_selectors = step.get("selectors")
    if isinstance(raw_selectors, list):
        candidates = [str(s) for s in raw_selectors if s]
        if len(candidates) > 1 and action in _SELECTOR_FALLBACK_ACTIONS:
            selector = resolve_selector(page, candidates, timeout)

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


def _find_system_browser():
    import os, sys
    if sys.platform == "win32":
        paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
        ]
    elif sys.platform == "darwin":
        paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
        ]
    else:
        paths = []
        
    for p in paths:
        if os.path.exists(p):
            return p
    return None


# Vị trí binary Chromium bên trong <registry>/chromium-<rev>/ theo từng OS.
_CHROMIUM_BINARIES = (
    os.path.join("chrome-win64", "chrome.exe"),
    os.path.join("chrome-linux", "chrome"),
    os.path.join("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
    os.path.join("chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"),
)


def playwright_registry_dir() -> str:
    """Thư mục Playwright chứa các bản browser đã tải.

    Tôn trọng PLAYWRIGHT_BROWSERS_PATH (main.py set khi có thư mục ms-playwright
    portable cạnh exe) — nếu biến này được set thì Playwright CHỈ tìm ở đó, nên
    không được fallback về cache mặc định.
    """
    env_dir = os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "").strip()
    if env_dir:
        return env_dir
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser(r"~\AppData\Local")
        return os.path.join(base, "ms-playwright")
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Caches/ms-playwright")
    return os.path.expanduser("~/.cache/ms-playwright")


def find_installed_chromium() -> str:
    """Đường dẫn Chromium riêng đã tải, hoặc "" nếu chưa có.

    Quét thẳng filesystem thay vì gọi ``sync_playwright()``: ở chế độ frozen
    (PyInstaller) việc khởi động driver chỉ để hỏi đường dẫn không đáng tin —
    đã gặp trường hợp exe báo "chưa cài" trong khi Chromium có sẵn. Cấu trúc
    ``<registry>/chromium-<rev>/chrome-win64/chrome.exe`` thì ổn định.
    """
    import glob
    root = playwright_registry_dir()
    if not root or not os.path.isdir(root):
        return ""
    for d in sorted(glob.glob(os.path.join(root, "chromium-*")), reverse=True):
        for rel in _CHROMIUM_BINARIES:
            p = os.path.join(d, rel)
            if os.path.exists(p):
                return p
    return ""


def pick_browser(pw):
    """Chọn trình duyệt cho automation → trả về ``(executable_path, warning)``.

    Ưu tiên **Chromium riêng của Playwright** (``executable_path=None`` → Playwright tự
    dùng bản bundled) để automation tách biệt hoàn toàn khỏi Chrome/Edge cá nhân của
    người dùng: không dùng chung profile, không ảnh hưởng phiên đăng nhập/tab đang mở,
    và **không bị group policy / tiện ích của máy can thiệp**.

    Nếu máy chưa tải Chromium bundled thì fallback về Chrome/Edge hệ thống, nhưng phải
    cảnh báo: đây là nguồn gốc của kiểu bug "máy này chạy được, máy khách thì không"
    (Chrome chính hãng bị policy công ty, tiện ích, phiên bản khác… chặn đăng nhập).
    """
    expected = ""
    try:
        expected = pw.chromium.executable_path or ""
        if expected and os.path.exists(expected):
            return None, ""
    except Exception:
        pass

    # Lớp 2: driver không trả được đường dẫn (đã gặp ở chế độ frozen) nhưng
    # Chromium vẫn nằm trên đĩa → chỉ thẳng vào binary, đừng tụt xuống Chrome hệ thống.
    scanned = find_installed_chromium()
    if scanned:
        return scanned, ""

    exe = _find_system_browser()
    if exe:
        warn = (
            f"⚠️ Chưa tải Chromium riêng của Playwright → đang tạm dùng trình duyệt hệ thống: {exe}. "
            "Trình duyệt hệ thống chịu ảnh hưởng bởi group policy / tiện ích / phiên bản của máy "
            "nên có thể bị chặn đăng nhập. Chạy `pyflow-backend.exe install-browser` để cài Chromium riêng."
        )
    else:
        warn = (
            "⚠️ Không tìm thấy Chromium riêng lẫn Chrome/Edge hệ thống. "
            "Chạy `pyflow-backend.exe install-browser` để cài Chromium riêng."
        )
    warn += f" (đường dẫn cần có: {expected or playwright_registry_dir()})"
    return exe, warn


# Các policy hay khiến Chrome/Edge "chính hãng" chặn automation.
_BLOCKING_POLICIES = (
    "BrowserSignin", "ForceBrowserSignin", "RestrictSigninToPattern",
    "CloudManagementEnrollmentToken", "ExtensionInstallForcelist",
    "URLBlocklist", "URLAllowlist", "IncognitoModeAvailability",
    "ManagedAccountsSigninRestriction", "ProfileSeparationSettings",
)


def chrome_policy_hint() -> str:
    """Cảnh báo nếu Chrome/Edge của máy đang bị group policy quản lý.

    Đây là nguyên nhân hay gặp của "máy dev chạy được, máy khách treo ở màn hình
    đăng nhập rồi lỗi": policy như ``BrowserSignin=2`` buộc đăng nhập Chrome trên
    profile mới, automation không bấm qua được nên đứng luôn ở màn hình đó tới khi
    timeout — không có bước điều hướng nào chạy. Chromium riêng của Playwright đọc
    key ``Policies\\Chromium`` nên không bị các policy dành cho Chrome/Edge chi phối.
    """
    if sys.platform != "win32":
        return ""
    try:
        import winreg
    except Exception:
        return ""

    hits: list = []
    total = 0
    targets = (
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Google\Chrome", "Chrome/HKLM"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Policies\Google\Chrome", "Chrome/HKCU"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Policies\Microsoft\Edge", "Edge/HKLM"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Policies\Microsoft\Edge", "Edge/HKCU"),
    )
    for root, sub, tag in targets:
        try:
            with winreg.OpenKey(root, sub) as key:
                n_sub, n_val, _ = winreg.QueryInfoKey(key)
                total += n_sub + n_val
                for i in range(n_val):
                    name, value, _ = winreg.EnumValue(key, i)
                    if name in _BLOCKING_POLICIES:
                        hits.append(f"{tag}:{name}={value}")
                for i in range(n_sub):
                    name = winreg.EnumKey(key, i)
                    if name in _BLOCKING_POLICIES:
                        hits.append(f"{tag}:{name}(danh sách)")
        except Exception:
            continue

    if not total:
        return ""
    msg = f"⚠️ Chrome/Edge của máy này đang bị group policy quản lý ({total} thiết lập)"
    if hits:
        msg += " — trong đó có policy dễ chặn automation: " + ", ".join(hits[:6])
    msg += (
        ". Policy kiểu bắt buộc đăng nhập Chrome sẽ giữ cửa sổ ở màn hình đăng nhập và "
        "automation không đi tiếp được bước nào. Cài Chromium riêng "
        "(`pyflow-backend.exe install-browser`) để không bị policy của máy can thiệp."
    )
    return msg


# Windows/macOS: KHÔNG được truyền --no-sandbox. Playwright tự thêm cờ này khi
# chromium_sandbox != True, và Chrome/Edge **chính hãng** sẽ hiện thanh vàng
# "You are using an unsupported command-line flag: --no-sandbox" (đo được: infobar
# +56px, đẩy layout xuống) — vừa xấu vừa là dấu hiệu automation cho site bot-detect.
# Chromium bundled của Playwright không hiện thanh này nên trước đây không ai thấy.
# Chỉ Linux (container/root) mới thực sự cần tắt sandbox.
CHROMIUM_SANDBOX = sys.platform in ("win32", "darwin")
SANDBOX_ARGS = [] if CHROMIUM_SANDBOX else ["--no-sandbox", "--disable-dev-shm-usage"]


# Flag tắt hộp thoại "Lưu mật khẩu?" và các popup gây nhiễu automation.
# Dùng chung cho cả lúc chạy workflow và lúc ghi thao tác (recorder).
QUIET_BROWSER_ARGS = [
    "--disable-save-password-bubble",       # tắt bong bóng "Lưu mật khẩu?"
    "--password-store=basic",               # không gọi keyring/credential manager của OS
    "--disable-notifications",
    "--no-default-browser-check",
    "--no-first-run",
    "--disable-features=PasswordLeakDetection,AutofillServerCommunication",
    "--test-type",                          # Ẩn cảnh báo "--no-sandbox"
]


def harden_profile_prefs(profile_dir: str):
    """Ghi Preferences của profile để Chrome KHÔNG hỏi lưu mật khẩu.

    Launch flag một mình không đủ trên Chrome mới — pref `credentials_enable_service`
    mới là thứ quyết định. Hàm này MERGE vào Preferences sẵn có (không ghi đè) để giữ
    nguyên các thiết lập/phiên đăng nhập đã lưu trong profile.
    Gọi TRƯỚC khi launch persistent context.
    """
    try:
        default_dir = os.path.join(profile_dir, "Default")
        os.makedirs(default_dir, exist_ok=True)
        pref_path = os.path.join(default_dir, "Preferences")

        data = {}
        if os.path.exists(pref_path):
            try:
                with open(pref_path, "r", encoding="utf-8") as f:
                    data = json.load(f) or {}
            except Exception:
                data = {}
        if not isinstance(data, dict):
            data = {}

        # Tắt password manager (khoá then chốt cho hộp thoại "Lưu mật khẩu?")
        data["credentials_enable_service"] = False
        data["credentials_enable_autosignin"] = False

        profile = data.get("profile") if isinstance(data.get("profile"), dict) else {}
        profile["password_manager_enabled"] = False
        profile["password_manager_leak_detection"] = False
        data["profile"] = profile

        # Tắt luôn thanh gợi ý dịch trang (hay che mất nội dung khi automation)
        translate = data.get("translate") if isinstance(data.get("translate"), dict) else {}
        translate["enabled"] = False
        data["translate"] = translate

        with open(pref_path, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        # Không được để lỗi ghi pref làm chết cả lượt chạy
        pass


# Global registry for keeping browser sessions alive across blocks in the same run
_active_browser_sessions = {}


def force_kill_browser_by_marker(marker: str):
    """Tắt CỨNG tiến trình Chrome/Edge có `marker` (thường là run_id) trong command line.

    Dùng khi người dùng bấm Dừng nhưng khối Browser đang kẹt trong 1 lệnh Playwright
    (VD retry click chờ timeout) — không thể ngắt từ thread khác. Kill tiến trình khiến
    lệnh Playwright đang treo lập tức raise "browser closed" → vòng lặp thoát ngay.
    An toàn: chỉ khớp tiến trình có đúng marker (run_id là uuid, duy nhất).
    """
    if not marker:
        return
    import sys
    import subprocess
    try:
        if sys.platform == "win32":
            ps = (
                "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | "
                "Where-Object { $_.CommandLine -like '*" + marker + "*' } | "
                "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
            )
            subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                capture_output=True, timeout=15,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        else:
            subprocess.run(["pkill", "-f", marker], capture_output=True, timeout=15)
    except Exception:
        pass


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

            # Dùng Chromium riêng của Playwright (tách khỏi Chrome/Edge người dùng đang
            # mở PyFlow) để không tranh GPU gây "đen màn hình". Fallback Chrome hệ thống.
            browser_exe, browser_warn = pick_browser(pw)
            log("info", "🧭 Trình duyệt: " + ("Chromium riêng (Playwright)" if browser_exe is None else browser_exe))
            if browser_warn:
                log("warning", browser_warn)
                # Chỉ soi policy khi buộc phải dùng Chrome/Edge hệ thống — Chromium
                # riêng không đọc các policy đó nên không cần làm nhiễu log.
                policy_warn = chrome_policy_hint()
                if policy_warn:
                    log("warning", policy_warn)

            # Tắt GPU khi: (a) chạy ẩn; hoặc (b) buộc dùng Chrome/Edge hệ thống
            # (browser_exe != None) — trường hợp dễ tranh GPU với tab PyFlow gây "đen màn hình".
            launch_args = list(SANDBOX_ARGS)
            # Luôn tắt GPU hardware để tránh lỗi đen màn hình do tranh chấp GPU với UI PyFlow (WebView2).
            # BỎ CỜ --disable-software-rasterizer để WebGL có thể fallback về SwiftShader (CPU),
            # giúp vượt qua các bài kiểm tra Bot Detection (như Cloudflare) khi đăng nhập.
            launch_args += ["--disable-gpu"]

            # Ẩn cờ Automation của Chromium để vượt qua các tường lửa (như Viettel WAF/Cloudflare)
            launch_args += ["--disable-blink-features=AutomationControlled"]

            # Không hỏi "Lưu mật khẩu?" / không hiện popup gây nhiễu automation
            launch_args += QUIET_BROWSER_ARGS

            log("info", f"🪟 Đang mở cửa sổ trình duyệt (headless={headless})...")

            try:
                if browser_profile_dir:
                    os.makedirs(browser_profile_dir, exist_ok=True)
                    harden_profile_prefs(browser_profile_dir)
                    context = pw.chromium.launch_persistent_context(
                        user_data_dir=browser_profile_dir,
                        executable_path=browser_exe,
                        headless=headless,
                        args=launch_args,
                        chromium_sandbox=CHROMIUM_SANDBOX,
                        ignore_default_args=["--enable-automation"],
                        viewport={"width": 1280, "height": 800}
                    )
                    page = context.pages[0] if context.pages else context.new_page()
                    browser = None
                else:
                    browser = pw.chromium.launch(
                        executable_path=browser_exe,
                        headless=headless,
                        args=launch_args,
                        chromium_sandbox=CHROMIUM_SANDBOX,
                        ignore_default_args=["--enable-automation"]
                    )
                    context = browser.new_context(
                        viewport={"width": 1280, "height": 800}
                    )
                    page = context.new_page()
            except Exception as e:
                # Đây là chỗ log hay dừng lại trên máy khách mà không rõ lý do —
                # in đủ ngữ cảnh để chẩn đoán từ xa thay vì phải mò.
                log("error", f"✗ Không mở được trình duyệt: {e}")
                log("error", f"   • Trình duyệt: {browser_exe or 'Chromium riêng (Playwright)'}")
                log("error", f"   • Thư mục profile: {browser_profile_dir or '(không dùng)'}")
                log("error", "   • Hay gặp: phần mềm bảo mật/EDR của công ty chặn kênh điều khiển "
                             "(--remote-debugging-pipe), đường dẫn profile quá dài (>260 ký tự), "
                             "hoặc Chrome hệ thống bị group policy giữ lại. Cài Chromium riêng bằng "
                             "`pyflow-backend.exe install-browser` rồi thử lại.")
                raise
            
            # Ẩn thuộc tính webdriver trong Javascript
            context.add_init_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined});")

            # Ghi phiên bản thật đang chạy — để so máy dev vs máy khách khi có sự cố
            # (Chromium riêng và Chrome hệ thống cho ra UA khác nhau).
            try:
                ua = page.evaluate("() => navigator.userAgent")
                ver = re.search(r"Chrome/([\d.]+)", ua or "")
                log("info", f"✅ Trình duyệt đã sẵn sàng — Chrome/{ver.group(1) if ver else '?'}")
            except Exception:
                log("info", "✅ Trình duyệt đã sẵn sàng")


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
