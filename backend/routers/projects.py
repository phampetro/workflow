import uuid
import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from database import get_session
from models import Project, WorkflowRun
from services.venv_manager import create_venv, delete_venv, install_package, uninstall_package, list_packages

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Projects CRUD ──────────────────────────────────────────

@router.get("")
async def list_projects(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Project).order_by(Project.created_at.desc()))
    return [p.to_dict() for p in result.scalars().all()]


@router.post("", status_code=201)
async def create_project(body: dict, session: AsyncSession = Depends(get_session)):
    project = Project(
        id=str(uuid.uuid4()),
        name=body.get("name", "Untitled Project"),
        description=body.get("description"),
        color=body.get("color", "#6c63ff"),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)

    # Tạo venv trong background
    asyncio.create_task(_init_venv_bg(project.id))

    return project.to_dict()


async def _init_venv_bg(project_id: str):
    """Background task: tạo venv và update DB"""
    try:
        result = await create_venv(project_id)
        async with __import__("database").AsyncSessionLocal() as session:
            proj = await session.get(Project, project_id)
            if proj:
                proj.venv_ready = True
                proj.venv_path = result["path"]
                proj.updated_at = datetime.utcnow()
                await session.commit()
    except Exception as e:
        import logging
        logging.getLogger("pyflow").error(f"Lỗi tạo venv cho {project_id}: {e}")


@router.get("/{project_id}")
async def get_project(project_id: str, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")
    return proj.to_dict()


@router.put("/{project_id}")
async def update_project(project_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    for field in ["name", "description", "color"]:
        if field in body:
            setattr(proj, field, body[field])
    proj.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(proj)
    return proj.to_dict()


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    delete_venv(project_id)
    await session.delete(proj)
    await session.commit()


# ── Package Management ──────────────────────────────────────

@router.get("/{project_id}/packages")
async def get_packages(project_id: str):
    return await list_packages(project_id)


@router.post("/{project_id}/packages/install")
async def pkg_install(project_id: str, body: dict):
    package = body.get("package", "").strip()
    if not package:
        raise HTTPException(400, "Thiếu tên package")
    try:
        return await install_package(project_id, package)
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/{project_id}/packages/uninstall")
async def pkg_uninstall(project_id: str, body: dict):
    package = body.get("package", "").strip()
    if not package:
        raise HTTPException(400, "Thiếu tên package")
    try:
        return await uninstall_package(project_id, package)
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/{project_id}/venv/init")
async def init_venv_manual(project_id: str, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")
    try:
        r = await create_venv(project_id)
        proj.venv_ready = True
        proj.venv_path = r["path"]
        proj.updated_at = datetime.utcnow()
        await session.commit()
        return {"status": "ok", "path": r["path"]}
    except Exception as e:
        raise HTTPException(500, str(e))
