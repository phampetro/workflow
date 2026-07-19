"""
Database models dùng SQLAlchemy thuần (không cần pydantic/SQLModel)
để tương thích với Python 3.14
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, Integer
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "user"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.now)
    is_active = Column(Boolean, default=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "is_active": self.is_active,
        }


class Project(Base):
    __tablename__ = "project"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False, index=True)
    description = Column(Text, nullable=True)
    color = Column(String, default="#6c63ff")
    icon = Column(String, default="Box")
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    venv_ready = Column(Boolean, default=False)
    venv_path = Column(String, nullable=True)
    user_id = Column(String, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "color": self.color,
            "icon": self.icon,
            "sort_order": self.sort_order,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "venv_ready": self.venv_ready,
            "venv_path": self.venv_path,
            "user_id": self.user_id,
        }


class Workflow(Base):
    __tablename__ = "workflow"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    project_id = Column(String, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    graph_json = Column(Text, nullable=True)  # JSON nodes + edges
    color = Column(String, default="#6c63ff")
    sort_order = Column(Integer, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "project_id": self.project_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "graph_json": self.graph_json,
            "color": self.color,
            "sort_order": self.sort_order,
        }


class Schedule(Base):
    __tablename__ = "schedule"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String, nullable=False, index=True)
    cron_expr = Column(String, nullable=False)
    label = Column(String, nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.now)
    next_run_at = Column(DateTime, nullable=True)
    last_run_at = Column(DateTime, nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "workflow_id": self.workflow_id,
            "cron_expr": self.cron_expr,
            "label": self.label,
            "enabled": self.enabled,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "next_run_at": self.next_run_at.isoformat() if self.next_run_at else None,
            "last_run_at": self.last_run_at.isoformat() if self.last_run_at else None,
        }


class WorkflowRun(Base):
    __tablename__ = "workflow_run"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_id = Column(String, nullable=False, index=True)
    project_id = Column(String, nullable=False)
    status = Column(String, default="pending")   # pending|running|success|error|stopped
    started_at = Column(DateTime, default=datetime.now)
    finished_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    triggered_by = Column(String, default="manual")
    error_message = Column(Text, nullable=True)
    logs_json = Column(Text, default="[]")

    def to_dict(self):
        return {
            "id": self.id,
            "workflow_id": self.workflow_id,
            "project_id": self.project_id,
            "status": self.status,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "finished_at": self.finished_at.isoformat() if self.finished_at else None,
            "duration_ms": self.duration_ms,
            "triggered_by": self.triggered_by,
            "error_message": self.error_message,
        }


class Setting(Base):
    __tablename__ = "setting"

    key = Column(String, primary_key=True)
    value = Column(Text, nullable=True)

    def to_dict(self):
        return {"key": self.key, "value": self.value}


class DbConnection(Base):
    __tablename__ = "db_connection"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String, nullable=False, index=True)
    label = Column(String, nullable=False)
    db_type = Column(String, default="sqlserver")
    host = Column(String, default="")
    port = Column(String, default="")
    username = Column(String, default="")
    password = Column(String, default="")
    dbname = Column(String, default="")
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    def to_dict(self):
        return {
            "id": self.id,
            "project_id": self.project_id,
            "label": self.label,
            "db_type": self.db_type,
            "host": self.host,
            "port": self.port,
            "username": self.username,
            "password": self.password,
            "dbname": self.dbname,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class RunStatus:
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    STOPPED = "stopped"
