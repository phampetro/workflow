"""SSL context dùng chung và hàng rào SSRF của khối Google Sheets."""
import ssl

from conftest import graph
from services.net import https_context


def test_https_context_verifies_and_trusts_certifi():
    import certifi
    ctx = https_context()
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname
    # certifi có ~140 root; Windows store cộng thêm → luôn nhiều hơn ngưỡng này
    assert ctx.cert_store_stats()["x509_ca"] >= 100
    assert certifi.where()


def test_google_sheets_rejects_non_google_host(engine, monkeypatch):
    import urllib.request
    called = []
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: called.append(a) or (_ for _ in ()).throw(AssertionError("không được gọi mạng")))
    engine.write_input_json({"u": "http://169.254.169.254/spreadsheets/d/e/abc/pubhtml"})
    status, err = engine.run(graph(
        [("s", "start", {}), ("g", "google_sheets_read", {"googleSheetsUrl": "{{u}}"})],
        [("s", "g")],
    ))
    assert status == "error" and "docs.google.com" in err
    assert called == []
