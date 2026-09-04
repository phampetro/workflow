import os
import sqlite3
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine, event, text
from models import Base

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "pyflow.db")

DATABASE_URL = f"sqlite:///{DB_PATH}"
ASYNC_DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

# Chờ tối đa 15s khi file DB đang bị kết nối khác giữ, thay vì ném
# "database is locked" ngay sau 5s mặc định.
SQLITE_BUSY_TIMEOUT_MS = 15000

# Sync engine (dùng cho tạo bảng khi startup)
sync_engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# Async engine (dùng cho API requests)
async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False)


def apply_sqlite_pragmas(dbapi_conn) -> None:
    """Bật WAL + busy_timeout cho MỘT kết nối sqlite bất kỳ.

    App ghi vào cùng 1 file DB qua 2 kênh song song: SQLAlchemy async (API) và
    `sqlite3` sync trong thread executor (_finish_run, _set_workflow_listener_flag).
    README từ lâu khẳng định "WAL mode giúp không lock", nhưng thực tế KHÔNG có
    dòng journal_mode nào trong toàn bộ backend — DB vẫn ở journal_mode=delete,
    nơi một transaction ghi khoá toàn bộ file và mọi kết nối khác chỉ chờ được 5s.

    Hậu quả đã thấy: _finish_run ghi trạng thái run trong lúc API ghi logs_json
    → "database is locked" ném ra ngoài execute_workflow_thread → run kẹt RUNNING
    vĩnh viễn cho tới lần restart backend kế tiếp.

    WAL được ghi vào header của file DB nên chỉ cần đặt một lần là bền vững;
    busy_timeout thì theo từng kết nối nên phải đặt lại mỗi lần connect.
    """
    cur = dbapi_conn.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
        # NORMAL: an toàn với WAL (chỉ mất giao dịch cuối khi mất điện đột ngột),
        # đổi lại không fsync mỗi lần commit — quan trọng vì executor ghi log dày.
        cur.execute("PRAGMA synchronous=NORMAL")
    finally:
        cur.close()


@event.listens_for(sync_engine, "connect")
def _sync_engine_on_connect(dbapi_conn, _record):
    apply_sqlite_pragmas(dbapi_conn)


@event.listens_for(async_engine.sync_engine, "connect")
def _async_engine_on_connect(dbapi_conn, _record):
    apply_sqlite_pragmas(dbapi_conn)


def connect_sqlite(**kwargs) -> sqlite3.Connection:
    """`sqlite3.connect` tới DB chính, ĐÃ áp sẵn WAL + busy_timeout.

    Mọi chỗ trong executor thread phải dùng hàm này thay cho sqlite3.connect trần,
    nếu không kết nối đó vẫn giữ busy_timeout mặc định 5s và là mắt xích làm hỏng
    cả chuỗi (xem giải thích ở apply_sqlite_pragmas).
    """
    kwargs.setdefault("timeout", SQLITE_BUSY_TIMEOUT_MS / 1000)
    conn = sqlite3.connect(DB_PATH, **kwargs)
    apply_sqlite_pragmas(conn)
    return conn

AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


def _get_sqlite_columns(conn, table_name: str) -> set[str]:
    result = conn.execute(text(f"PRAGMA table_info({table_name})"))
    return {row[1] for row in result.fetchall()}


def _sqlite_apply_schema_updates(conn):
    if conn.engine.dialect.name != "sqlite":
        return

    schema_updates = {
        "project": {
            "icon": ("TEXT", "'Box'"),
            "sort_order": ("INTEGER", "0"),
            "venv_ready": ("INTEGER", "0"),
            "venv_path": ("TEXT", "NULL"),
            "user_id": ("TEXT", "NULL"),
        },
        "workflow": {
            "graph_json": ("TEXT", "NULL"),
            "color": ("TEXT", "'#6c63ff'"),
            "sort_order": ("INTEGER", "0"),
            "listener_on": ("INTEGER", "0"),
        },
        "workflow_run": {
            "logs_json": ("TEXT", "'[]'"),
        },
    }

    for table_name, columns in schema_updates.items():
        try:
            existing = _get_sqlite_columns(conn, table_name)
        except Exception:
            continue

        for col_name, (col_type, default) in columns.items():
            if col_name not in existing:
                sql = f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}"
                if default is not None:
                    sql += f" DEFAULT {default}"
                conn.execute(text(sql))

    # Đổi scope cấu hình Database từ theo project sang theo workflow (để export/import
    # workflow mang theo được kết nối) - đổi tên cột thay vì thêm mới.
    try:
        db_conn_columns = _get_sqlite_columns(conn, "db_connection")
        if "project_id" in db_conn_columns and "workflow_id" not in db_conn_columns:
            conn.execute(text("ALTER TABLE db_connection RENAME COLUMN project_id TO workflow_id"))
    except Exception:
        pass


def create_db_and_tables():
    """Tạo tất cả bảng khi khởi động"""
    Base.metadata.create_all(sync_engine)
    with sync_engine.begin() as conn:
        _sqlite_apply_schema_updates(conn)


async def get_session():
    """Dependency injection cho FastAPI routes"""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    from models import Base
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_sqlite_apply_schema_updates)
