import uuid
import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from database import get_session, AsyncSessionLocal
from models import Workflow, WorkflowRun, RunStatus, Project
from services.executor import execute_workflow
from services.venv_manager import delete_workflow_dir, slugify
from ws.log_socket import make_log_callback

router = APIRouter(tags=["workflows"])
_stop_flags: dict = {}
_workflow_run_ids: dict = {}


async def run_workflow_internal(workflow_id: str, initial_input: dict = None, triggered_by: str = "manual", run_id: str = None):
    async with AsyncSessionLocal() as session:
        wf = await session.get(Workflow, workflow_id)
        if not wf:
            return None
            
        if not run_id:
            run_id = str(uuid.uuid4())
        _workflow_run_ids.setdefault(workflow_id, set()).add(run_id)
        
        run = WorkflowRun(
            id=run_id,
            workflow_id=workflow_id,
            project_id=wf.project_id,
            status=RunStatus.RUNNING,
            started_at=datetime.now(),
            triggered_by=triggered_by
        )
        session.add(run)
        await session.commit()
        
        stop_flag = asyncio.Event()
        _stop_flags[run_id] = stop_flag
        
        log_callback = make_log_callback(run_id)
        
        # We need to inject initial_input into the graph if provided
        graph_json = wf.graph_json
        if initial_input and graph_json:
            import json
            try:
                graph = json.loads(graph_json)
                for node in graph.get("nodes", []):
                    if node.get("data", {}).get("type") == "telegram_listener":
                        node["data"]["_initial_input"] = initial_input
                graph_json = json.dumps(graph)
            except Exception:
                pass
        
        try:
            await execute_workflow(
                project_id=wf.project_id,
                workflow_id=wf.id,
                run_id=run_id,
                workflow_name=wf.name,
                graph_json=graph_json,
                log_callback=log_callback,
                stop_flag=stop_flag
            )
            # The run status is already updated inside execute_workflow_thread by _finish_run
        except Exception as e:
            run = await session.get(WorkflowRun, run_id)
            if run:
                run.status = RunStatus.ERROR
                run.error_message = str(e)
                run.finished_at = datetime.now()
        finally:
            from ws.log_socket import get_run_history, cleanup_log
            history = get_run_history(run_id)
            logs_json_str = "[" + ",".join(history) + "]" if history else "[]"
            
            run = await session.get(WorkflowRun, run_id)
            if run:
                run.logs_json = logs_json_str
            await session.commit()
            
            cleanup_log(run_id)
            
            _stop_flags.pop(run_id, None)
            if workflow_id in _workflow_run_ids:
                _workflow_run_ids[workflow_id].discard(run_id)


# ── Workflows CRUD ──────────────────────────────────────────

@router.get("/api/projects/{project_id}/workflows")
async def list_workflows(project_id: str, session: AsyncSession = Depends(get_session)):
    from sqlalchemy import func
    result = await session.execute(
        select(Workflow).where(Workflow.project_id == project_id).order_by(Workflow.sort_order.asc(), Workflow.created_at.desc())
    )
    workflows = result.scalars().all()

    # Lấy run gần nhất của mỗi workflow (1 query)
    last_status_map = {}
    if workflows:
        wf_ids = [w.id for w in workflows]
        last_runs_q = (
            select(
                WorkflowRun.workflow_id,
                WorkflowRun.status,
                func.row_number().over(
                    partition_by=WorkflowRun.workflow_id,
                    order_by=WorkflowRun.started_at.desc()
                ).label("rn"),
            )
            .where(WorkflowRun.workflow_id.in_(wf_ids))
            .subquery()
        )
        rows = (await session.execute(
            select(last_runs_q.c.workflow_id, last_runs_q.c.status)
            .where(last_runs_q.c.rn == 1)
        )).all()
        last_status_map = {r[0]: r[1] for r in rows}

    out = []
    for w in workflows:
        d = w.to_dict()
        d["last_run_status"] = last_status_map.get(w.id)
        # Đánh dấu wf đang chạy
        if w.id in _workflow_run_ids and _workflow_run_ids[w.id]:
            d["is_running"] = True
            # Lấy run_id từ set (chỉ lấy 1 vì giao diện chỉ hiện 1)
            d["running_run_id"] = next(iter(_workflow_run_ids[w.id]))
        else:
            d["is_running"] = False
            d["running_run_id"] = None
        out.append(d)
    return out


