#!/usr/bin/env python3
"""
keygen.py — Công cụ CẤP & KÝ license cho PyFlow Studio (chạy phía NHÀ PHÁT HÀNH).

⚠️  File private key sinh ra ở đây là "chìa khóa vàng" — ai có nó là tự cấp được
    license. TUYỆT ĐỐI không commit lên git, không đưa lên server, phải sao lưu
    an toàn (mất private key = phải phát hành lại public key cho toàn bộ khách).

Cơ chế: Ed25519 (chữ ký số bất đối xứng).
  - Bạn giữ PRIVATE key để KÝ license.
  - App chỉ nhúng PUBLIC key để VERIFY — không ký được → không ai forge license.

License "key" là 1 chuỗi 1 dòng, dán vào app:  PF1.<payload_b64>.<chữ_ký_b64>

──────────────────────────────────────────────────────────────────────────────
CÁCH DÙNG (chạy bằng python của venv backend cho chắc có cryptography):

  # 1) Tạo cặp khóa lần đầu (chỉ làm 1 lần, giữ mãi)
  python tools/keygen.py init

  # 2) Cấp license cho 1 khách (lấy "vân tay máy" từ màn Kích hoạt của họ)
  python tools/keygen.py issue --customer "Cty ABC" --machine 3f9a...e1 --days 365

  # 3) Gia hạn = cấp key mới hạn xa hơn cho ĐÚNG vân tay máy đó
  python tools/keygen.py issue --customer "Cty ABC" --machine 3f9a...e1 --expiry 2027-12-31

  # 4) Tự kiểm tra 1 key (tùy chọn)
  python tools/keygen.py verify --key PF1.xxxx.yyyy --machine 3f9a...e1
──────────────────────────────────────────────────────────────────────────────
"""
import argparse
import base64
import json
import os
import secrets
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import (
        Ed25519PrivateKey, Ed25519PublicKey,
    )
    from cryptography.exceptions import InvalidSignature
except ImportError:
    print("Thiếu thư viện 'cryptography'. Cài: pip install cryptography", file=sys.stderr)
    sys.exit(1)

TOKEN_PREFIX = "PF1"
SECRETS_DIR = Path(__file__).parent.parent / "secrets"
PRIV_FILE = SECRETS_DIR / "license_private.txt"
PUB_FILE = SECRETS_DIR / "license_public.txt"


# ── base64url không padding (gọn, an toàn khi copy) ─────────────────────────
def b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def b64d(txt: str) -> bytes:
    pad = "=" * (-len(txt) % 4)
    return base64.urlsafe_b64decode(txt + pad)


# ── init: tạo cặp khóa ──────────────────────────────────────────────────────
def cmd_init(args):
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    if PRIV_FILE.exists() and not args.force:
        print(f"❌ Đã tồn tại {PRIV_FILE}. Muốn tạo lại (mất khóa cũ!) thêm --force.")
        sys.exit(1)

    priv = Ed25519PrivateKey.generate()
    priv_b64 = b64e(priv.private_bytes_raw())
    pub_b64 = b64e(priv.public_key().public_bytes_raw())

    PRIV_FILE.write_text(priv_b64, encoding="utf-8")
    PUB_FILE.write_text(pub_b64, encoding="utf-8")

    print("✅ Đã tạo cặp khóa Ed25519 trong thư mục secrets/ (đã .gitignore).")
    print(f"   - Private key: {PRIV_FILE}  ← GIỮ BÍ MẬT, SAO LƯU AN TOÀN")
    print(f"   - Public key : {PUB_FILE}")
    print()
    print("👉 DÁN public key này vào backend/services/license_pubkey.py:")
    print(f'   PUBLIC_KEY_B64 = "{pub_b64}"')


