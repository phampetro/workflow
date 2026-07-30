# Hướng dẫn Quản lý & Cấp phép Bản quyền PyFlow Studio

Tài liệu này được viết ngắn gọn theo từng bước để bạn dễ dàng nắm bắt quy trình thiết lập, đóng gói, cấp bản quyền cho khách hàng, gia hạn và cập nhật.

---

## 1. Chuẩn bị hệ thống (Chỉ làm 1 lần trên máy của bạn)

Trước khi bắt đầu cấp phép, bạn cần tạo khóa bảo mật để hệ thống nhận diện đây là phần mềm chính chủ.

**Bước 1: Tạo khóa bảo mật**
Chạy lệnh sau trong terminal:
```bash
backend/.venv/Scripts/python.exe tools/keygen.py init
```
*Lưu ý: Lệnh này tạo ra "khóa bí mật" (lưu ở `secrets/license_private.txt`). Tuyệt đối giữ kín file này. Nếu mất, bạn phải tạo lại từ đầu và cấp lại key cho toàn bộ khách hàng.*

**Bước 2: Gắn khóa vào phần mềm**
- Copy chuỗi `PUBLIC_KEY_B64="..."` vừa hiện ra.
- Mở file `backend/services/license_pubkey.py` và dán thay thế vào biến `PUBLIC_KEY_B64`.

---

## 2. Hướng dẫn Đóng gói Tự động (Release)

Thay vì phải tự build và cấu hình thủ công, hệ thống đã có sẵn một công cụ đóng gói tự động. Công cụ này sẽ tự build Frontend, copy mã nguồn an toàn (bỏ qua các thư mục nhạy cảm như `secrets/`, `data/`, `.git/`), và **tự động bật khóa bản quyền** trong file khởi động dành cho khách hàng.

**Bước 1: Chạy công cụ đóng gói**
Mở terminal tại thư mục gốc của dự án và chạy:
```bash
python tools/build_release.py
```

**Bước 2: Nén và gửi cho khách hàng**
- Sau khi chạy lệnh trên thành công, bạn sẽ thấy một thư mục mới được tạo ra tại `Releases/pyflow-studio`.
- Bên trong thư mục này đã có sẵn file `start.vbs` (cho máy Windows) và `start_mac.command` (cho máy Mac). Toàn bộ mã nguồn Python đã được đóng gói an toàn thành file thực thi (EXE). Frontend cũng đã được build và gộp thẳng vào Backend.
- Bạn chỉ việc nén toàn bộ thư mục `pyflow-studio` thành một file `.zip` và gửi cho khách hàng. Mọi thứ đã sẵn sàng để chạy ngay không cần cài đặt (Portable).

---

## 3. Triển khai cho khách hàng mới (Cài & Kích hoạt)

Mỗi khi có một khách hàng mới, hãy làm theo quy trình sau:

**Bước 1: Khách hàng tải và lấy Mã Máy**
- Khách hàng tải bản zip về, giải nén và nhấp đúp vào file `start.vbs` (Windows) hoặc `start_mac.command` (macOS) để chạy phần mềm ngay lập tức (không cần cài đặt setup.bat như trước đây).
- Lần đầu mở phần mềm, màn hình "Kích hoạt bản quyền" sẽ hiện ra cùng một **Mã Máy** (Ví dụ: `e8f4a2b1...`).
- Khách hàng copy Mã Máy này và gửi cho bạn.

**Bước 2: Bạn tạo Key kích hoạt**
- Từ máy của bạn, chạy lệnh sau để tạo key cho Mã Máy đó (ví dụ cấp 365 ngày):
  ```bash
  backend/.venv/Scripts/python.exe tools/keygen.py issue --customer "Tên Khách Hàng" --machine <MÃ_MÁY_CỦA_KHÁCH> --days 365
  ```
- Lệnh sẽ in ra một mã key (bắt đầu bằng `PF1...`). Gửi mã key này cho khách.

