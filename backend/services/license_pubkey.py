"""
Public key để VERIFY license (Ed25519, base64url raw 32 bytes).

⚠️  THAY giá trị dưới bằng public key THẬT của bạn:
      python tools/keygen.py init
    rồi copy dòng PUBLIC_KEY_B64 nó in ra vào đây.

Chỉ là PUBLIC key → công khai được, an toàn khi nằm trong code. Private key
(dùng để ký) không bao giờ nằm ở đây.

Khi để nguyên PLACEHOLDER và bật enforce, mọi license đều bị coi là không hợp lệ
(fail-safe) — nhắc bạn chưa nhúng khóa thật.
"""
PUBLIC_KEY_B64 = "PLACEHOLDER_REPLACE_ME"
