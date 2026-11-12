"""Google Drive / OneDrive cho khối "Tải lên đám mây" — đăng nhập OAuth + upload file.

Chạy TRONG backend bằng httpx (đã có sẵn), không dùng venv project → không khai
_BLOCK_BASE. Mọi request HTTPS dùng services.net.https_context() (certifi + Windows
store) — xem lý do ở net.py.

Đăng nhập: Authorization Code + PKCE, redirect về CHÍNH backend
(http://127.0.0.1:<port>/api/cloud/oauth/<provider>/callback) — kiểu "loopback" mà
Google/Microsoft khuyến nghị cho ứng dụng desktop. `state` ngẫu nhiên chống giả mạo
callback; mã PKCE chống người khác chặn được `code` đem đổi token.

Phạm vi quyền được chọn hẹp nhất có thể:
- Google `drive.file`: app chỉ thấy/sửa file DO CHÍNH NÓ TẠO. Là quyền "không nhạy
  cảm" nên Google không bắt thẩm định ứng dụng. Hệ quả: thư mục đích do app tự tạo.
- Microsoft `Files.ReadWrite`: OneDrive của chính người đăng nhập.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
import urllib.parse

import httpx

from services import cloud_oauth_config as cfg
from services.net import https_context

PROVIDERS = ("google", "onedrive")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file openid email"
GOOGLE_API = "https://www.googleapis.com/drive/v3"
GOOGLE_UPLOAD = "https://www.googleapis.com/upload/drive/v3"
GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder"
GOOGLE_PERSONAL_DOMAINS = {"gmail.com", "googlemail.com"}

MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MS_SCOPES = "offline_access Files.ReadWrite User.Read"
MS_GRAPH = "https://graph.microsoft.com/v1.0"

# Kích thước mỗi phần khi upload — đúng bội số mà từng API yêu cầu.
GOOGLE_CHUNK = 32 * 256 * 1024      # 8 MiB, bội của 256 KiB
ONEDRIVE_CHUNK = 25 * 320 * 1024    # 7,8 MiB, bội của 320 KiB

CONFLICT_MODES = ("rename", "replace", "fail")
SHARE_MODES = ("none", "organization", "anyone")

OAUTH_TTL_SEC = 600


class CloudError(Exception):
    """Lỗi có mã để dịch qua log_messages (key "cloud_err_<code>")."""

    def __init__(self, code, **params):
        super().__init__(code)
        self.code = code
        self.params = params


class CloudStopped(Exception):
    """Người dùng bấm Dừng giữa lúc đang tải lên."""


def _client(timeout=60.0):
    return httpx.Client(verify=https_context(), timeout=timeout)


def _api_error(resp) -> CloudError:
    detail = resp.text[:300]
    try:
        body = resp.json()
        err = body.get("error")
        if isinstance(err, dict):
            detail = err.get("message") or detail
        elif isinstance(err, str):
            detail = body.get("error_description") or err
    except ValueError:
        pass
    return CloudError("api", status=resp.status_code, detail=detail)


def _check(resp):
    if resp.status_code >= 400:
        raise _api_error(resp)
    return resp


# ── Đường dẫn / tên file ─────────────────────────────────────────────
_BAD_NAME_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def clean_segment(name: str) -> str:
    """1 tên thư mục/file an toàn cho cả Drive lẫn OneDrive (OneDrive cấm \\ / : * ? " < > |)."""
    return _BAD_NAME_CHARS.sub("_", str(name)).strip().strip(".")


def folder_segments(path: str) -> list:
    """"Báo cáo/{{thang}}" (đã nội suy) → ["Báo cáo", "11"]. Bỏ "", ".", ".." —
    ô này đi qua nội suy {{var}} nên giá trị có thể do người ngoài gửi tới."""
    parts = re.split(r"[\\/]+", str(path or ""))
    out = []
    for p in parts:
        p = p.strip()
        if p in ("", ".", ".."):
            continue
        p = clean_segment(p)
        if p:
            out.append(p)
    return out


def numbered_name(name: str, n: int) -> str:
    """"bao_cao.xlsx", 2 → "bao_cao (2).xlsx"."""
    stem, dot, ext = name.rpartition(".")
    if not dot or not stem:
        return f"{name} ({n})"
    return f"{stem} ({n}).{ext}"


# ── OAuth ────────────────────────────────────────────────────────────
_pending = {}            # state -> dict(provider, workflow_id, connection_id, verifier, redirect_uri, created)
_pending_lock = threading.Lock()


def _pkce_pair():
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def _purge_expired():
    now = time.time()
    for k in [k for k, v in _pending.items() if now - v["created"] > OAUTH_TTL_SEC]:
        _pending.pop(k, None)


def build_auth_url(provider, redirect_uri, workflow_id, connection_id=None) -> str:
    if provider not in PROVIDERS:
        raise CloudError("bad_provider", provider=provider)
    if not cfg.is_configured(provider):
        raise CloudError("not_configured", provider=provider)
    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    with _pending_lock:
        _purge_expired()
        _pending[state] = {"provider": provider, "workflow_id": workflow_id,
                           "connection_id": connection_id, "verifier": verifier,
                           "redirect_uri": redirect_uri, "created": time.time()}
    common = {"response_type": "code", "redirect_uri": redirect_uri, "state": state,
              "code_challenge": challenge, "code_challenge_method": "S256"}
    if provider == "google":
        # access_type=offline + prompt=consent: Google chỉ trả refresh_token ở lần đồng
        # ý; thiếu 2 tham số này thì đăng nhập lại sẽ KHÔNG có refresh_token.
        params = {**common, "client_id": cfg.GOOGLE_CLIENT_ID, "scope": GOOGLE_SCOPES,
                  "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"}
        return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    params = {**common, "client_id": cfg.MICROSOFT_CLIENT_ID, "scope": MS_SCOPES,
              "response_mode": "query", "prompt": "select_account"}
    return f"{MS_AUTH_URL}?{urllib.parse.urlencode(params)}"


def _jwt_email(id_token: str) -> str:
    try:
        payload = id_token.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return data.get("email", "")
    except (IndexError, ValueError):
        return ""


def complete_oauth(provider, state, code) -> dict:
    """Đổi `code` lấy token. Trả {workflow_id, connection_id, refresh_token, account}."""
    with _pending_lock:
        _purge_expired()
        pend = _pending.pop(state, None)
    if not pend or pend["provider"] != provider:
        raise CloudError("bad_state")

    with _client(30) as c:
        if provider == "google":
            resp = _check(c.post(GOOGLE_TOKEN_URL, data={
                "grant_type": "authorization_code", "code": code,
                "client_id": cfg.GOOGLE_CLIENT_ID, "client_secret": cfg.GOOGLE_CLIENT_SECRET,
                "redirect_uri": pend["redirect_uri"], "code_verifier": pend["verifier"],
            })).json()
            account = _jwt_email(resp.get("id_token", ""))
        else:
            resp = _check(c.post(MS_TOKEN_URL, data={
                "grant_type": "authorization_code", "code": code, "client_id": cfg.MICROSOFT_CLIENT_ID,
                "redirect_uri": pend["redirect_uri"], "code_verifier": pend["verifier"], "scope": MS_SCOPES,
            })).json()
            me = _check(c.get(f"{MS_GRAPH}/me", headers={"Authorization": f"Bearer {resp['access_token']}"})).json()
            account = me.get("mail") or me.get("userPrincipalName") or ""

    refresh = resp.get("refresh_token")
    if not refresh:
        raise CloudError("no_refresh_token")
    return {"workflow_id": pend["workflow_id"], "connection_id": pend["connection_id"],
            "refresh_token": refresh, "account": account}


def refresh_access_token(provider, refresh_token) -> tuple:
    """Trả (access_token, refresh_token_mới_hoặc_None).

    Microsoft XOAY refresh token: mỗi lần làm mới trả token mới — caller PHẢI lưu lại,
    nếu không token cũ hết hạn dần và kết nối "tự nhiên" đòi đăng nhập lại.
    """
    if not refresh_token:
        raise CloudError("not_connected")
    with _client(30) as c:
        if provider == "google":
            resp = c.post(GOOGLE_TOKEN_URL, data={
                "grant_type": "refresh_token", "refresh_token": refresh_token,
                "client_id": cfg.GOOGLE_CLIENT_ID, "client_secret": cfg.GOOGLE_CLIENT_SECRET})
        else:
            resp = c.post(MS_TOKEN_URL, data={
                "grant_type": "refresh_token", "refresh_token": refresh_token,
                "client_id": cfg.MICROSOFT_CLIENT_ID, "scope": MS_SCOPES})
    if resp.status_code in (400, 401):
        # invalid_grant: người dùng gỡ quyền / đổi mật khẩu / token hết hạn
        raise CloudError("relogin")
    data = _check(resp).json()
    new_refresh = data.get("refresh_token")
    return data["access_token"], (new_refresh if new_refresh and new_refresh != refresh_token else None)


# ── Upload ───────────────────────────────────────────────────────────
def _read_chunks(path, size):
    with open(path, "rb") as f:
        while True:
            data = f.read(size)
            if not data:
                return
            yield data


def _put_chunks(c, upload_url, path, total, chunk_size, should_stop, headers=None, done_codes=(200, 201)):
    """PUT từng phần với Content-Range; trả JSON của phần cuối."""
    sent = 0
    for chunk in _read_chunks(path, chunk_size):
        if should_stop():
            raise CloudStopped()
        end = sent + len(chunk) - 1
        resp = c.put(upload_url, content=chunk,
                     headers={**(headers or {}), "Content-Range": f"bytes {sent}-{end}/{total}"})
        sent = end + 1
        if resp.status_code in done_codes:
            return resp.json()
        if resp.status_code not in (202, 308):
            raise _api_error(resp)
    raise CloudError("incomplete")


def _g_escape(name):
    return name.replace("\\", "\\\\").replace("'", "\\'")


def _g_find(c, auth, name, parent, folder):
    mime = f"mimeType {'=' if folder else '!='} '{GOOGLE_FOLDER_MIME}'"
    q = f"name = '{_g_escape(name)}' and '{parent}' in parents and trashed = false and {mime}"
    files = _check(c.get(f"{GOOGLE_API}/files", headers=auth,
                         params={"q": q, "fields": "files(id)", "spaces": "drive", "pageSize": 1})).json()
    items = files.get("files") or []
    return items[0]["id"] if items else None


def _google_upload(c, token, path, segments, name, conflict, share, account, should_stop):
    auth = {"Authorization": f"Bearer {token}"}
    parent = "root"
    for seg in segments:
        found = _g_find(c, auth, seg, parent, folder=True)
        if not found:
            found = _check(c.post(f"{GOOGLE_API}/files", headers=auth, params={"fields": "id"},
                                  json={"name": seg, "mimeType": GOOGLE_FOLDER_MIME, "parents": [parent]})).json()["id"]
        parent = found

    existing = _g_find(c, auth, name, parent, folder=False)
    if existing and conflict == "fail":
        raise CloudError("exists", name=name)
    if existing and conflict == "rename":
        for n in range(1, 1000):
            candidate = numbered_name(name, n)
            if not _g_find(c, auth, candidate, parent, folder=False):
                name, existing = candidate, None
                break

    total = os.path.getsize(path)
    if existing:   # replace: ghi đè NỘI DUNG, giữ nguyên id + link đã chia sẻ
        start = c.patch(f"{GOOGLE_UPLOAD}/files/{existing}", headers={**auth, "X-Upload-Content-Length": str(total)},
                        params={"uploadType": "resumable"}, json={})
    else:
        start = c.post(f"{GOOGLE_UPLOAD}/files", headers={**auth, "X-Upload-Content-Length": str(total)},
                       params={"uploadType": "resumable"}, json={"name": name, "parents": [parent]})
    upload_url = _check(start).headers["Location"]
    if total == 0:
        file_id = _check(c.put(upload_url, content=b"")).json()["id"]
    else:
        file_id = _put_chunks(c, upload_url, path, total, GOOGLE_CHUNK, should_stop)["id"]

    if share != "none":
        if share == "anyone":
            perm = {"type": "anyone", "role": "reader"}
        else:
            domain = account.rpartition("@")[2].lower()
            if not domain or domain in GOOGLE_PERSONAL_DOMAINS:
                raise CloudError("share_org_personal")
            perm = {"type": "domain", "role": "reader", "domain": domain}
        _check(c.post(f"{GOOGLE_API}/files/{file_id}/permissions", headers=auth, json=perm))

    info = _check(c.get(f"{GOOGLE_API}/files/{file_id}", headers=auth, params={"fields": "id,name,webViewLink"})).json()
    return {"id": info["id"], "name": info.get("name", name), "url": info.get("webViewLink", "")}


def _onedrive_upload(c, token, path, segments, name, conflict, share, should_stop):
    auth = {"Authorization": f"Bearer {token}"}
    # Địa chỉ theo đường dẫn: OneDrive tự tạo thư mục trung gian còn thiếu.
    rel = "/".join(urllib.parse.quote(s, safe="") for s in [*segments, name])
    item_url = f"{MS_GRAPH}/me/drive/root:/{rel}:"
    total = os.path.getsize(path)

    if total == 0:   # phiên upload không nhận file rỗng → PUT thẳng
        resp = c.put(f"{item_url}/content", headers=auth, content=b"",
                     params={"@microsoft.graph.conflictBehavior": conflict})
        if resp.status_code == 409:
            raise CloudError("exists", name=name)
        item = _check(resp).json()
    else:
        resp = c.post(f"{item_url}/createUploadSession", headers=auth,
                      json={"item": {"@microsoft.graph.conflictBehavior": conflict}})
        if resp.status_code == 409:
            raise CloudError("exists", name=name)
        upload_url = _check(resp).json()["uploadUrl"]
        # uploadUrl đã kèm quyền — KHÔNG gửi header Authorization tới đây (Graph từ chối).
        try:
            item = _put_chunks(c, upload_url, path, total, ONEDRIVE_CHUNK, should_stop)
        except CloudError as e:
            if e.code == "api" and e.params.get("status") == 409:
                raise CloudError("exists", name=name)
            raise

    url = item.get("webUrl", "")
    if share != "none":
        link = _check(c.post(f"{MS_GRAPH}/me/drive/items/{item['id']}/createLink", headers=auth,
                             json={"type": "view", "scope": "anonymous" if share == "anyone" else "organization"})).json()
        url = (link.get("link") or {}).get("webUrl") or url
    return {"id": item["id"], "name": item.get("name", name), "url": url}


def upload_file(provider, access_token, path, folder, remote_name, conflict="rename", share="none",
                account="", should_stop=lambda: False) -> dict:
    """Tải 1 file lên. Trả {"id", "name", "url"}."""
    if conflict not in CONFLICT_MODES:
        conflict = "rename"
    if share not in SHARE_MODES:
        share = "none"
    name = clean_segment(remote_name) or clean_segment(os.path.basename(path))
    segments = folder_segments(folder)
    with _client(120) as c:
        if provider == "google":
            return _google_upload(c, access_token, path, segments, name, conflict, share, account, should_stop)
        if provider == "onedrive":
            return _onedrive_upload(c, access_token, path, segments, name, conflict, share, should_stop)
    raise CloudError("bad_provider", provider=provider)