# ── issue: ký 1 license ───────────────────────────────────────────────────────
def cmd_issue(args):
    if not PRIV_FILE.exists():
        print("❌ Chưa có private key. Chạy trước: python tools/keygen.py init")
        sys.exit(1)
    priv = Ed25519PrivateKey.from_private_bytes(b64d(PRIV_FILE.read_text().strip()))

    # Xác định ngày hết hạn
    if args.expiry:
        try:
            exp = datetime.strptime(args.expiry, "%Y-%m-%d").date()
        except ValueError:
            print("❌ --expiry phải dạng YYYY-MM-DD"); sys.exit(1)
    else:
        exp = date.today() + timedelta(days=args.days)

    payload = {
        "v": 1,
        "cust": args.customer,
        "machine": args.machine.strip().lower(),
        "exp": exp.isoformat(),
        "iat": date.today().isoformat(),
        "lid": secrets.token_hex(6),
        "feat": [f.strip() for f in args.features.split(",") if f.strip()] if args.features else [],
    }
    payload_b64 = b64e(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    sig = priv.sign(payload_b64.encode("ascii"))
    token = f"{TOKEN_PREFIX}.{payload_b64}.{b64e(sig)}"

    print("✅ ĐÃ CẤP LICENSE — gửi chuỗi dưới cho khách dán vào app:")
    print()
    print(token)
    print()
    print(f"   Khách hàng : {payload['cust']}")
    print(f"   Vân tay máy: {payload['machine']}")
    print(f"   Hết hạn    : {payload['exp']}  (còn {(exp - date.today()).days} ngày)")
    print(f"   License ID : {payload['lid']}")
    if payload["feat"]:
        print(f"   Tính năng  : {', '.join(payload['feat'])}")


# ── verify: tự kiểm tra ───────────────────────────────────────────────────────
def cmd_verify(args):
    pub_b64 = args.pub or (PUB_FILE.read_text().strip() if PUB_FILE.exists() else None)
    if not pub_b64:
        print("❌ Không có public key (thiếu secrets/license_public.txt hoặc --pub)."); sys.exit(1)
    pub = Ed25519PublicKey.from_public_bytes(b64d(pub_b64))

    try:
        prefix, payload_b64, sig_b64 = args.key.strip().split(".")
        assert prefix == TOKEN_PREFIX
    except Exception:
        print("❌ Key sai định dạng."); sys.exit(1)

    try:
        pub.verify(b64d(sig_b64), payload_b64.encode("ascii"))
    except InvalidSignature:
        print("❌ CHỮ KÝ KHÔNG HỢP LỆ (key giả hoặc sai public key)."); sys.exit(1)

    payload = json.loads(b64d(payload_b64))
    exp = datetime.strptime(payload["exp"], "%Y-%m-%d").date()
    days_left = (exp - date.today()).days
    print("✅ Chữ ký hợp lệ.")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"   → {'CÒN HẠN' if days_left >= 0 else 'HẾT HẠN'} ({days_left} ngày)")
    if args.machine and args.machine.strip().lower() != payload["machine"]:
        print(f"   ⚠ Vân tay máy KHÔNG khớp (key: {payload['machine']} vs bạn nhập: {args.machine})")


def main():
    p = argparse.ArgumentParser(description="Công cụ cấp license PyFlow Studio")
    sub = p.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("init", help="Tạo cặp khóa Ed25519 (chỉ 1 lần)")
    pi.add_argument("--force", action="store_true", help="Ghi đè khóa cũ (nguy hiểm)")
    pi.set_defaults(func=cmd_init)

    ps = sub.add_parser("issue", help="Ký 1 license cho khách")
    ps.add_argument("--customer", required=True, help="Tên khách hàng")
    ps.add_argument("--machine", required=True, help="Vân tay máy (lấy từ màn Kích hoạt của khách)")
    ps.add_argument("--days", type=int, default=365, help="Số ngày hiệu lực (mặc định 365)")
    ps.add_argument("--expiry", help="Hoặc đặt ngày hết hạn cụ thể YYYY-MM-DD (ưu tiên hơn --days)")
    ps.add_argument("--features", help="Danh sách tính năng, cách nhau bởi dấu phẩy (tùy chọn)")
    ps.set_defaults(func=cmd_issue)

    pv = sub.add_parser("verify", help="Tự kiểm tra 1 key")
    pv.add_argument("--key", required=True)
    pv.add_argument("--machine", help="Vân tay máy để đối chiếu (tùy chọn)")
    pv.add_argument("--pub", help="Public key b64 (mặc định đọc secrets/license_public.txt)")
    pv.set_defaults(func=cmd_verify)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