@router.put("/api/projects/{project_id}/workflows/reorder")
async def reorder_workflows(project_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    body = await request.json()
    for item in body:
        wid = item.get("id")
        so = item.get("sort_order", 0)
        if wid:
            wf = await session.get(Workflow, wid)
            if wf and wf.project_id == project_id:
                wf.sort_order = so
    await session.commit()
    return {"status": "ok"}


@router.post("/api/projects/{project_id}/workflows/import")
async def import_workflow(project_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    form = await request.form()
    file = form.get("file")
    if not file:
        raise HTTPException(400, "Không có file upload")
    
    zip_data = await file.read()
    from services.export_import import import_workflow_from_zip
    try:
        new_wf = await import_workflow_from_zip(zip_data, project_id, session)
        return new_wf
    except Exception as e:
        raise HTTPException(400, f"Lỗi import: {str(e)}")


@router.post("/api/projects/{project_id}/workflows", status_code=201)
async def create_workflow(project_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    proj = await session.get(Project, project_id)
    if not proj:
        raise HTTPException(404, "Project không tồn tại")

    name = body.get("name", "Untitled Workflow").strip()

    # So sánh theo slug vì tên workflow quyết định tên thư mục con
    # (data/pj_{slug}/wf_{slug}/) trong cùng project.
    new_slug = slugify(name)
    siblings = (await session.execute(
        select(Workflow).where(Workflow.project_id == project_id)
    )).scalars().all()
    if any(slugify(w.name) == new_slug for w in siblings):
        raise HTTPException(400, f"Workflow '{name}' đã tồn tại trong project này")

    wf = Workflow(
        id=str(uuid.uuid4()),
        name=name,
        description=body.get("description"),
        project_id=project_id,
        color=body.get("color", "#6c63ff"),
        created_at=datetime.now(),
        updated_at=datetime.now(),
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
    from services.export_import import duplicate_workflow_in_place
    try:
        return await duplicate_workflow_in_place(workflow_id, session)
    except ValueError as e:
        raise HTTPException(404, str(e))


from fastapi.responses import StreamingResponse

@router.get("/api/workflows/{workflow_id}/export")
async def export_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    from services.export_import import export_workflow_to_zip
    try:
        memory_file = await export_workflow_to_zip(workflow_id, session)
        memory_file.seek(0)
        
        headers = {
            'Content-Disposition': f'attachment; filename="workflow_{workflow_id}.zip"'
        }
        return StreamingResponse(memory_file, media_type="application/zip", headers=headers)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.put("/api/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")

    if "name" in body and body["name"].strip() != wf.name:
        new_name = body["name"].strip()
        new_slug = slugify(new_name)
        siblings = (await session.execute(
            select(Workflow).where(Workflow.project_id == wf.project_id, Workflow.id != workflow_id)
        )).scalars().all()
        if any(slugify(w.name) == new_slug for w in siblings):
            raise HTTPException(400, f"Workflow '{new_name}' đã tồn tại trong project này")

    for field in ["name", "description", "graph_json", "color"]:
        if field in body:
            setattr(wf, field, body[field])
    wf.updated_at = datetime.now()

    await session.commit()
    await session.refresh(wf)
    return wf.to_dict()


@router.delete("/api/workflows/{workflow_id}", status_code=204)
async def delete_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
    wf_name = wf.name
    # Lấy project name để tính đường dẫn folder
    proj = await session.get(Project, wf.project_id)
    pj_name = proj.name if proj else None
    await session.delete(wf)
    await session.commit()
    delete_workflow_dir(workflow_id, wf_name=wf_name, pj_name=pj_name)


@router.get("/api/workflows/{workflow_id}/input")
async def get_workflow_input(workflow_id: str, session: AsyncSession = Depends(get_session)):
    import json
    from services.executor_blocks import get_project_dir
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
    
    import re
    def slugify(text: str) -> str:
        import unicodedata
        text = unicodedata.normalize('NFKD', str(text)).encode('ascii', 'ignore').decode('utf-8')
        text = re.sub(r'[^\w\s-]', '', text).strip().lower()
        text = re.sub(r'[-\s_]+', '_', text)
        return text
        
    wf_dir = get_project_dir(wf.project_id) / f"wf_{slugify(wf.name)}"
    input_file = wf_dir / "input" / "input.json"
    
    if input_file.exists():
        try:
            with open(input_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

@router.put("/api/workflows/{workflow_id}/input")
async def update_workflow_input(workflow_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    import json
    from services.executor_blocks import get_project_dir
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    import re
    def slugify(text: str) -> str:
        import unicodedata
        text = unicodedata.normalize('NFKD', str(text)).encode('ascii', 'ignore').decode('utf-8')
        text = re.sub(r'[^\w\s-]', '', text).strip().lower()
        text = re.sub(r'[-\s_]+', '_', text)
        return text
        
    wf_dir = get_project_dir(wf.project_id) / f"wf_{slugify(wf.name)}"
    input_dir = wf_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    input_file = input_dir / "input.json"
    
    with open(input_file, "w", encoding="utf-8") as f:
        json.dump(body, f, ensure_ascii=False, indent=2)
        
    return {"status": "ok"}


# ── Run Workflow ────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")

    run_id = str(uuid.uuid4())
    asyncio.create_task(run_workflow_internal(workflow_id, triggered_by="manual", run_id=run_id))
    return {"status": "started", "workflow_id": workflow_id, "run_id": run_id}


@router.post("/api/workflows/{workflow_id}/stop")
async def stop_workflow(workflow_id: str):
    # First set all stop flags for running workflows
    stopped_runs = []
    if workflow_id in _workflow_run_ids:
        for run_id in list(_workflow_run_ids[workflow_id]):
            if run_id in _stop_flags:
                _stop_flags[run_id].set()
                stopped_runs.append(run_id)
    
    # Also kill processes directly for immediate stop
    from services.executor_blocks import stop_all_runs_for_workflow
    stop_all_runs_for_workflow(workflow_id)
    
    return {"stopped": True, "runs": stopped_runs}


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

@router.delete("/api/workflows/{workflow_id}/runs", status_code=204)
async def delete_run_history(workflow_id: str, session: AsyncSession = Depends(get_session)):
    import shutil
    from services.venv_manager import DATA_DIR
    wf = await session.get(Workflow, workflow_id)
    if wf:
        runs_dir = DATA_DIR / f"pj_{wf.project_id}" / f"wf_{workflow_id}" / "runs"
        if runs_dir.exists():
            shutil.rmtree(runs_dir, ignore_errors=True)
            
    await session.execute(
        delete(WorkflowRun).where(WorkflowRun.workflow_id == workflow_id)
    )
    await session.commit()
    return None



@router.get("/api/runs/{run_id}")
async def get_run(run_id: str, session: AsyncSession = Depends(get_session)):
    run = await session.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(404, "Run không tồn tại")
    return run.to_dict()


# ── Scheduler trigger ────────────────────────────────────────

async def trigger_workflow_from_scheduler(workflow_id: str, project_id: str = None, schedule_id: str = None):
    run_id = str(uuid.uuid4())
    asyncio.create_task(run_workflow_internal(workflow_id, triggered_by="schedule", run_id=run_id))

# ── Log Streaming (SSE) ──────────────────────────────────────

@router.get("/api/runs/{run_id}/logs/stream")
async def stream_logs(run_id: str, offset: int = 0):
    from ws.log_socket import subscribe, unsubscribe, get_run_history
    queue = asyncio.Queue()
    
    # Pre-fill queue with missed history
    history = get_run_history(run_id, offset)
    for msg in history:
        queue.put_nowait(msg)
        
    await subscribe(run_id, queue)

    async def event_generator():
        try:
            while True:
                msg = await queue.get()
                # msg is already JSON serialized string from log_socket.py
                yield f"data: {msg}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await unsubscribe(run_id, queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")

# ── Telegram Listener ───────────────────────────────────────
# Listener chỉ được bật/tắt thông qua nút Chạy/Dừng của workflow (xem
# services/executor_blocks.py, khối telegram_listener), endpoint dưới đây
# chỉ để đọc trạng thái hiện tại cho UI.

@router.get("/api/workflows/{workflow_id}/listener/status")
async def listener_status(workflow_id: str):
    from services.telegram_listener import is_listener_running
    running = is_listener_running(workflow_id)
    return {"status": "running" if running else "stopped"}
