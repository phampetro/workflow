"""Bảo trì định kỳ pyflow.db: dọn log chạy cũ + backup hằng ngày.

- Log: workflow_run.logs_json (vài chục KB mỗi lần chạy) chưa từng được dọn — đo trên
  máy dev 11/2026: 17MB / 22MB của DB là log, 371 lần chạy. Workflow chạy theo lịch
  mỗi ngày làm DB phình mãi. Run cũ hơn LOG_RETENTION_DAYS (và không nằm trong
  KEEP_RECENT_PER_WORKFLOW lần gần nhất của workflow đó) được thay log bằng MỘT dòng
  thông báo. GIỮ dòng run (trạng thái, thời gian) để thống kê dashboard không đổi.
- Backup: trước đây DB hỏng là mất hết. Mỗi ngày 1 bản qua SQLite backup API (an toàn
  khi đang ghi, WAL) vào data/backups/, giữ BACKUP_KEEP bản gần nhất. Secret trong DB
  đã mã hoá DPAPI nên bản backup không lộ mật khẩu chữ thường.
"""
import asyncio
import json
import logging
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger("pyflow.maintenance")

LOG_RETENTION_DAYS = 30
KEEP_RECENT_PER_WORKFLOW = 20
BACKUP_KEEP = 7
VACUUM_MIN_FREE_MB = 5
INTERVAL_SEC = 24 * 3600

PRUNED_MESSAGE = (f"🧹 Log chi tiết đã được dọn tự động (cũ hơn {LOG_RETENTION_DAYS} ngày) / "
                  f"Detailed log was cleaned up automatically (older than {LOG_RETENTION_DAYS} days)")


def prune_run_logs(conn, now=None) -> int:
    """Thay log của run cũ bằng 1 dòng thông báo. Trả số run đã dọn."""
    cutoff = ((now or datetime.now()) - timedelta(days=LOG_RETENTION_DAYS)).isoformat(sep=" ")
    rows = conn.execute(
        """
        SELECT id, finished_at FROM workflow_run
        WHERE started_at < ? AND logs_json IS NOT NULL AND logs_json NOT LIKE ?
          AND id NOT IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY workflow_id ORDER BY started_at DESC) AS rn
              FROM workflow_run)
            WHERE rn <= ?)
        """,
        (cutoff, '%"pruned": true%', KEEP_RECENT_PER_WORKFLOW),
    ).fetchall()
    for run_id, finished_at in rows:
        note = [{"run_id": run_id, "block_id": None, "level": "info", "message": PRUNED_MESSAGE,
                 "time": str(finished_at or ""), "pruned": True}]
        conn.execute("UPDATE workflow_run SET logs_json=? WHERE id=?",
                     (json.dumps(note, ensure_ascii=False), run_id))
    conn.commit()
    return len(rows)


def vacuum_if_worth(conn) -> bool:
    """VACUUM khi trang trống đủ lớn. Bận (đang có run ghi) thì để lần sau."""
    page_size = conn.execute("PRAGMA page_size").fetchone()[0]
    free = conn.execute("PRAGMA freelist_count").fetchone()[0] * page_size
    if free < VACUUM_MIN_FREE_MB * 1024 * 1024:
        return False
    try:
        conn.execute("VACUUM")
        return True
    except sqlite3.OperationalError as e:
        logger.info("Chưa VACUUM được (DB đang bận): %s", e)
        return False


def backup_db(conn, backup_dir: Path, today=None) -> Path | None:
    """1 bản/ngày: pyflow-YYYYMMDD.db. Đã có bản hôm nay thì bỏ qua. Giữ BACKUP_KEEP bản.

    `VACUUM INTO` chép một ảnh nhất quán của DB ngay trên kết nối đang có (đọc theo
    snapshot, không chặn run đang ghi ở chế độ WAL) — không cần mở kết nối thứ hai.
    """
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"pyflow-{(today or datetime.now()).strftime('%Y%m%d')}.db"
    made = None
    if not target.exists():
        tmp = target.with_suffix(".db.tmp")
        tmp.unlink(missing_ok=True)
        conn.execute("VACUUM INTO ?", (str(tmp),))
        tmp.replace(target)                  # chỉ thành tên thật khi đã chép xong
        made = target
    for old in sorted(backup_dir.glob("pyflow-*.db"))[:-BACKUP_KEEP]:
        old.unlink(missing_ok=True)
    return made


def run_maintenance() -> dict:
    from database import connect_sqlite
    from services.venv_manager import DATA_DIR
    db_path = DATA_DIR / "pyflow.db"
    result = {"pruned": 0, "vacuumed": False, "backup": None}
    if not db_path.exists():
        return result
    with connect_sqlite() as conn:
        try:
            result["backup"] = str(backup_db(conn, DATA_DIR / "backups") or "")
        except Exception as e:
            logger.warning("Backup DB thất bại: %s", e)
        result["pruned"] = prune_run_logs(conn)
        result["vacuumed"] = vacuum_if_worth(conn)
    logger.info("Bảo trì DB: %s", result)
    return result


async def maintenance_loop():
    """Chạy lúc khởi động rồi mỗi 24h. Lỗi không làm chết vòng lặp."""
    while True:
        try:
            await asyncio.to_thread(run_maintenance)
        except Exception as e:
            logger.warning("Bảo trì DB lỗi: %s", e)
        await asyncio.sleep(INTERVAL_SEC)
