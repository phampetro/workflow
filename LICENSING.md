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

> ⚠ **PyFlow Studio chỉ chạy trên Windows.** Bản đóng gói do PyInstaller build trên Windows và PyInstaller không cross-compile — không có bản macOS/Linux.

Hệ thống có sẵn công cụ đóng gói tự động. Công cụ này sẽ: build Frontend, đóng gói Backend thành file thực thi (EXE) bằng PyInstaller, sinh file khởi động `start.vbs` (đã **tự động bật khóa bản quyền**), tạo `update.zip`, **ký chữ ký số** và upload lên GitHub Releases.

**Chạy công cụ đóng gói**
Mở terminal tại thư mục gốc của dự án và chạy:
```bash
python tools/build_release.py
```

**Kết quả sinh ra**
| Đường dẫn | Là gì |
|---|---|
| `Releases/pyflow-studio/` | Thư mục chạy được (portable) — gửi trực tiếp cho khách hàng cài mới |
| `Releases/update.zip` | Gói dùng cho tính năng tự cập nhật |
| `Releases/update.zip.sig` | **Chữ ký số của gói trên — bắt buộc phải đi kèm** |

- Trong `Releases/pyflow-studio/` đã có sẵn `start.vbs`. Mã nguồn Python đã đóng gói thành EXE, Frontend đã build và gộp thẳng vào Backend.
- Muốn giao cho **khách hàng mới**: nén thư mục `pyflow-studio` thành `.zip` rồi gửi. Chạy ngay, không cần cài đặt (Portable).
- Nếu file `secrets/license_private.txt` không tồn tại, công cụ sẽ **dừng hẳn** và báo lỗi — vì không ký được thì mọi máy khách sẽ từ chối bản cập nhật đó.

---

## 3. Triển khai cho khách hàng mới (Cài & Kích hoạt)

Mỗi khi có một khách hàng mới, hãy làm theo quy trình sau:

**Bước 1: Khách hàng tải và lấy Mã Máy**
- Khách hàng tải bản zip về, giải nén và nhấp đúp vào file `start.vbs` để chạy phần mềm ngay lập tức (không cần cài đặt `setup.bat` như trước đây).
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

**Phía Bạn (Nhà phát triển) — TỰ ĐỘNG HOÀN TOÀN:**

1. Đảm bảo file `.env` ở thư mục gốc có dòng `GITHUB_TOKEN=...` (token cần quyền ghi Releases của repo `phampetro/workflow_re`).
2. Chạy `python tools/build_release.py`.

Xong. Công cụ tự làm hết phần còn lại: tạo `update.zip`, **ký chữ ký số**, tìm (hoặc tạo) release theo thẻ `v<version>`, xoá asset cũ trùng tên và upload **cả hai** file `update.zip` + `update.zip.sig`.

> ⚠ **KHÔNG upload thủ công qua trang web GitHub.** Từ phiên bản có xác minh chữ ký, mỗi release **bắt buộc phải có đủ 2 asset**:
> - `update.zip`
> - `update.zip.sig`
>
> Nếu bạn kéo thả tay và chỉ đưa lên `update.zip`, app của khách sẽ **từ chối cài** với thông báo *"Bản cập nhật này không có chữ ký số (update.zip.sig) nên đã bị từ chối"*. Đó là chủ đích: `update.zip` được giải nén **đè lên thư mục cài đặt** rồi chạy lại app, nên nếu không xác minh thì bất kỳ ai sửa được asset của release đều khiến mọi máy khách chạy code lạ.
>
> Nếu buộc phải upload tay, phải đưa lên **đúng cả 2 file** mà `build_release.py` đã sinh trong thư mục `Releases/` — không được tự nén lại `update.zip` bằng tay, vì chữ ký gắn với đúng nội dung file cũ (sửa 1 byte là chữ ký sai).

**Phía Khách hàng (Người dùng):**
1. Khách hàng đang dùng phần mềm sẽ thấy nút **"Cập nhật ngay"** trong mục Thông tin.
2. Khách bấm nút, phần mềm tải `update.zip` từ GitHub về, **xác minh chữ ký số trước**, rồi mới hiện màn hình đen (CMD) giải nén, ghi đè mã nguồn mới và giữ nguyên vẹn toàn bộ dữ liệu (nằm trong thư mục `backend/data`).
3. Phần mềm tự khởi động lại bản mới. Không cần khách hàng thao tác sao chép file gì cả.
4. Nếu chữ ký không hợp lệ hoặc thiếu, phần mềm **không cài** và hiện lý do ngay trong bảng Thông tin — file tải về cũng bị xoá luôn, không để lại bản chưa xác minh trên đĩa.

### Chữ ký số dùng khoá nào?

Dùng lại **đúng cặp khoá Ed25519 đang ký license** (`secrets/license_private.txt` + public key đã nhúng trong `backend/services/license_pubkey.py`). Không cần tạo hay quản lý thêm khoá nào.

Hai loại chữ ký được **tách miền** nên không thể dùng lẫn cho nhau: chữ ký cập nhật ký trên `pyflow-update-v1:<sha256 của file zip>`, còn license ký trên payload của key. Nghĩa là một license hợp lệ không thể bị đem dùng làm chữ ký cho bản cập nhật giả, và ngược lại.

⚠ Mất `secrets/license_private.txt` = vừa không cấp được license mới, vừa không phát hành được bản cập nhật nào nữa. Sao lưu file này ở nơi an toàn.

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

# 5. Đóng gói + ký + upload bản cập nhật (tự động hoàn toàn)
python tools/build_release.py
```

**Tự kiểm tra chữ ký của bản cập nhật vừa build:**
```bash
backend/.venv/Scripts/python.exe -c "import sys; sys.path.insert(0,'backend'); from services.update_signing import verify_update; from services.license_pubkey import PUBLIC_KEY_B64; verify_update('Releases/update.zip', open('Releases/update.zip.sig',encoding='utf-8').read(), PUBLIC_KEY_B64); print('Chu ky HOP LE')"
```
