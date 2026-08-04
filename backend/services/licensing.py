"""
licensing.py — Kích hoạt & kiểm tra license OFFLINE cho PyFlow Studio.

Mô hình: khách tải app → dán key (bạn ký sẵn bằng tools/keygen.py) → app verify
bằng public key nhúng sẵn (license_pubkey.py) → dùng tới khi hết hạn. Không cần
server. Hết hạn thì khách xin key mới (gia hạn).

Bật/tắt bằng biến môi trường PYFLOW_LICENSE_ENFORCE=1 (mặc định TẮT để bản dev
không bị khóa). Bản thương mại đóng gói sẽ bật cờ này.

Chạy trực tiếp để lấy vân tay máy + xem trạng thái (hỗ trợ khách):
    python backend/services/licensing.py
"""
import base64
import hashlib
import json
import os
import platform
import subprocess
import sys
import uuid
from datetime import date, datetime
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.exceptions import InvalidSignature
    _CRYPTO_OK = True
except ImportError:
    _CRYPTO_OK = False

try:
    from services.license_pubkey import PUBLIC_KEY_B64
except Exception:  # pragma: no cover - khi import kiểu script
    try:
        from license_pubkey import PUBLIC_KEY_B64
    except Exception:
        PUBLIC_KEY_B64 = "PLACEHOLDER_REPLACE_ME"

# DATA_DIR dùng chung với phần còn lại của app
try:
    from services.venv_manager import DATA_DIR
except Exception:  # chạy như script rời
    DATA_DIR = Path(__file__).parent.parent / "data"

TOKEN_PREFIX = "PF1"
FINGERPRINT_SALT = "pyflow-studio::machine::v1"  # chỉ để không lộ machine-id gốc
LICENSE_FILE = DATA_DIR / "license.key"
STATE_FILE = DATA_DIR / ".license_state"
CLOCK_TOLERANCE_DAYS = 2  # cho phép lệch giờ nhỏ trước khi coi là chỉnh ngược

ENFORCE = os.getenv("PYFLOW_LICENSE_ENFORCE", "0") == "1"


# ── base64url không padding ──────────────────────────────────────────────────
def _b64d(txt: str) -> bytes:
    pad = "=" * (-len(txt) % 4)
    return base64.urlsafe_b64decode(txt + pad)


# ── VÂN TAY MÁY (đa nền tảng, "nới lỏng" theo OS install id) ──────────────────
_cached_fp = None


def _raw_machine_id() -> str:
    """Lấy 1 định danh ổn định theo bản cài OS — KHÔNG phụ thuộc RAM/ổ cứng cụ thể,
    nên khách nâng cấp phần cứng lẻ không bị khóa oan. Chỉ đổi khi cài lại OS."""
    system = platform.system()
    try:
        if system == "Windows":
            # MachineGuid: sinh khi cài Windows, rất ổn định
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r"SOFTWARE\Microsoft\Cryptography",
                0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
            )
            val, _ = winreg.QueryValueEx(key, "MachineGuid")
            winreg.CloseKey(key)
            if val:
                return f"win:{val}"
        elif system == "Darwin":
            # IOPlatformUUID: UUID phần cứng máy Mac
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                text=True, timeout=5,
            )
            for line in out.splitlines():
                if "IOPlatformUUID" in line:
                    return "mac:" + line.split('"')[-2]
        else:  # Linux/khác
            for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
                fp = Path(p)
                if fp.exists():
                    mid = fp.read_text().strip()
                    if mid:
                        return f"lin:{mid}"
    except Exception:
        pass
    # Fallback cuối: MAC address (kém ổn định hơn nhưng còn hơn không)
    return f"mac-node:{uuid.getnode():012x}"


def get_machine_fingerprint() -> str:
    """Trả về vân tay máy đã hash (32 hex ký tự), an toàn để hiển thị/gửi support."""
    global _cached_fp
    if _cached_fp is None:
        raw = (_raw_machine_id() + "|" + FINGERPRINT_SALT).encode("utf-8")
        _cached_fp = hashlib.sha256(raw).hexdigest()[:32]
    return _cached_fp


# ── VERIFY chữ ký + parse payload ─────────────────────────────────────────────
def verify_token(token: str) -> dict:
    """Verify chữ ký Ed25519, trả payload dict. Raise ValueError nếu không hợp lệ."""
    if not _CRYPTO_OK:
        raise ValueError("Thiếu thư viện cryptography")
    if not PUBLIC_KEY_B64 or PUBLIC_KEY_B64 == "PLACEHOLDER_REPLACE_ME":
        raise ValueError("Chưa nhúng public key thật (license_pubkey.py)")
    try:
        prefix, payload_b64, sig_b64 = token.strip().split(".")
    except ValueError:
        raise ValueError("Key sai định dạng")
    if prefix != TOKEN_PREFIX:
        raise ValueError("Key sai định dạng")

    pub = Ed25519PublicKey.from_public_bytes(_b64d(PUBLIC_KEY_B64))
    try:
        pub.verify(_b64d(sig_b64), payload_b64.encode("ascii"))
    except InvalidSignature:
        raise ValueError("Chữ ký không hợp lệ")
    try:
        return json.loads(_b64d(payload_b64))
    except Exception:
        raise ValueError("Payload hỏng")