**Bước 3: Khách hàng kích hoạt**
- Khách hàng dán mã key bạn gửi vào màn hình Kích hoạt, bấm **Kích hoạt**. Phần mềm sẽ mở khóa và dùng offline vĩnh viễn trong thời hạn được cấp.

---

## 4. Gia hạn bản quyền

1. Khi phần mềm hết hạn, màn hình Kích hoạt tự động hiện lại để chặn sử dụng. **Không cần cài lại phần mềm.**
2. Bạn lặp lại **Bước 2 (mục 3)**: Chạy lệnh tạo một mã key mới cho **cùng Mã Máy cũ**. 
   - Nếu bạn dùng cờ `--days 365`, thời hạn sẽ được cộng 365 ngày **kể từ ngày hôm nay** (ngày bạn gõ lệnh).
   - Nếu bạn muốn ấn định một ngày hết hạn cụ thể, hãy dùng cờ `--expiry` thay cho `--days`. Ví dụ:
     ```bash
     backend/.venv/Scripts/python.exe tools/keygen.py issue --customer "Tên Khách" --machine <MÃ_MÁY> --expiry 2027-12-31
     ```
3. Gửi key mới này cho khách. Khách dán vào và tiếp tục sử dụng bình thường.

---

## 5. Cập nhật phiên bản mới (Auto-Update qua GitHub)

Để khách hàng có thể tự động tải và cập nhật phiên bản mới ngay trong ứng dụng (tính năng **Tự động 100%**), bạn cần đẩy bản đóng gói mới lên mục **Releases** của GitHub `phampetro/workflow_re`. Dưới đây là các bước chuẩn xác:

**Phía Bạn (Nhà phát triển):**
1. Khi có code mới, bạn chạy lại lệnh `python tools/build_release.py`.
2. Lấy toàn bộ nội dung bên trong thư mục `Releases/pyflow-studio` mới sinh ra (gồm thư mục `backend`, `frontend` và file `start.vbs`), nén tất cả lại thành một file `.zip` (bạn có thể đặt tên là `update.zip`).
   > *Lưu ý quan trọng: Phải nén **trực tiếp** các file/thư mục con bên trong, chứ không phải nén thư mục thư mục cha `pyflow-studio`. Nếu khách hàng mở file zip ra phải thấy ngay `start.vbs` thì mới đúng chuẩn.*
3. Lên trang GitHub: `https://github.com/phampetro/workflow_re/releases`
4. Bấm nút **"Draft a new release"**.
5. Chọn hoặc tạo mới thẻ phiên bản ở mục **"Choose a tag"** (Ví dụ: `v1.1.0`, nhớ phải có chữ `v` và lớn hơn version cũ).
6. Kéo thả file `update.zip` vừa tạo vào phần **"Attach binaries by dropping them here..."**.
7. Bấm **"Publish release"**. Xong!

**Phía Khách hàng (Người dùng):**
1. Khách hàng đang dùng phần mềm sẽ thấy nút **"Cập nhật ngay"** trong mục Thông tin.
2. Khách bấm nút, phần mềm sẽ tự động tải file `update.zip` từ GitHub về, tự hiện màn hình đen (CMD) giải nén, ghi đè mã nguồn mới và giữ nguyên vẹn toàn bộ dữ liệu (nằm trong thư mục `backend/data`).
3. Phần mềm tự khởi động lại bản mới. Không cần khách hàng phải thao tác thủ công sao chép file gì cả!

## 6. Lệnh tham khảo nhanh

```bash
# 1. Tạo cặp khóa (Chỉ làm 1 lần)
backend/.venv/Scripts/python.exe tools/keygen.py init

# 2. Cấp mới / Gia hạn
backend/.venv/Scripts/python.exe tools/keygen.py issue --customer "Khách hàng A" --machine <MÃ_MÁY> --days 365

# 3. Lấy nhanh Mã Máy (Dùng để hỗ trợ khách)
backend/.venv/Scripts/python.exe backend/services/licensing.py

# 4. Tự kiểm tra 1 key xem có khớp với Mã Máy không
backend/.venv/Scripts/python.exe tools/keygen.py verify --key PF1.xxx --machine <MÃ_MÁY>
```
