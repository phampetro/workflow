import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import create_engine
from models import Base

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "pyflow.db")

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


def create_db_and_tables():
    """Tạo tất cả bảng khi khởi động"""
    Base.metadata.create_all(sync_engine)


async def get_session():
    """Dependency injection cho FastAPI routes"""
    async with AsyncSessionLocal() as session:
        yield session
