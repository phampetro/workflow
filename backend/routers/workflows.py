import uuid
import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_session, AsyncSessionLocal
from models import Workflow, WorkflowRun, RunStatus, Project
from services.executor import execute_workflow
from ws.log_socket import make_log_callback

router = APIRouter(tags=["workflows"])
_stop_flags: dict = {}


# ── Workflows CRUD ──────────────────────────────────────────

@router.get("/api/projects/{project_id}/workflows")
async def list_workflows(project_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Workflow).where(Workflow.project_id == project_id).order_by(Workflow.created_at.desc())
    )
    return [w.to_dict() for w in result.scalars().all()]


@router.post("/api/projects/{project_id}/workflows", status_code=201)
async def create_workflow(project_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    wf = Workflow(
        id=str(uuid.uuid4()),
        name=body.get("name", "Untitled Workflow"),
        description=body.get("description"),
        project_id=project_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(wf)
    await session.commit()
    await session.refresh(wf)
    return wf.to_dict()


@router.get("/api/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
    return wf.to_dict()


@router.post("/api/workflows/{workflow_id}/duplicate", status_code=201)
async def duplicate_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
    
    new_wf = Workflow(
        id=str(uuid.uuid4()),
        name=wf.name + " (Copy)",
        description=wf.description,
        project_id=wf.project_id,
        graph_json=wf.graph_json,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(new_wf)
    await session.commit()
    await session.refresh(new_wf)
    return new_wf.to_dict()


@router.put("/api/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")

    for field in ["name", "description", "graph_json"]:
        if field in body:
            setattr(wf, field, body[field])
    wf.updated_at = datetime.utcnow()

    await session.commit()
    await session.refresh(wf)
    return wf.to_dict()


@router.delete("/api/workflows/{workflow_id}", status_code=204)
async def delete_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
    await session.delete(wf)
    await session.commit()


# ── Run Workflow ────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/run")
async def run_workflow(
    workflow_id: str,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
    if not wf.graph_json:
        raise HTTPException(400, "Workflow chưa có graph. Thêm blocks trước.")

    run = WorkflowRun(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        project_id=wf.project_id,
        status=RunStatus.RUNNING,
        triggered_by="manual",
        started_at=datetime.utcnow(),
    )
    session.add(run)
    await session.commit()

    stop_flag = asyncio.Event()
    _stop_flags[run.id] = stop_flag

    background_tasks.add_task(
        _run_workflow_bg,
        run_id=run.id,
        workflow_id=workflow_id,
        project_id=wf.project_id,
        graph_json=wf.graph_json,
        stop_flag=stop_flag,
    )

    return {"run_id": run.id, "status": "started"}


async def _run_workflow_bg(run_id, workflow_id, project_id, graph_json, stop_flag, triggered_by="manual"):
    log_cb = make_log_callback(run_id)
    async with AsyncSessionLocal() as session:
        try:
            result = await execute_workflow(
                project_id=project_id,
                workflow_id=workflow_id,
                run_id=run_id,
                graph_json=graph_json,
                log_callback=log_cb,
                stop_flag=stop_flag,
            )
            run = await session.get(WorkflowRun, run_id)
            if run:
                run.status = result["status"]
                run.finished_at = datetime.utcnow()
                run.duration_ms = result.get("total_duration_ms")
                if result["status"] == "error":
                    errs = [r for r in result.get("block_results", []) if not r.get("success")]
                    run.error_message = errs[-1]["error"] if errs else "Unknown"
                await session.commit()
        except Exception as e:
            run = await session.get(WorkflowRun, run_id)
            if run:
                run.status = RunStatus.ERROR
                run.finished_at = datetime.utcnow()
                run.error_message = str(e)
                await session.commit()
        finally:
            _stop_flags.pop(run_id, None)


@router.post("/api/workflows/{workflow_id}/stop")
async def stop_workflow(workflow_id: str):
    for flag in list(_stop_flags.values()):
        flag.set()
    return {"stopped": True}


# ── Run History ─────────────────────────────────────────────

@router.get("/api/workflows/{workflow_id}/runs")
async def get_run_history(workflow_id: str, limit: int = 20, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(WorkflowRun)
        .where(WorkflowRun.workflow_id == workflow_id)
        .order_by(WorkflowRun.started_at.desc())
        .limit(limit)
    )
    return [r.to_dict() for r in result.scalars().all()]


@router.get("/api/runs/{run_id}")
async def get_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await session.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(404, "Run không tồn tại")
    return run.to_dict()


# ── Scheduler trigger ────────────────────────────────────────

async def trigger_workflow_from_scheduler(workflow_id: str, project_id: str, triggered_by: str = "schedule"):
    async with AsyncSessionLocal() as session:
        wf = await session.get(Workflow, workflow_id)
        if not wf or not wf.graph_json:
            return

        run = WorkflowRun(
            id=str(uuid.uuid4()),
            workflow_id=workflow_id,
            project_id=project_id,
            status=RunStatus.RUNNING,
            triggered_by=triggered_by,
            started_at=datetime.utcnow(),
        )
        session.add(run)
        await session.commit()

        stop_flag = asyncio.Event()
        _stop_flags[run.id] = stop_flag
        await _run_workflow_bg(run.id, workflow_id, project_id, wf.graph_json, stop_flag, triggered_by)
