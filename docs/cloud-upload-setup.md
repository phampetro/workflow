# Cấu hình khối "Tải lên đám mây" (Google Drive / OneDrive)

Khối cần **Client ID** của một ứng dụng OAuth để người dùng đăng nhập tài khoản Drive / OneDrive.
Chủ dự án đăng ký **một lần**, điền vào [`backend/services/cloud_oauth_config.py`](../backend/services/cloud_oauth_config.py),
rồi build release — mọi máy khách dùng chung, khách không phải đăng ký gì.

> Với ứng dụng desktop, Client ID (và client secret loại "Desktop app" của Google) **không phải bí mật**:
> Google ghi rõ secret loại này nằm trong bản phát hành nên không coi là bí mật. An toàn đến từ việc
> người dùng tự đăng nhập + đồng ý quyền, token chỉ lưu trên máy họ và không bao giờ trả ra API / file export.

---

## 1. Google Drive

1. Vào <https://console.cloud.google.com> → tạo project mới (VD `PyFlow Studio`).
2. **APIs & Services → Library** → tìm **Google Drive API** → **Enable**.
3. **Google Auth Platform** (màn "OAuth consent screen"):
   - **Branding**: tên ứng dụng (`PyFlow Studio`), email hỗ trợ, email liên hệ.
   - **Audience**: chọn **External**.
   - **Data access → Add or remove scopes**: thêm đúng 3 quyền
     `.../auth/drive.file`, `openid`, `.../auth/userinfo.email`.
     Cả 3 đều là quyền *không nhạy cảm* → **không phải gửi Google thẩm định**.
   - **Audience → Publish app** → chuyển sang **In production**.
     ⚠ Để ở chế độ *Testing* thì chỉ tài khoản trong danh sách test đăng nhập được, và
     **token tự hết hạn sau 7 ngày** — khối sẽ đòi đăng nhập lại hàng tuần.
4. **Clients → Create client** → Application type **Desktop app** → đặt tên → **Create**.
   Ghi lại **Client ID** và **Client secret**.
   (Loại Desktop app tự chấp nhận redirect `http://127.0.0.1:<cổng bất kỳ>` — không cần khai redirect URI.)

Điền vào `cloud_oauth_config.py`:

```python
GOOGLE_CLIENT_ID = os.getenv("PYFLOW_GOOGLE_CLIENT_ID", "xxxxx.apps.googleusercontent.com")
GOOGLE_CLIENT_SECRET = os.getenv("PYFLOW_GOOGLE_CLIENT_SECRET", "GOCSPX-xxxxx")
```

**Giới hạn do quyền `drive.file`** (đổi lại việc không phải thẩm định): app chỉ thấy file/thư mục
**do chính nó tạo**. Ô "Thư mục đích" (VD `Báo cáo/{{thang}}`) sẽ được app tự tạo trong *My Drive*;
muốn người khác xem thì chia sẻ thư mục đó trên Drive, hoặc chọn "Tạo link chia sẻ" trong khối.

---

## 2. OneDrive (Microsoft 365 / tài khoản Microsoft cá nhân)

1. Vào <https://portal.azure.com> → **Microsoft Entra ID → App registrations → New registration**.
2. **Name**: `PyFlow Studio`.
   **Supported account types**: *Accounts in any organizational directory and personal Microsoft accounts*
   (dùng được cả OneDrive công ty lẫn cá nhân).
3. **Redirect URI**: chọn nền tảng **Public client/native (mobile & desktop)**, nhập đúng:

   ```
   http://localhost/api/cloud/oauth/onedrive/callback
   ```

   Microsoft bỏ qua số cổng với `localhost`, nên bản dev (cổng 7000) và bản đóng gói (cổng 8000) đều khớp.
4. **API permissions → Add a permission → Microsoft Graph → Delegated**: thêm `Files.ReadWrite`,
   `offline_access` (`User.Read` có sẵn).
5. **Overview** → chép **Application (client) ID**.

Điền vào `cloud_oauth_config.py`:

```python
MICROSOFT_CLIENT_ID = os.getenv("PYFLOW_MICROSOFT_CLIENT_ID", "00000000-0000-0000-0000-000000000000")
```

⚠ Nhiều công ty **tắt quyền người dùng tự đồng ý** cho ứng dụng ngoài. Khi đó trang đăng nhập báo
"Need admin approval" → nhờ quản trị Microsoft 365 vào app registration bấm **Grant admin consent**.

---

## 3. Kiểm tra

1. Khởi động lại backend.
2. Mở 1 workflow → **Dữ liệu Workflow → Lưu trữ đám mây** → nút đăng nhập hết bị mờ → đăng nhập.
3. Tab trình duyệt báo "Đã kết nối" → quay lại app, kết nối hiện trạng thái **Đã đăng nhập**.
4. Thêm khối **Tải lên đám mây**, chọn kết nối + file, chạy thử → log in ra link file.
5. Build release (`tools/build_release.py`) để máy khách có khối mới.

Có thể thử mà chưa sửa code bằng biến môi trường `PYFLOW_GOOGLE_CLIENT_ID`,
`PYFLOW_GOOGLE_CLIENT_SECRET`, `PYFLOW_MICROSOFT_CLIENT_ID` trước khi chạy backend.
