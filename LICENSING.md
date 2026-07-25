# LICENSING — Kích hoạt bản quyền PyFlow Studio (offline)

Tài liệu triển khai hệ thống license: từ tạo khóa → đóng gói bật khóa → cấp key
cho khách → khách cài & kích hoạt → gia hạn → cập nhật.

## 1. Mô hình tổng quan

- **Không cần server.** License được **ký sẵn** bằng khóa riêng của bạn, khách dán
  vào app, app **verify offline** bằng public key nhúng sẵn. Dùng tới khi hết hạn.
- **Chữ ký số Ed25519** (bất đối xứng): bạn giữ **private key** để ký; app chỉ có
  **public key** để verify → không có private key thì **không ai forge được license**.
- **Ràng buộc máy**: mỗi key gắn với "vân tay máy" → copy sang máy khác không dùng được.
- **Hết hạn → khách xin key mới** (gia hạn = cấp lại key hạn xa hơn cho cùng máy).

```
[BẠN] keygen ký license ──(gửi key)──▶ [KHÁCH] dán vào app ──▶ app verify offline ──▶ dùng
   ▲ giữ private key                                              (public key nhúng sẵn)
```

## 2. Vân tay máy (machine fingerprint) hoạt động thế nào

File: [`backend/services/licensing.py`](backend/services/licensing.py) → `get_machine_fingerprint()`.

Lấy một định danh **ổn định theo bản cài hệ điều hành** (không phụ thuộc RAM/ổ cứng
lẻ nên khách nâng cấp phần cứng không bị khóa oan), rồi `SHA-256` → 32 ký tự hex:

| OS | Nguồn định danh | Đổi khi |
|---|---|---|
| Windows | Registry `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` | Cài lại Windows |
| macOS | `IOPlatformUUID` (`ioreg`) | Đổi bo mạch máy |
| Linux | `/etc/machine-id` | Cài lại OS |
| (dự phòng) | MAC address | — |

Vân tay đã hash nên an toàn để hiển thị/gửi qua email. Lấy nhanh để hỗ trợ khách:

```bash
backend/.venv/Scripts/python.exe backend/services/licensing.py
```

## 3. Chuẩn bị MỘT LẦN (phía bạn)

> Chạy các lệnh `keygen.py` bằng python của venv backend cho chắc có `cryptography`.

### 3.1 Tạo cặp khóa
```bash
backend/.venv/Scripts/python.exe tools/keygen.py init
```
Sinh ra `secrets/license_private.txt` (BÍ MẬT) + `secrets/license_public.txt`, và in
sẵn dòng `PUBLIC_KEY_B64="..."`.

> ⚠️ `secrets/` đã được `.gitignore`. **Sao lưu private key ra nơi an toàn** (USB/mật
> khẩu manager). Mất private key = phải phát hành public key mới cho toàn bộ khách.

### 3.2 Nhúng public key vào app
Mở [`backend/services/license_pubkey.py`](backend/services/license_pubkey.py), thay:
```python
PUBLIC_KEY_B64 = "PLACEHOLDER_REPLACE_ME"
```
bằng public key thật từ bước 3.1. (Public key công khai được, an toàn khi ở trong code.)

## 4. Đóng gói bản thương mại — BẬT khóa

Mặc định khóa **TẮT** (biến môi trường `PYFLOW_LICENSE_ENFORCE` khác `1`) để bản dev
không bị khóa. Khi đóng gói bán, **bật** bằng cách đặt biến môi trường trước khi chạy
backend:

- **Windows** (trong script khởi động / installer):
  ```bat
  set PYFLOW_LICENSE_ENFORCE=1
  ```
- **macOS/Linux**:
  ```bash
  export PYFLOW_LICENSE_ENFORCE=1
  ```

Khi bật:
- License không hợp lệ/hết hạn → mọi API bị chặn `403` (trừ `/api/license/*`,
  `/api/system/*`, `/health`), FE hiện **màn Kích hoạt**.
- ⚠️ Nếu quên nhúng public key thật (còn `PLACEHOLDER`), mọi license đều bị coi là
  không hợp lệ (fail-safe an toàn).

> **Khuyến nghị**: khi build, compile phần backend (Nuitka) để guard license không bị
> xóa dễ. Xem README/tài liệu đóng gói.

## 5. Cấp key cho khách

1. Khách mở app (đã bật enforce) → màn Kích hoạt hiển thị **Mã máy** → khách gửi mã đó
   cho bạn. (Hoặc chạy lệnh ở mục 2 để lấy.)
