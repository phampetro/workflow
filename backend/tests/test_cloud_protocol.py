"""Giao thức upload Google Drive / OneDrive trên máy chủ giả (httpx.MockTransport).

Không gọi mạng thật — mô phỏng đúng hành vi API: phiên upload resumable, Content-Range,
308/202 cho phần giữa, tìm/tạo thư mục, xung đột tên, tạo link chia sẻ.
"""
import json
import re

import httpx
import pytest

from services import cloud_storage as cs


def _use(monkeypatch, handler):
    monkeypatch.setattr(cs, "_client", lambda timeout=60.0: httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(cs, "GOOGLE_CHUNK", 4)      # ép chia nhiều phần với file nhỏ
    monkeypatch.setattr(cs, "ONEDRIVE_CHUNK", 4)


class FakeDrive:
    """Drive tối giản: files {id: {name, parents, mime, data}}."""

    def __init__(self, existing=()):
        self.files = {}
        self.perms = []
        self.sessions = {}
        for name in existing:
            self._new(name, "F-root-dir", "text/plain")

    def _new(self, name, parent, mime):
        fid = f"id{len(self.files) + 1}"
        self.files[fid] = {"name": name, "parents": [parent], "mime": mime, "data": b""}
        return fid

    def __call__(self, req: httpx.Request):
        url, m = str(req.url), req.method
        if m == "GET" and url.startswith(cs.GOOGLE_API + "/files?"):
            q = req.url.params["q"]
            name = re.search(r"name = '((?:\\'|[^'])*)'", q).group(1).replace("\\'", "'")
            parent = re.search(r"'([^']+)' in parents", q).group(1)
            want_folder = "mimeType = " in q
            hits = [{"id": i} for i, f in self.files.items()
                    if f["name"] == name and parent in f["parents"]
                    and (f["mime"] == cs.GOOGLE_FOLDER_MIME) == want_folder]
            return httpx.Response(200, json={"files": hits[:1]})
        if m == "POST" and url.startswith(cs.GOOGLE_API + "/files?"):
            body = json.loads(req.content)
            return httpx.Response(200, json={"id": self._new(body["name"], body["parents"][0], body["mimeType"])})
        if m in ("POST", "PATCH") and url.startswith(cs.GOOGLE_UPLOAD + "/files"):
            if m == "POST":
                body = json.loads(req.content)
                fid = self._new(body["name"], body["parents"][0], "text/plain")
            else:
                fid = url.split("/files/")[1].split("?")[0]
            self.sessions["S"] = {"id": fid, "total": int(req.headers["X-Upload-Content-Length"]), "buf": b""}
            return httpx.Response(200, headers={"Location": "https://upload.example/S"})
        if m == "PUT" and url == "https://upload.example/S":
            s = self.sessions["S"]
            start, end, total = map(int, re.match(r"bytes (\d+)-(\d+)/(\d+)", req.headers["Content-Range"]).groups())
            assert start == len(s["buf"]) and total == s["total"]
            s["buf"] += req.content
            if len(s["buf"]) < total:
                return httpx.Response(308)
            self.files[s["id"]]["data"] = s["buf"]
            return httpx.Response(200, json={"id": s["id"]})
        if m == "POST" and url.endswith("/permissions"):
            self.perms.append(json.loads(req.content))
            return httpx.Response(200, json={})
        if m == "GET" and "/files/" in url:
            fid = url.split("/files/")[1].split("?")[0]
            return httpx.Response(200, json={"id": fid, "name": self.files[fid]["name"],
                                             "webViewLink": f"https://drive/{fid}"})
        return httpx.Response(500, json={"error": {"message": f"unexpected {m} {url}"}})


def _file(tmp_path, data=b"0123456789"):
    p = tmp_path / "bao cao.xlsx"
    p.write_bytes(data)
    return str(p)


def test_google_creates_folders_uploads_in_chunks_and_shares(tmp_path, monkeypatch):
    d = FakeDrive()
    _use(monkeypatch, d)
    r = cs.upload_file("google", "AT", _file(tmp_path), "PyFlow/11", "bao cao.xlsx",
                       share="organization", account="me@congty.vn")
    folders = {f["name"]: i for i, f in d.files.items() if f["mime"] == cs.GOOGLE_FOLDER_MIME}
    assert set(folders) == {"PyFlow", "11"}
    assert d.files[folders["11"]]["parents"] == [folders["PyFlow"]]
    assert d.files[r["id"]]["data"] == b"0123456789"            # 3 phần 4+4+2 byte ghép đúng
    assert d.perms == [{"type": "domain", "role": "reader", "domain": "congty.vn"}]
    assert r["url"] == f"https://drive/{r['id']}"


def test_google_rename_on_conflict_and_reuse_folders(tmp_path, monkeypatch):
    d = FakeDrive()
    _use(monkeypatch, d)
    a = cs.upload_file("google", "AT", _file(tmp_path), "X", "bao cao.xlsx")
    b = cs.upload_file("google", "AT", _file(tmp_path), "X", "bao cao.xlsx", conflict="rename")
    assert [f["name"] for f in d.files.values() if f["mime"] == cs.GOOGLE_FOLDER_MIME] == ["X"]
    assert d.files[a["id"]]["name"] == "bao cao.xlsx" and d.files[b["id"]]["name"] == "bao cao (1).xlsx"


def test_google_replace_keeps_same_file_id(tmp_path, monkeypatch):
    d = FakeDrive()
    _use(monkeypatch, d)
    a = cs.upload_file("google", "AT", _file(tmp_path, b"old"), "", "bao cao.xlsx")
    b = cs.upload_file("google", "AT", _file(tmp_path, b"new-data"), "", "bao cao.xlsx", conflict="replace")
    assert a["id"] == b["id"] and d.files[a["id"]]["data"] == b"new-data"


def test_google_fail_on_conflict_and_personal_org_share(tmp_path, monkeypatch):
    d = FakeDrive()
    _use(monkeypatch, d)
    cs.upload_file("google", "AT", _file(tmp_path), "", "bao cao.xlsx")
    with pytest.raises(cs.CloudError) as e:
        cs.upload_file("google", "AT", _file(tmp_path), "", "bao cao.xlsx", conflict="fail")
    assert e.value.code == "exists"
    with pytest.raises(cs.CloudError) as e:
        cs.upload_file("google", "AT", _file(tmp_path), "", "khac.xlsx", share="organization", account="me@gmail.com")
    assert e.value.code == "share_org_personal"


def test_stop_between_chunks(tmp_path, monkeypatch):
    _use(monkeypatch, FakeDrive())
    calls = {"n": 0}

    def should_stop():
        calls["n"] += 1
        return calls["n"] > 1
    with pytest.raises(cs.CloudStopped):
        cs.upload_file("google", "AT", _file(tmp_path), "", "a.xlsx", should_stop=should_stop)


def test_onedrive_upload_session_and_share_link(tmp_path, monkeypatch):
    seen = {"buf": b"", "auth_on_upload_url": None}

    def handler(req: httpx.Request):
        url = str(req.url)
        if url.endswith(":/createUploadSession"):
            assert "/root:/PyFlow/Th%C3%A1ng%2011/bao%20cao.xlsx:" in url
            assert json.loads(req.content)["item"]["@microsoft.graph.conflictBehavior"] == "replace"
            return httpx.Response(200, json={"uploadUrl": "https://up.example/sess"})
        if url == "https://up.example/sess":
            seen["auth_on_upload_url"] = req.headers.get("Authorization")
            seen["buf"] += req.content
            total = int(req.headers["Content-Range"].split("/")[1])
            if len(seen["buf"]) < total:
                return httpx.Response(202, json={})
            return httpx.Response(201, json={"id": "ITEM", "name": "bao cao.xlsx", "webUrl": "https://od/item"})
        if url.endswith("/items/ITEM/createLink"):
            assert json.loads(req.content) == {"type": "view", "scope": "anonymous"}
            return httpx.Response(201, json={"link": {"webUrl": "https://1drv.ms/share"}})
        return httpx.Response(500)

    _use(monkeypatch, handler)
    r = cs.upload_file("onedrive", "AT", _file(tmp_path), "PyFlow/Tháng 11", "bao cao.xlsx",
                       conflict="replace", share="anyone")
    assert seen["buf"] == b"0123456789"
    assert seen["auth_on_upload_url"] is None          # uploadUrl không được kèm Bearer
    assert r == {"id": "ITEM", "name": "bao cao.xlsx", "url": "https://1drv.ms/share"}


def test_onedrive_conflict_fail_maps_to_exists(tmp_path, monkeypatch):
    _use(monkeypatch, lambda req: httpx.Response(409, json={"error": {"message": "nameAlreadyExists"}}))
    with pytest.raises(cs.CloudError) as e:
        cs.upload_file("onedrive", "AT", _file(tmp_path), "", "a.xlsx", conflict="fail")
    assert e.value.code == "exists"


def test_refresh_token_rotation_and_revoked(monkeypatch):
    def handler(req):
        form = dict(x.split("=") for x in req.content.decode().split("&"))
        if form["refresh_token"] == "bad":
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(200, json={"access_token": "AT", "refresh_token": "rotated"})
    _use(monkeypatch, handler)
    assert cs.refresh_access_token("onedrive", "old") == ("AT", "rotated")
    with pytest.raises(cs.CloudError) as e:
        cs.refresh_access_token("google", "bad")
    assert e.value.code == "relogin"
