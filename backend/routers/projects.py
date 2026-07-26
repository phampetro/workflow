import uuid
import asyncio
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from database import get_session
from models import Project, Workflow, WorkflowRun
from services.venv_manager import create_venv, delete_venv, install_package, uninstall_package, list_packages, delete_project_dir, rename_project_dir, slugify

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


# Các project đang tạo venv (kể cả tạo ngầm lúc create/import) — để FE hiện trạng
# thái "đang tạo" và chặn tạo trùng khi user bấm nút nhiều lần.
_venv_creating = set()


async def _init_venv_bg(project_id: str):
    """Background task: tạo venv và update DB"""
    if project_id in _venv_creating:
        return
    _venv_creating.add(project_id)
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
    finally:
        _venv_creating.discard(project_id)


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
    result["venv_creating"] = project_id in _venv_creating
    return result


@router.put("/{project_id}")
async def update_project(project_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    old_name = proj.name
    new_name = body.get("name", proj.name).strip() if "name" in body else proj.name

    if "name" in body:
        new_slug = slugify(new_name)
        same_user_projects = (await session.execute(
            select(Project).where(Project.user_id == proj.user_id, Project.id != project_id)
        )).scalars().all()
        if any(slugify(p.name) == new_slug for p in same_user_projects):
            raise HTTPException(400, f"Project '{new_name}' đã tồn tại")

    # Rename thư mục trên đĩa TRƯỚC khi commit DB - nếu rename fail (folder đích đã tồn tại,
    # permission,...) thì báo lỗi ngay; nếu commit DB fail sau đó thì đổi lại tên folder về cũ.
    renamed = False
    if "name" in body and slugify(new_name) != slugify(old_name):
        try:
            renamed = rename_project_dir(old_name, new_name)
        except Exception as e:
            raise HTTPException(400, f"Không đổi tên thư mục project được: {e}")

    for field in ["name", "description", "color", "icon"]:
        if field in body:
            setattr(proj, field, body[field])
    proj.updated_at = datetime.now()
    if renamed and proj.venv_path:
        from services.venv_manager import DATA_DIR
        proj.venv_path = str(DATA_DIR / f"pj_{slugify(new_name)}" / ".venv")

    try:
        await session.commit()
    except Exception:
        if renamed:
            try:
                rename_project_dir(new_name, old_name)
            except Exception:
                pass
        raise
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
    from routers.workflows import _cascade_delete_workflow_children, _stop_and_wait_workflow_runs
    workflows = (await session.execute(
        select(Workflow).where(Workflow.project_id == project_id)
    )).scalars().all()

    # Dừng mọi run + listener của các workflow con trước khi xoá DB/folder
    for wf in workflows:
        await _stop_and_wait_workflow_runs(wf.id)

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
    # Đã sẵn sàng hoặc đang tạo ngầm (từ create/import) → không tạo trùng
    if proj.venv_ready:
        return {"status": "ready"}
    if project_id in _venv_creating:
        return {"status": "creating"}
    _venv_creating.add(project_id)
    try:
        r = await create_venv(project_id)
        proj.venv_ready = True
        proj.venv_path = r["path"]
        proj.updated_at = datetime.now()
        await session.commit()
        return {"status": "ok", "path": r["path"]}
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        _venv_creating.discard(project_id)


# ── Auto cài thư viện: quét mọi workflow/khối → gom package → cài, stream log ──
_pkg_jobs = {}  # project_id -> {status, log, current, total, done, error}


def _install_worker(project_id: str, packages: list):
    import subprocess, sqlite3, time
    from services.executor_blocks import create_venv_sync
    from services.venv_manager import venv_exists, get_pip_path, DATA_DIR
    j = _pkg_jobs[project_id]
    try:
        # Nếu venv đang được tạo ngầm (create/import) → đợi xong, tránh tạo trùng gây hỏng
        waited = 0
        while project_id in _venv_creating and waited < 180:
            if waited == 0:
                j["log"].append("⏳ Đợi tạo môi trường xong...")
            time.sleep(1)
            waited += 1
        if not venv_exists(project_id):
            j["log"].append("🔧 Đang tạo môi trường (venv)...")
            create_venv_sync(project_id)
            # đánh dấu venv_ready để UI khác đồng bộ
            try:
                with sqlite3.connect(str(DATA_DIR / "pyflow.db"), timeout=5) as conn:
                    conn.execute("UPDATE project SET venv_ready=1 WHERE id=?", (project_id,))
                    conn.commit()
            except Exception:
                pass
        pip = get_pip_path(project_id)
        for i, pkg in enumerate(packages):
            j["current"] = pkg
            j["log"].append(f"📦 Đang cài {pkg}...")
            proc = subprocess.Popen(
                [pip, "install", pkg],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    j["log"].append("   " + line)
            proc.wait()
            if proc.returncode != 0:
                j["log"].append(f"❌ Lỗi cài {pkg}")
                j["error"] = f"Một số gói cài lỗi (vd: {pkg})"
            else:
                j["log"].append(f"✅ Đã cài {pkg}")
            j["done"] = i + 1
        j["current"] = ""
        j["status"] = "error" if j["error"] else "done"
        j["log"].append("⚠ Hoàn tất (có gói lỗi)." if j["error"] else "🎉 Hoàn tất — môi trường đã sẵn sàng.")
    except Exception as e:
        j["status"] = "error"
        j["error"] = str(e)
        j["log"].append(f"❌ {e}")


@router.post("/{project_id}/packages/scan")
async def scan_project_packages(project_id: str, session: AsyncSession = Depends(get_session)):
    """Quét mọi workflow của project → danh sách package dự kiến (kèm nguồn)."""
    import json as _json
    from models import Workflow
    wfs = (await session.execute(select(Workflow).where(Workflow.project_id == project_id))).scalars().all()
    graphs = []
    for w in wfs:
        if w.graph_json:
            try:
                graphs.append(_json.loads(w.graph_json))
            except Exception:
                pass
    from services.pkg_scanner import scan_packages
    items = scan_packages(graphs)

    # Đối chiếu với gói đã có trong venv → gắn cờ installed (để FE chỉ chọn cái thiếu)
    from services.executor_blocks import list_pkgs_sync
    def _norm(x):
        return str(x).strip().lower().replace("_", "-")
    installed = {_norm(p["name"]) for p in list_pkgs_sync(project_id)}
    for it in items:
        it["installed"] = _norm(it["package"]) in installed

    return {"packages": items, "missing_count": sum(1 for it in items if not it["installed"])}


@router.post("/{project_id}/packages/auto-install")
async def auto_install_packages(project_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    """Cài danh sách package (người dùng đã xem/sửa) vào project venv, chạy nền + stream log."""
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")
    j = _pkg_jobs.get(project_id)
    if j and j["status"] == "running":
        return {"status": "running"}
    packages = [str(p).strip() for p in (body.get("packages") or []) if str(p).strip()]
    if not packages:
        raise HTTPException(400, "Danh sách package trống")
    import threading
    _pkg_jobs[project_id] = {"status": "running", "log": [], "current": "", "total": len(packages), "done": 0, "error": None}
    threading.Thread(target=_install_worker, args=(project_id, packages), daemon=True).start()
    return {"status": "started", "total": len(packages)}


@router.get("/{project_id}/packages/install-status")
async def auto_install_status(project_id: str):
    """FE poll: trạng thái + log (300 dòng cuối) + tiến độ."""
    j = _pkg_jobs.get(project_id)
    if not j:
        return {"status": "idle"}
    return {
        "status": j["status"], "current": j["current"],
        "total": j["total"], "done": j["done"], "error": j["error"],
        "log": j["log"][-300:],
    }


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