# ── Chống tua ngược đồng hồ ────────────────────────────────────────────────────
def _clock_tampered(now: date) -> bool:
    try:
        if STATE_FILE.exists():
            last = datetime.strptime(STATE_FILE.read_text().strip(), "%Y-%m-%d").date()
            if (last - now).days > CLOCK_TOLERANCE_DAYS:
                return True  # giờ hệ thống bị đẩy lùi so với lần chạy trước
        # cập nhật mốc = max(đã lưu, hôm nay)
        newest = now
        if STATE_FILE.exists():
            try:
                prev = datetime.strptime(STATE_FILE.read_text().strip(), "%Y-%m-%d").date()
                newest = max(prev, now)
            except Exception:
                pass
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(newest.isoformat(), encoding="utf-8")
    except Exception:
        pass
    return False


# ── Đánh giá 1 license với máy hiện tại ────────────────────────────────────────
def _evaluate(token: str) -> dict:
    fp = get_machine_fingerprint()
    try:
        payload = verify_token(token)
    except ValueError as e:
        return {"valid": False, "reason": str(e), "payload": None}

    machine = str(payload.get("machine", "")).lower()
    if machine != "*" and machine != fp:
        return {"valid": False, "reason": "License không cấp cho máy này", "payload": payload}

    today = date.today()
    if _clock_tampered(today):
        return {"valid": False, "reason": "Phát hiện chỉnh ngược đồng hồ hệ thống", "payload": payload}

    try:
        exp = datetime.strptime(payload["exp"], "%Y-%m-%d").date()
    except Exception:
        return {"valid": False, "reason": "Ngày hết hạn không hợp lệ", "payload": payload}

    days_left = (exp - today).days
    if days_left < 0:
        return {"valid": False, "reason": f"License đã hết hạn ({payload['exp']})",
                "payload": payload, "days_left": days_left}

    return {"valid": True, "reason": "", "payload": payload, "days_left": days_left}


# ── Cache license ──────────────────────────────────────────────────────────────
def load_license() -> str | None:
    try:
        if LICENSE_FILE.exists():
            return LICENSE_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        pass
    return None


def save_license(token: str):
    LICENSE_FILE.parent.mkdir(parents=True, exist_ok=True)
    LICENSE_FILE.write_text(token.strip(), encoding="utf-8")


# ── API cho router ──────────────────────────────────────────────────────────────
def get_status() -> dict:
    """Trạng thái license hiện tại. FE khóa app khi (enforced and not valid)."""
    fp = get_machine_fingerprint()
    token = load_license()
    base = {
        "enforced": ENFORCE,
        # Bản đóng gói (PyInstaller) hay chạy từ source. FE cần biết để KHÔNG bao
        # giờ hiện "Bản phát triển" trên bản đã đóng gói giao cho khách — cờ
        # ENFORCE nằm ở launcher (start.vbs) nên nếu app được bật không qua
        # launcher thì enforced=False, và trước đây bảng bản quyền hiện
        # "Bản phát triển (Mở khóa)" màu xanh khiến khách hiểu nhầm.
        "packaged": bool(getattr(sys, "frozen", False)),
        "activated": bool(token),
        "machine": fp,
        "customer": None,
        "expiry": None,
        "days_left": None,
    }
    if not token:
        return {**base, "valid": False, "reason": "Chưa kích hoạt"}

    ev = _evaluate(token)
    p = ev.get("payload") or {}
    return {
        **base,
        "valid": ev["valid"],
        "reason": ev["reason"],
        "customer": p.get("cust"),
        "expiry": p.get("exp"),
        "days_left": ev.get("days_left"),
        "features": p.get("feat", []),
    }


def activate(token: str) -> dict:
    """Kích hoạt bằng key khách dán vào. Trả {ok, reason?, status}."""
    token = (token or "").strip()
    if not token:
        return {"ok": False, "reason": "Chưa nhập key", "status": get_status()}

    ev = _evaluate(token)
    if not ev["valid"]:
        # Thông báo rõ nếu key thuộc máy khác
        p = ev.get("payload")
        reason = ev["reason"]
        if p and str(p.get("machine", "")).lower() not in ("*", get_machine_fingerprint()):
            reason = f"{reason}. Vân tay máy này: {get_machine_fingerprint()}"
        return {"ok": False, "reason": reason, "status": get_status()}

    save_license(token)
    return {"ok": True, "status": get_status()}


def is_locked() -> bool:
    """True nếu cần chặn (đang bật enforce mà license không hợp lệ)."""
    if not ENFORCE:
        return False
    return not get_status()["valid"]


# ── Chạy như script: in vân tay + trạng thái (dùng khi hỗ trợ khách) ──────────
if __name__ == "__main__":
    print("Vân tay máy :", get_machine_fingerprint())
    print("Enforce     :", ENFORCE)
    st = get_status()
    print("Trạng thái  :", json.dumps(st, ensure_ascii=False, indent=2))
    sys.exit(0)
