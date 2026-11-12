"""Client ID của ứng dụng OAuth dùng cho khối "Tải lên đám mây".

Chủ dự án đăng ký MỘT lần (xem docs/cloud-upload-setup.md) rồi điền vào đây; bản đóng
gói giao cho khách dùng chung các giá trị này — khách không phải đăng ký gì.

Với ứng dụng desktop (public client), Client ID và cả GOOGLE_CLIENT_SECRET đều KHÔNG
phải bí mật: Google ghi rõ secret của loại "Desktop app" không được coi là bí mật vì nó
nằm trong mã phát hành. An toàn đến từ việc người dùng tự đăng nhập + đồng ý quyền, và
token chỉ lưu trên máy họ.

Có thể ghi đè bằng biến môi trường (tiện khi thử nghiệm mà không sửa code).
"""
import os

GOOGLE_CLIENT_ID = os.getenv("PYFLOW_GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("PYFLOW_GOOGLE_CLIENT_SECRET", "")
MICROSOFT_CLIENT_ID = os.getenv("PYFLOW_MICROSOFT_CLIENT_ID", "")


def is_configured(provider: str) -> bool:
    if provider == "google":
        return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)
    if provider == "onedrive":
        return bool(MICROSOFT_CLIENT_ID)
    return False
