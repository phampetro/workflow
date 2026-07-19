import uuid
import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from database import get_session
from models import Project, Workflow, WorkflowRun
from services.venv_manager import create_venv, delete_venv, install_package, uninstall_package, list_packages, delete_project_dir, slugify

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Projects CRUD ──────────────────────────────────────────

@router.get("")
async def list_projects(request: Request, session: AsyncSession = Depends(get_session)):
    user_id = request.headers.get("X-User-Id")
    if user_id:
        result = await session.execute(select(Project).where(Project.user_id == user_id).order_by(Project.sort_order.asc(), Project.created_at.desc()))
    else:
        result = await session.execute(select(Project).order_by(Project.sort_order.asc(), Project.created_at.desc()))
    projects = result.scalars().all()

    # Lấy run gần nhất của mỗi project (1 query duy nhất)
    from sqlalchemy import func
    last_status_map = {}
    if projects:
        project_ids = [p.id for p in projects]
        last_runs_q = (
            select(
                WorkflowRun.project_id,
                WorkflowRun.status,
                func.row_number().over(
                    partition_by=WorkflowRun.project_id,
                    order_by=WorkflowRun.started_at.desc()
                ).label("rn"),
            )
            .where(WorkflowRun.project_id.in_(project_ids))
            .subquery()
        )
        rows = (await session.execute(
            select(last_runs_q.c.project_id, last_runs_q.c.status)
            .where(last_runs_q.c.rn == 1)
        )).all()
        last_status_map = {r[0]: r[1] for r in rows}

    out = []
    # Lấy map workflow_id -> project_id (1 query)
    wf_project_map = {}
    if projects:
        wf_rows = (await session.execute(
            select(Workflow.id, Workflow.project_id).where(Workflow.project_id.in_(project_ids))
        )).all()
        wf_project_map = {wf_id: pid for wf_id, pid in wf_rows}

    from routers.workflows import _workflow_run_ids
    for p in projects:
        d = p.to_dict()
        d["last_run_status"] = last_status_map.get(p.id)
        # Đếm tổng số workflow của project này
        d["workflow_count"] = sum(1 for pid in wf_project_map.values() if pid == p.id)
        # Đếm workflow đang chạy của project này
        running_count = sum(
            1 for wf_id, pid in wf_project_map.items()
            if pid == p.id and wf_id in _workflow_run_ids and _workflow_run_ids[wf_id]
        )
        d["running_count"] = running_count
        out.append(d)
    return out


@router.post("", status_code=201)
async def create_project(request: Request, body: dict, session: AsyncSession = Depends(get_session)):
    user_id = request.headers.get("X-User-Id", "default")
    name = body.get("name", "Untitled Project").strip()

    # So sánh theo slug (không phải chuỗi thô) vì tên project quyết định luôn tên
    # thư mục dữ liệu (data/pj_{slug}/) - hai tên khác nhau nhưng cùng slug sẽ
    # vô tình dùng chung 1 thư mục, gây lẫn dữ liệu.
    new_slug = slugify(name)
    same_user_projects = (await session.execute(
        select(Project).where(Project.user_id == user_id)
    )).scalars().all()
    if any(slugify(p.name) == new_slug for p in same_user_projects):
        raise HTTPException(400, f"Project '{name}' đã tồn tại")

    project = Project(
        id=str(uuid.uuid4()),
        name=name,
        description=body.get("description"),
        icon=body.get("icon", "Box"),
        color=body.get("color", "#6c63ff"),
        user_id=user_id,
        created_at=datetime.now(),
        updated_at=datetime.now(),
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
        from database import AsyncSessionLocal
        result = await create_venv(project_id)
        async with AsyncSessionLocal() as session:
            proj = await session.get(Project, project_id)
            if proj:
                proj.venv_ready = True
                proj.venv_path = result["path"]
                proj.updated_at = datetime.now()
                await session.commit()
    except Exception as e:
        import logging
        logging.getLogger("pyflow").error(f"Lỗi tạo venv cho {project_id}: {e}")


@router.get("/{project_id}")
async def get_project(project_id: str, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    # Đếm workflows
    from models import Workflow
    stmt = select(Workflow).where(Workflow.project_id == project_id)
    workflows = (await session.execute(stmt)).scalars().all()

    result = proj.to_dict()
    result["workflows_count"] = len(workflows)
    return result


@router.put("/{project_id}")
async def update_project(project_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    if "name" in body:
        new_name = body["name"].strip()
        new_slug = slugify(new_name)
        same_user_projects = (await session.execute(
            select(Project).where(Project.user_id == proj.user_id, Project.id != project_id)
        )).scalars().all()
        if any(slugify(p.name) == new_slug for p in same_user_projects):
            raise HTTPException(400, f"Project '{new_name}' đã tồn tại")

    for field in ["name", "description", "color", "icon"]:
        if field in body:
            setattr(proj, field, body[field])
    proj.updated_at = datetime.now()

    await session.commit()
    await session.refresh(proj)
    return proj.to_dict()


@router.put("/reorder/items")
async def reorder_projects(request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    user_id = request.headers.get("X-User-Id")
    for item in body:
        pid = item.get("id")
        so = item.get("sort_order", 0)
        if pid:
            p = await session.get(Project, pid)
            if p:
                if user_id and p.user_id != user_id:
                    continue
                p.sort_order = so
    await session.commit()
    return {"status": "ok"}



@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    pj_name = proj.name

    # Cascade: xóa toàn bộ workflow con kèm run history + schedule (và job APScheduler)
    from routers.workflows import _cascade_delete_workflow_children
    workflows = (await session.execute(
        select(Workflow).where(Workflow.project_id == project_id)
    )).scalars().all()
    for wf in workflows:
        await _cascade_delete_workflow_children(session, wf.id)
        await session.delete(wf)

    await session.delete(proj)
    await session.commit()
    delete_project_dir(project_id, pj_name=pj_name)


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
        proj.updated_at = datetime.now()
        await session.commit()
        return {"status": "ok", "path": r["path"]}
    except Exception as e:
        raise HTTPException(500, str(e))

from fastapi.responses import StreamingResponse

@router.get("/{project_id}/export")
async def export_project(project_id: str, session: AsyncSession = Depends(get_session)):
    from services.export_import import export_project_to_zip
    try:
        memory_file = await export_project_to_zip(project_id, session)
        memory_file.seek(0)
        
        headers = {
            'Content-Disposition': f'attachment; filename="project_{project_id}.zip"'
        }
        return StreamingResponse(memory_file, media_type="application/zip", headers=headers)
    except Exception as e:
        raise HTTPException(500, str(e))

@router.post("/import")
async def import_project(request: Request, session: AsyncSession = Depends(get_session)):
    form = await request.form()
    file = form.get("file")
    if not file:
        raise HTTPException(400, "Không có file upload")
        
    user_id = request.headers.get("X-User-Id", "default")
    zip_data = await file.read()
    
    from services.export_import import import_project_from_zip
    try:
        new_proj = await import_project_from_zip(zip_data, user_id, session)
        # Tạo venv trong nền, giống hệt lúc tạo project mới thủ công
        asyncio.create_task(_init_venv_bg(new_proj["id"]))
        return new_proj
    except Exception as e:
        raise HTTPException(400, f"Lỗi import: {str(e)}")
