"""Mã hoá secret bằng DPAPI theo máy — services/secret_store.py."""
import sqlite3

from services import secret_store as ss


def test_roundtrip_and_prefix():
    enc = ss.encrypt("Mật khẩu@123")
    assert enc.startswith(ss.PREFIX) and "Mật khẩu" not in enc
    assert ss.decrypt(enc) == "Mật khẩu@123"


def test_empty_and_already_encrypted_are_unchanged():
    assert ss.encrypt("") == "" and ss.encrypt(None) is None
    enc = ss.encrypt("x")
    assert ss.encrypt(enc) == enc            # không mã hoá 2 lớp


def test_plaintext_legacy_value_passes_through():
    """DB bản cũ / file import chưa chuyển đổi vẫn đọc được."""
    assert ss.decrypt("matkhau_cu") == "matkhau_cu"


def test_undecryptable_blob_returns_empty_not_crash():
    """DB chép từ máy khác: coi như chưa có mật khẩu, không văng lỗi giữa lúc chạy."""
    assert ss.decrypt(ss.PREFIX + "QUJD") == ""


def test_migrate_encrypts_plaintext_once(tmp_path):
    with sqlite3.connect(tmp_path / "t.db") as c:
        c.execute("CREATE TABLE db_connection (id TEXT, password TEXT)")
        c.execute("CREATE TABLE cloud_connection (id TEXT, refresh_token TEXT)")
        c.executemany("INSERT INTO db_connection VALUES (?, ?)", [("a", "pw"), ("b", ""), ("c", None)])
        c.execute("INSERT INTO cloud_connection VALUES ('t', 'tok')")
        assert ss.migrate_plaintext_secrets(c) == 2
        assert ss.migrate_plaintext_secrets(c) == 0          # chạy lại không đụng gì
        rows = dict(c.execute("SELECT id, password FROM db_connection"))
        assert ss.decrypt(rows["a"]) == "pw" and rows["b"] == "" and rows["c"] is None
        assert ss.decrypt(c.execute("SELECT refresh_token FROM cloud_connection").fetchone()[0]) == "tok"


def test_orm_column_stores_encrypted(tmp_path):
    """Qua ORM: đọc ra chữ thường, trong file DB là blob DPAPI."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from models import Base, DbConnection

    eng = create_engine(f"sqlite:///{tmp_path / 'o.db'}")
    Base.metadata.create_all(eng, tables=[DbConnection.__table__])
    with Session(eng) as s:
        s.add(DbConnection(id="x", workflow_id="w", label="l", password="secret"))
        s.commit()
    with Session(eng) as s:
        assert s.get(DbConnection, "x").password == "secret"
    with sqlite3.connect(tmp_path / "o.db") as c:
        raw = c.execute("SELECT password FROM db_connection").fetchone()[0]
    assert ss.is_encrypted(raw) and "secret" not in raw
