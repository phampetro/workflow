"""SSL context dùng chung cho MỌI request HTTPS ra ngoài bằng urllib (Telegram, Google
Sheets, GitHub...).

``urlopen()`` không truyền context sẽ chỉ tin Windows Certificate Store. Kho đó trên máy
mới / user Windows mới CHƯA có sẵn nhiều root CA: Windows chỉ tải root về (AIA / auto
root update) khi trình duyệt (Schannel) hit domain đó lần đầu, còn Python (OpenSSL)
không tự tải. Hậu quả đã gặp thật: khối Telegram báo
"CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain" với
api.telegram.org dù chứng chỉ là hàng thật của GoDaddy — trình duyệt trên cùng máy vẫn
vào Telegram bình thường.

Vì vậy context ở đây tin CẢ HAI nguồn:
- CA bundle của certifi (đầy đủ, không phụ thuộc máy) → sửa lỗi trên.
- Windows store (load_default_certs) → giữ được mạng công ty soi TLS bằng CA riêng
  chỉ được cài vào Windows (dùng certifi đơn thuần sẽ gãy ở đó).
"""
import logging
import ssl
from functools import lru_cache

logger = logging.getLogger("pyflow.net")


@lru_cache(maxsize=1)
def https_context() -> ssl.SSLContext:
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception as e:
        logger.warning("Không nạp được CA bundle của certifi, chỉ dùng Windows store: %s", e)
        return ssl.create_default_context()
    try:
        ctx.load_default_certs()
    except Exception as e:
        logger.warning("Không nạp được Windows certificate store: %s", e)
    return ctx
