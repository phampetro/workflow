"""
update_signing.py — Ký & verify bản cập nhật (update.zip) bằng Ed25519.

VÌ SAO CẦN: `/api/system/update` tải update.zip từ GitHub Releases rồi giải nén
ĐÈ LÊN thư mục cài đặt và chạy lại app. Đó là một kênh phân phối code tới máy
khách. Nếu tài khoản GitHub bị chiếm (hoặc ai đó sửa được asset của release),
mọi máy khách bấm "Cập nhật" sẽ chạy code của kẻ tấn công với quyền của người
dùng — trước đây không hề có bước xác minh nào.

CƠ CHẾ: dùng lại đúng cặp khoá Ed25519 đang ký license (`secrets/license_private.txt`
để ký, `services/license_pubkey.PUBLIC_KEY_B64` đã nhúng sẵn trong app để verify).
Không sinh cặp khoá mới: một cặp nữa là một thứ nữa phải sao lưu và có thể mất.

⚠ TÁCH MIỀN (domain separation) — BẮT BUỘC:
Chuỗi được ký là ``b"pyflow-update-v1:" + <sha256 hex của file zip>``, KHÔNG phải
hash trần. License ký trên ``payload_b64`` (ASCII base64url của JSON), không bao
giờ bắt đầu bằng tiền tố này. Nhờ vậy một chữ ký update không thể bị đem dùng lại
làm license và ngược lại, dù chung một khoá.

Định dạng file chữ ký (`update.zip.sig`) — JSON một dòng:
    {"v":1,"alg":"Ed25519","sha256":"<hex>","sig":"<base64url không padding>"}
"""
import base64
import hashlib
import json

UPDATE_SIG_CONTEXT = b"pyflow-update-v1:"
SIG_SCHEMA_VERSION = 1


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(txt: str) -> bytes:
    return base64.urlsafe_b64decode(txt + "=" * (-len(txt) % 4))


def sha256_file(path, chunk_size: int = 1024 * 1024) -> str:
    """SHA-256 của file, đọc theo chunk (update.zip ~85MB, đừng nạp hết vào RAM)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _signed_message(sha256_hex: str) -> bytes:
    return UPDATE_SIG_CONTEXT + sha256_hex.encode("ascii")


def sign_update(zip_path, private_key_b64: str) -> str:
    """Ký file zip, trả về nội dung file .sig (chuỗi JSON). Chỉ chạy phía nhà phát hành."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    digest = sha256_file(zip_path)
    priv = Ed25519PrivateKey.from_private_bytes(_b64d(private_key_b64.strip()))
    sig = priv.sign(_signed_message(digest))
    return json.dumps({
        "v": SIG_SCHEMA_VERSION,
        "alg": "Ed25519",
        "sha256": digest,
        "sig": _b64e(sig),
    }, separators=(",", ":"))


def verify_update(zip_path, sig_text: str, public_key_b64: str) -> None:
    """Xác minh zip khớp chữ ký. Ném ValueError kèm lý do nếu KHÔNG hợp lệ.

    Ném lỗi (chứ không trả False) để caller không thể lỡ bỏ qua giá trị trả về —
    đây là chốt chặn duy nhất trước khi giải nén đè lên thư mục cài đặt.
    """
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.exceptions import InvalidSignature

    if not public_key_b64 or public_key_b64 == "PLACEHOLDER_REPLACE_ME":
        raise ValueError("Chưa nhúng public key thật, không thể xác minh bản cập nhật")

    try:
        meta = json.loads(sig_text)
    except Exception:
        raise ValueError("File chữ ký hỏng (không phải JSON)")

    if meta.get("v") != SIG_SCHEMA_VERSION or meta.get("alg") != "Ed25519":
        raise ValueError(f"Định dạng chữ ký không hỗ trợ: v={meta.get('v')} alg={meta.get('alg')}")

    expected = str(meta.get("sha256", "")).lower()
    actual = sha256_file(zip_path)
    if expected != actual:
        # Sai hash = file tải về khác file đã ký (hỏng đường truyền hoặc bị đổi ruột)
        raise ValueError("Nội dung bản cập nhật không khớp chữ ký (sha256 lệch)")

    pub = Ed25519PublicKey.from_public_bytes(_b64d(public_key_b64))
    try:
        pub.verify(_b64d(str(meta.get("sig", ""))), _signed_message(actual))
    except InvalidSignature:
        raise ValueError("Chữ ký bản cập nhật không hợp lệ")
    except Exception as e:
        raise ValueError(f"Không xác minh được chữ ký: {e}")
