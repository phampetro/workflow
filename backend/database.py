import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine, text
from models import Base

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "pyflow.db")

DATABASE_URL = f"sqlite:///{DB_PATH}"
ASYNC_DATABASE_URL = f"sqlite+aiosqlite:///{DB_PATH}"

# Sync engine (dùng cho tạo bảng khi startup)
sync_engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

# Async engine (dùng cho API requests)
async_engine = create_async_engine(ASYNC_DATABASE_URL, echo=False)

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
