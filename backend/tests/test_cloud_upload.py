"""Khối "Tải lên đám mây" — chạy workflow thật, giả lập lời gọi mạng tới Google/Microsoft."""
import sqlite3
import urllib.parse

import pytest

from conftest import graph
from services import cloud_oauth_config, cloud_storage as cs


@pytest.fixture
def fake_cloud(monkeypatch):
    calls = {"uploads": [], "rotated": None}

    def refresh(provider, token):
        if token == "revoked":
            raise cs.CloudError("relogin")
        return "AT", calls["rotated"]

    def upload(provider, access_token, path, folder, remote_name, conflict, share, account, should_stop):
        calls["uploads"].append({"provider": provider, "path": path, "folder": folder, "name": remote_name,
                                 "conflict": conflict, "share": share})
        return {"id": f"id-{remote_name}", "name": remote_name, "url": f"https://x/{remote_name}"}

    monkeypatch.setattr(cs, "refresh_access_token", refresh)
    monkeypatch.setattr(cs, "upload_file", upload)
    return calls


def _block(**data):
    base = {"cloudConnectionId": "cc1", "cloudFiles": ["a.xlsx"], "cloudFolder": "Bao cao/{{thang}}"}
    return {**base, **data}


def test_single_file_uploads_and_exposes_link(engine, fake_cloud):
    engine.add_cloud_connection()
    (engine.input_dir / "a.xlsx").write_bytes(b"1")
    engine.write_input_json({"thang": "11", "chat_id": "c1"})
    status, _ = engine.run(graph(
        [("s", "start", {}), ("up", "cloud_upload", _block(cloudShare="anyone")), ("py", "python", {"code": "x"})],
        [("s", "up"), ("up", "py")]))
    assert status == "success"
    up = fake_cloud["uploads"][0]
    assert up["folder"] == "Bao cao/11" and up["share"] == "anyone" and up["conflict"] == "rename"
    inp, env = engine.called("py")[0][1], engine.called("py")[0][2]
    assert inp["cloud_link"] == "https://x/a.xlsx" and inp["cloud_count"] == 1
    assert env["cloud_link"] == "https://x/a.xlsx"          # {{cloud_link}} dùng được ở khối sau


def test_multiple_files_from_input_and_output_with_custom_names(engine, fake_cloud):
    engine.add_cloud_connection(provider="onedrive")
    (engine.input_dir / "a.xlsx").write_bytes(b"1")
    out = engine.wf_dir / "output"
    out.mkdir()
    (out / "b.pdf").write_bytes(b"2")
    status, _ = engine.run(graph(
        [("s", "start", {}),
         ("up", "cloud_upload", _block(cloudFiles=["a.xlsx", "b.pdf", "khong_co.txt"],
                                       cloudLinkVarName="links", cloudCountVarName="so_file")),
         ("py", "python", {"code": "x"})],
        [("s", "up"), ("up", "py")]))
    assert status == "success"
    assert [u["provider"] for u in fake_cloud["uploads"]] == ["onedrive", "onedrive"]
    inp = engine.called("py")[0][1]
    assert inp["links"] == "a.xlsx: https://x/a.xlsx\nb.pdf: https://x/b.pdf"
    assert inp["so_file"] == 2 and "cloud_link" not in inp
    assert any("khong_co.txt" in m for _, _, m, _ in engine.logs)


def test_path_traversal_in_file_name_is_stripped(engine, fake_cloud):
    engine.add_cloud_connection()
    (engine.input_dir / "pyflow.db").write_bytes(b"fake")
    engine.write_input_json({"f": "../../pyflow.db"})
    engine.run(graph([("s", "start", {}), ("up", "cloud_upload", _block(cloudFiles=["{{f}}"]))], [("s", "up")]))
    assert fake_cloud["uploads"][0]["path"].replace("\\", "/").endswith("/input/pyflow.db")


def test_missing_connection_is_error(engine, fake_cloud):
    status, err = engine.run(graph([("s", "start", {}), ("up", "cloud_upload", _block())], [("s", "up")]))
    assert status == "error" and "kết nối lưu trữ" in err
    assert fake_cloud["uploads"] == []


def test_revoked_login_goes_to_error_trigger(engine, fake_cloud):
    engine.add_cloud_connection(token="revoked")
    (engine.input_dir / "a.xlsx").write_bytes(b"1")
    status, err = engine.run(graph(
        [("s", "start", {}), ("up", "cloud_upload", _block()),
         ("et", "error_trigger", {}), ("h", "python", {"code": "x"})],
        [("s", "up"), ("et", "h")]))
    assert status == "error" and "đăng nhập lại" in err
    assert engine.called("h")[0][1]["failed_block"] == "up"


def test_rotated_refresh_token_is_saved(engine, fake_cloud):
    engine.add_cloud_connection(provider="onedrive", token="old")
    (engine.input_dir / "a.xlsx").write_bytes(b"1")
    fake_cloud["rotated"] = "new-token"
    engine.run(graph([("s", "start", {}), ("up", "cloud_upload", _block())], [("s", "up")]))
    with sqlite3.connect(engine.db_path) as c:
        assert c.execute("SELECT refresh_token FROM cloud_connection").fetchone()[0] == "new-token"


def test_stop_during_upload(engine, monkeypatch, fake_cloud):
    engine.add_cloud_connection()
    (engine.input_dir / "a.xlsx").write_bytes(b"1")

    def stopped(*a, **k):
        raise cs.CloudStopped()
    monkeypatch.setattr(cs, "upload_file", stopped)
    status, _ = engine.run(graph([("s", "start", {}), ("up", "cloud_upload", _block())], [("s", "up")]))
    assert status == "stopped"


# ── hàm thuần ────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,expected", [
    ("Bao cao/11", ["Bao cao", "11"]),
    ("../../etc\\x", ["etc", "x"]),
    ("/a//b/", ["a", "b"]),
    ('a:b*c?/"d"', ["a_b_c_", "_d_"]),
    ("", []),
])
def test_folder_segments(raw, expected):
    assert cs.folder_segments(raw) == expected


def test_numbered_name():
    assert cs.numbered_name("bao_cao.xlsx", 2) == "bao_cao (2).xlsx"
    assert cs.numbered_name("README", 1) == "README (1)"


def test_auth_url_has_state_pkce_and_narrow_scope(monkeypatch):
    monkeypatch.setattr(cloud_oauth_config, "GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(cloud_oauth_config, "GOOGLE_CLIENT_SECRET", "sec")
    url = cs.build_auth_url("google", "http://127.0.0.1:7000/cb", "wf1")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert q["scope"][0].startswith("https://www.googleapis.com/auth/drive.file")
    assert q["code_challenge_method"] == ["S256"] and q["state"][0]
    assert q["access_type"] == ["offline"]


def test_not_configured_provider_is_refused(monkeypatch):
    monkeypatch.setattr(cloud_oauth_config, "MICROSOFT_CLIENT_ID", "")
    with pytest.raises(cs.CloudError) as e:
        cs.build_auth_url("onedrive", "http://localhost:7000/cb", "wf1")
    assert e.value.code == "not_configured"


def test_callback_with_unknown_state_is_rejected():
    with pytest.raises(cs.CloudError) as e:
        cs.complete_oauth("google", "state-gia-mao", "code")
    assert e.value.code == "bad_state"