2. Bạn ký license cho đúng mã máy đó:
   ```bash
   backend/.venv/Scripts/python.exe tools/keygen.py issue \
       --customer "Cty ABC" --machine <mã_máy_của_khách> --days 365
   ```
   (hoặc `--expiry 2027-12-31` để đặt ngày hết hạn cụ thể).
3. Gửi chuỗi key (`PF1.xxxx.yyyy`) cho khách.

## 6. Khách cài & kích hoạt

1. Cài như bình thường (tải gói → setup → start) — **không đổi so với hiện tại**.
2. Lần chạy đầu: màn Kích hoạt hiện ra → khách **dán key** → bấm **Kích hoạt**.
3. App lưu license vào `backend/data/license.key` và mở khóa. Từ đó **chạy offline**
   bình thường tới khi hết hạn.

## 7. Gia hạn

Khi hết hạn, app hiện lại màn Kích hoạt kèm thông báo hết hạn. Bạn chỉ cần **cấp key mới
hạn xa hơn cho đúng mã máy đó** (lặp lại mục 5, đổi `--days`/`--expiry`), khách dán key
mới → dùng tiếp. Không cần cài lại.

## 8. Cập nhật bản mới (giữ như hiện tại, nhưng bỏ git-pull)

Không dùng `git pull` (lộ source). Thay bằng **GitHub Releases**:
- Mỗi bản mới: đăng gói cài (đã ký) + `manifest.json` `{version, url, signature}` lên
  GitHub Releases.
- App bấm "Kiểm tra cập nhật" → tải manifest → nếu mới hơn, tải gói → **verify chữ ký**
  (cùng public key) → cài → restart.
- Vì gói được ký, host (GitHub) không cần tin cậy: không ai đẩy được bản giả.

> Phần này cần chỉnh [`backend/routers/system.py`](backend/routers/system.py) (đang
> `git pull`) sang tải release đã ký — làm sau khi chốt kênh phát hành.

## 9. Bảo mật — nên/không nên

- ✅ Sao lưu `secrets/license_private.txt` an toàn; **không bao giờ commit / đưa lên mạng**.
- ✅ Ký license trên máy bạn (offline).
- ✅ Compile guard khi đóng gói (Nuitka) để khó gỡ chốt kiểm tra.
- ❌ Không nhét private key vào code, GitHub, hay server.
- ❌ Không tin vào việc "giấu code Python" — bảo vệ nằm ở **chữ ký** (không có private
  key thì không forge được license), không ở việc giấu.

## 10. Lệnh tham khảo nhanh

```bash
# Lấy vân tay máy (hỗ trợ khách)
backend/.venv/Scripts/python.exe backend/services/licensing.py

# Tạo cặp khóa (1 lần)
backend/.venv/Scripts/python.exe tools/keygen.py init

# Cấp / gia hạn license
backend/.venv/Scripts/python.exe tools/keygen.py issue --customer "Cty ABC" --machine <fp> --days 365

# Tự kiểm tra 1 key
backend/.venv/Scripts/python.exe tools/keygen.py verify --key PF1.xxxx.yyyy --machine <fp>
```

## 11. Các file liên quan

| File | Vai trò |
|---|---|
| [`tools/keygen.py`](tools/keygen.py) | CLI phía bạn: tạo khóa, ký/gia hạn license |
| [`backend/services/licensing.py`](backend/services/licensing.py) | Vân tay máy, verify, cache, activate, chống tua giờ |
| [`backend/services/license_pubkey.py`](backend/services/license_pubkey.py) | Nơi nhúng **public key** thật |
| [`backend/routers/license.py`](backend/routers/license.py) | API `status` / `fingerprint` / `activate` |
| [`backend/main.py`](backend/main.py) | Guard middleware (bật theo `PYFLOW_LICENSE_ENFORCE`) |
| [`frontend/src/components/LicenseGate.jsx`](frontend/src/components/LicenseGate.jsx) | Màn khóa kích hoạt |
| `secrets/` (gitignored) | Private key — GIỮ BÍ MẬT |
| `backend/data/license.key` (gitignored) | License đã kích hoạt của khách |

## 12. Cơ chế chống gian lận đã có

- **Chữ ký Ed25519**: sửa 1 ký tự trong key → verify fail.
- **Ràng buộc máy**: key máy A không chạy trên máy B (báo rõ + hiện vân tay máy hiện tại).
- **Hết hạn**: theo ngày `exp` ký trong license.
- **Chống tua ngược đồng hồ**: lưu mốc thời gian lần chạy gần nhất; đẩy lùi giờ hệ thống
  quá `2` ngày → coi là gian lận (`CLOCK_TOLERANCE_DAYS` trong `licensing.py`).
