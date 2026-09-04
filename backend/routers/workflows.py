import logging
import uuid
import asyncio
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from database import get_session, AsyncSessionLocal
from models import Workflow, WorkflowRun, RunStatus, Project
from services.executor import execute_workflow
from services.venv_manager import delete_workflow_dir, rename_workflow_dir, slugify
from ws.log_socket import make_log_callback
from routers.ownership import ensure_workflow_owner

logger = logging.getLogger("pyflow.workflows")

router = APIRouter(tags=["workflows"])

# Giữ tham chiếu mạnh tới task nền. Event loop chỉ giữ WEAK reference tới task
# (tài liệu Python cảnh báo rõ), nên `asyncio.create_task(...)` mà không ai giữ
# lại có thể bị GC thu hồi GIỮA CHỪNG: workflow biến mất im lặng và WorkflowRun
# kẹt RUNNING tới lần restart, hoặc venv im lặng không được tạo.
_background_tasks = set()


def _spawn(coro):
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task

_stop_flags: dict = {}
_workflow_run_ids: dict = {}

# Event loop chính của backend (uvicorn) — được set lúc startup.
# Các nguồn trigger chạy trên loop/thread khác (vd Telegram listener)
# phải điều phối run về loop này để log/SSE/DB hoạt động nhất quán.
_main_loop = None

def set_main_loop(loop):
    global _main_loop
    _main_loop = loop

def schedule_run_on_main_loop(workflow_id: str, initial_input: dict = None, triggered_by: str = "manual"):
    """Kích hoạt run từ thread/loop bất kỳ, luôn thực thi trên loop chính."""
    coro = run_workflow_internal(workflow_id, initial_input=initial_input, triggered_by=triggered_by)
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if _main_loop is not None and _main_loop is not running:
        asyncio.run_coroutine_threadsafe(coro, _main_loop)
    else:
        _spawn(coro)


async def run_workflow_internal(workflow_id: str, initial_input: dict = None, triggered_by: str = "manual", run_id: str = None):
    """Chạy 1 workflow từ đầu tới cuối.

    ⚠ Session DB được mở/đóng thành 3 đoạn NGẮN, KHÔNG bọc quanh execute_workflow().
    Lý do: workflow chứa khối telegram_listener treo ở `while True: sleep(0.5)` cho
    tới khi người dùng bấm Dừng — có thể sống hàng ngày, hàng tuần. Bản cũ dùng
    `async with AsyncSessionLocal() as session:` bao trọn lời gọi đó, nên mỗi
    listener giữ chết 1 connection trong pool SQLAlchemy: bật 5-10 listener là cạn
    pool và MỌI request API đứng chờ vô hạn. Đó cũng đúng điều README cảnh báo
    ("đừng long-open async session trong khi executor thread đang UPDATE cùng row").
    """
    # ── Đoạn 1: đọc workflow + tạo bản ghi run ──────────────────────────────
    async with AsyncSessionLocal() as session:
        wf = await session.get(Workflow, workflow_id)
        if not wf:
            return None

        # Giữ lại các giá trị cần dùng sau khi session đóng. Không dùng lại object
        # `wf` ngoài phạm vi này: sau nhiều ngày nó đã stale, và truy cập thuộc tính
        # lazy trên session đã đóng sẽ ném lỗi.
        project_id = wf.project_id
        workflow_name = wf.name
        graph_json = wf.graph_json

        if not run_id:
            run_id = str(uuid.uuid4())
        _workflow_run_ids.setdefault(workflow_id, set()).add(run_id)

        run = WorkflowRun(
            id=run_id,
            workflow_id=workflow_id,
            project_id=project_id,
            status=RunStatus.RUNNING,
            started_at=datetime.now(),
            triggered_by=triggered_by
        )
        session.add(run)
        await session.commit()

    stop_flag = asyncio.Event()
    _stop_flags[run_id] = stop_flag
    log_callback = make_log_callback(run_id)

    # Nhét payload từ Telegram vào node listener trước khi chạy
    if initial_input and graph_json:
        import json
        try:
            graph = json.loads(graph_json)
            for node in graph.get("nodes", []):
                if node.get("data", {}).get("type") == "telegram_listener":
                    node["data"]["_initial_input"] = initial_input
            graph_json = json.dumps(graph)
        except Exception as e:
            logger.warning(f"Không chèn được _initial_input vào graph của run {run_id}: {e}")

    # ── Đoạn 2: chạy workflow — KHÔNG giữ session nào trong suốt thời gian này ──
    run_error = None
    try:
        await execute_workflow(
            project_id=project_id,
            workflow_id=workflow_id,
            run_id=run_id,
            workflow_name=workflow_name,
            graph_json=graph_json,
            log_callback=log_callback,
            stop_flag=stop_flag
        )
        # Trạng thái run đã được _finish_run ghi từ trong execute_workflow_thread
    except Exception as e:
        run_error = str(e)
    finally:
        # ── Đoạn 3: session mới, chỉ để ghi log và dọn ──────────────────────
        from ws.log_socket import get_run_history, cleanup_log
        history = get_run_history(run_id)
        logs_json_str = "[" + ",".join(history) + "]" if history else "[]"

        try:
            async with AsyncSessionLocal() as session:
                run = await session.get(WorkflowRun, run_id)
                if run:
                    run.logs_json = logs_json_str
                    if run_error:
                        run.status = RunStatus.ERROR
                        run.error_message = run_error
                        run.finished_at = datetime.now()
                    await session.commit()
        except Exception as e:
            logger.error(f"Không ghi được logs_json cho run {run_id}: {e}")

        cleanup_log(run_id)
        _stop_flags.pop(run_id, None)
        if workflow_id in _workflow_run_ids:
            _workflow_run_ids[workflow_id].discard(run_id)
            # Không để lại set rỗng — dict này chỉ có tăng theo số workflow từng chạy
            if not _workflow_run_ids[workflow_id]:
                del _workflow_run_ids[workflow_id]


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

    from services.executor_blocks import _listener_holder_runs

    out = []
    for w in workflows:
        d = w.to_dict()
        d["last_run_status"] = last_status_map.get(w.id)
        # Đánh dấu wf đang chạy
        if w.id in _workflow_run_ids and _workflow_run_ids[w.id]:
            d["is_running"] = True
            # Chỉ trả 1 run_id vì giao diện chỉ bám 1. Ưu tiên run ĐANG LÀM VIỆC:
            # workflow bật khối "Lệnh Telegram" luôn có 1 run thường trú chỉ để giữ
            # Listener sống (kẹt ở while True), còn mỗi lệnh Telegram sinh 1 run
            # riêng. next(iter(set)) trước đây hay trúng run giữ Listener → FE bám
            # nhầm, mở log của lệnh vừa chạy thì trống trơn.
            run_ids = _workflow_run_ids[w.id]
            working = [r for r in run_ids if r not in _listener_holder_runs]
            d["running_run_id"] = working[0] if working else next(iter(run_ids))
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
async def update_workflow(workflow_id: str, body: dict, request: Request, session: AsyncSession = Depends(get_session)):
    await ensure_workflow_owner(request, session, workflow_id)
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")

    old_name = wf.name
    new_name = body.get("name", wf.name).strip() if "name" in body else wf.name

    if "name" in body and new_name != wf.name:
        new_slug = slugify(new_name)
        siblings = (await session.execute(
            select(Workflow).where(Workflow.project_id == wf.project_id, Workflow.id != workflow_id)
        )).scalars().all()
        if any(slugify(w.name) == new_slug for w in siblings):
            raise HTTPException(400, f"Workflow '{new_name}' đã tồn tại trong project này")

    # ETag / conflict detection: FE gửi kèm expected_updated_at (ISO string) — nếu khác
    # với DB thì có người khác đã lưu trong lúc mình sửa; trả 409 để FE cảnh báo.
    expected_updated_at = body.get("expected_updated_at")
    if expected_updated_at and wf.updated_at:
        current_iso = wf.updated_at.isoformat()
        if expected_updated_at != current_iso:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "conflict",
                    "message": "Workflow đã bị người/tab khác lưu lại trong lúc bạn đang sửa. Vui lòng tải lại để xem thay đổi mới.",
                    "server_updated_at": current_iso,
                }
            )

    # Rename thư mục workflow TRƯỚC khi commit DB
    renamed = False
    if "name" in body and slugify(new_name) != slugify(old_name):
        proj = await session.get(Project, wf.project_id)
        pj_name = proj.name if proj else None
        if pj_name:
            try:
                renamed = rename_workflow_dir(pj_name, old_name, new_name)
            except Exception as e:
                raise HTTPException(400, f"Không đổi tên thư mục workflow được: {e}")

    for field in ["name", "description", "graph_json", "color"]:
        if field in body:
            setattr(wf, field, body[field])
    wf.updated_at = datetime.now()

    try:
        await session.commit()
    except Exception:
        if renamed and pj_name:
            try:
                rename_workflow_dir(pj_name, new_name, old_name)
            except Exception:
                pass
        raise
    await session.refresh(wf)
    return wf.to_dict()


async def _cascade_delete_workflow_children(session: AsyncSession, workflow_id: str):
    """Xóa run history + schedule (kèm job APScheduler) của một workflow."""
    from models import Schedule
    from services.scheduler import scheduler

    scheds = (await session.execute(
        select(Schedule).where(Schedule.workflow_id == workflow_id)
    )).scalars().all()
    for s in scheds:
        try:
            scheduler.remove_job(s.id)
        except Exception:
            pass
        await session.delete(s)

    await session.execute(
        delete(WorkflowRun).where(WorkflowRun.workflow_id == workflow_id)
    )

    # Kết nối Database cũng thuộc về workflow (db_connection.workflow_id). Trước đây
    # không xoá nên sau khi xoá workflow/project, các row này ở lại vĩnh viễn TRONG
    # KHI VẪN CHỨA MẬT KHẨU: người dùng tưởng đã xoá sạch mà credential vẫn nằm
    # trong pyflow.db, không có cách nào dọn từ giao diện.
    from models import DbConnection
    await session.execute(
        delete(DbConnection).where(DbConnection.workflow_id == workflow_id)
    )


def _pending_run_ids(workflow_id: str) -> set:
    """Tập run_id đang chạy của workflow, hợp của CẢ 2 bảng theo dõi.

    Bảng ở services.executor_blocks chỉ được điền sau ~0.5s (thread executor còn đang
    khởi động), còn bảng _workflow_run_ids ở router này có run_id ngay từ lúc tạo run.
    Nếu chỉ xét 1 bảng sẽ bỏ sót run vừa mới bắt đầu.
    """
    from services.executor_blocks import _workflow_run_ids as _exec_run_ids
    return set(_exec_run_ids.get(workflow_id, set())) | set(_workflow_run_ids.get(workflow_id, set()))


async def _stop_and_wait_workflow_runs(workflow_id: str, timeout_sec: float = 5.0):
    """Kill mọi run đang chạy của workflow rồi đợi thread executor thoát trước khi
    xoá DB/rmtree folder - tránh race ghi vào folder đang bị xoá."""
    from services.executor_blocks import stop_all_runs_for_workflow
    from services.telegram_listener import stop_telegram_listener

    # Bấm Dừng logic (giống endpoint /stop)
    stop_all_runs_for_workflow(workflow_id)
    for run_id in _pending_run_ids(workflow_id):
        if run_id in _stop_flags:
            _stop_flags[run_id].set()

    # Đợi các run rời khỏi bảng đang-chạy
    waited = 0.0
    step = 0.1
    while waited < timeout_sec and _pending_run_ids(workflow_id):
        await asyncio.sleep(step)
        waited += step

    # Dừng luôn Telegram listener nếu có
    try:
        await stop_telegram_listener(workflow_id)
    except Exception as e:
        logger.warning(f"Không dừng được Telegram listener của workflow {workflow_id}: {e}")

    # Trả về True nếu đã dừng SẠCH. Caller phải kiểm — hết 5s mà run còn chạy thì
    # tuyệt đối không được xoá tiếp: thread executor sẽ ghi file vào thư mục vừa
    # rmtree (tạo lại một phần thư mục sau khi xoá) rồi UPDATE một run_id đã biến
    # khỏi DB — 0 dòng bị ảnh hưởng, không lỗi, không log, không ai biết.
    return not _pending_run_ids(workflow_id)


@router.delete("/api/workflows/{workflow_id}", status_code=204)
async def delete_workflow(workflow_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    await ensure_workflow_owner(request, session, workflow_id)
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
    wf_name = wf.name
    # Lấy project name để tính đường dẫn folder
    proj = await session.get(Project, wf.project_id)
    pj_name = proj.name if proj else None

    # PHẢI dừng run + listener trước khi xoá DB/folder - nếu không thread executor
    # còn chạy sẽ ghi vào folder đang bị rmtree hoặc UPDATE run_id đã biến mất.
    if not await _stop_and_wait_workflow_runs(workflow_id):
        # Ví dụ khối Python đang kẹt trong ensure_packages -> pip install: chỉ kiểm
        # stop_event mỗi vòng đọc stdout nên có thể mất 30s+ mới thoát.
        raise HTTPException(409, "Workflow vẫn đang chạy và chưa dừng kịp. Hãy bấm Dừng, đợi dứt hẳn rồi xoá lại.")

    await _cascade_delete_workflow_children(session, workflow_id)
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
        
    def parse_json_with_comments(content_str: str) -> dict:
        if not content_str or not content_str.strip():
            return {}
        pattern = r'("(?:\\.|[^"\\])*")|(//.*)|(/\*[\s\S]*?\*/)'
        cleaned = re.sub(pattern, lambda m: m.group(1) if m.group(1) else '', content_str)
        cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
        return json.loads(cleaned)

    wf_dir = get_project_dir(wf.project_id) / f"wf_{slugify(wf.name)}"
    input_file = wf_dir / "input" / "input.json"
    
    if input_file.exists():
        raw_text = ""
        try:
            with open(input_file, "r", encoding="utf-8") as f:
                raw_text = f.read()
        except Exception as e:
            # Không đọc được file (quyền, đang bị khoá) — vẫn phải báo, đừng trả {}
            return {"__raw_text__": "", "__parse_error__": f"Không đọc được input.json: {e}"}

        try:
            data = parse_json_with_comments(raw_text)
            if isinstance(data, dict):
                data["__raw_text__"] = raw_text
            return data
        except Exception as e:
            # Trả nguyên văn + lý do thay vì {} im lặng. Trước đây trả {} nên
            # InputJsonModal hiện editor TRỐNG: người dùng tưởng biến bị mất, gõ lại
            # vài biến rồi Lưu → ghi đè mất sạch token Telegram / mật khẩu cũ.
            return {"__raw_text__": raw_text, "__parse_error__": f"JSON không hợp lệ: {e}"}
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

    def parse_json_with_comments(content_str: str) -> dict:
        if not content_str or not content_str.strip():
            return {}
        pattern = r'("(?:\\.|[^"\\])*")|(//.*)|(/\*[\s\S]*?\*/)'
        cleaned = re.sub(pattern, lambda m: m.group(1) if m.group(1) else '', content_str)
        cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
        return json.loads(cleaned)
        
    wf_dir = get_project_dir(wf.project_id) / f"wf_{slugify(wf.name)}"
    input_dir = wf_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    input_file = input_dir / "input.json"
    
    def _atomic_write(content: str):
        """Ghi qua file tạm rồi os.replace — thao tác nguyên tử trên cả Windows lẫn
        POSIX. open(...,"w") truncate ngay lập tức: mất điện / bị kill (kể cả
        os._exit(0) của /api/system/update) giữa truncate và write sẽ để lại
        input.json 0 byte, mất toàn bộ biến môi trường."""
        import os
        tmp = input_file.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, input_file)

    if isinstance(body, dict) and "raw_text" in body:
        raw_text = body["raw_text"]
        # Validate format — JSON sai là lỗi của người dùng (400), không phải 500
        try:
            parse_json_with_comments(raw_text)
        except Exception as e:
            raise HTTPException(400, f"JSON không hợp lệ: {e}")
        _atomic_write(raw_text)
    else:
        _atomic_write(json.dumps(body, ensure_ascii=False, indent=2))

    return {"status": "ok"}


# ── Run Workflow ────────────────────────────────────────────

@router.post("/api/workflows/{workflow_id}/run")
async def run_workflow(workflow_id: str, request: Request, session: AsyncSession = Depends(get_session)):
    await ensure_workflow_owner(request, session, workflow_id)
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")

    # Luật tương thích khối (nguồn sự thật) — chặn cả khi import/lách FE
    from services.block_rules import validate_workflow
    _check = validate_workflow(wf.graph_json)
    if not _check["ok"]:
        raise HTTPException(400, " ".join(_check["violations"]))

    run_id = str(uuid.uuid4())
    _spawn(run_workflow_internal(workflow_id, triggered_by="manual", run_id=run_id))
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


# ── Khối "Biến đầu vào": chờ người dùng nhập ────────────────────────────────
@router.get("/api/runs/{run_id}/pending-input")
async def get_run_pending_input(run_id: str):
    """FE poll khi run đang chạy → nếu có yêu cầu nhập, trả spec + số giây còn lại."""
    from services.executor_blocks import get_pending_input
    p = get_pending_input(run_id)
    return p or {"pending": False}


@router.post("/api/runs/{run_id}/input")
async def submit_run_input(run_id: str, body: dict):
    """FE gửi giá trị người dùng nhập cho executor thread đang chờ."""
    from services.executor_blocks import submit_input
    res = submit_input(run_id, body.get("values") or {})
    if not res["ok"]:
        raise HTTPException(400, res["reason"])
    return {"ok": True}


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
    # Lịch sử chạy chỉ nằm trong DB (logs_json), không có thư mục runs/ trên đĩa
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

async def _rearm_listener_if_needed(workflow_id: str, run_id: str = None):
    """Bật lại Telegram Listener sau khi lịch đã dừng-và-chạy-lại workflow.

    Chỉ cần khi run mới KHÔNG đi qua khối Listener (khối rời khỏi đường đi từ khối Bắt
    đầu, nhánh điều kiện không được chọn, hoặc run lỗi trước khi tới đó) - nếu không,
    listener sẽ tắt hẳn sau tick lịch đầu tiên thay vì chỉ hở một khoảng ngắn.

    Không bật lại khi người dùng bấm Dừng (run kết thúc trạng thái stopped) - lúc đó
    tắt listener là đúng ý người dùng.
    """
    from services.telegram_listener import is_listener_running
    if is_listener_running(workflow_id):
        return
    if run_id:
        async with AsyncSessionLocal() as session:
            run = await session.get(WorkflowRun, run_id)
            if run and run.status == RunStatus.STOPPED:
                return
    import logging
    logging.getLogger("pyflow.scheduler").info(
        f"🎧 Bật lại Telegram Listener cho workflow {workflow_id} (run theo lịch không đi qua khối Listener)"
    )
    schedule_run_on_main_loop(workflow_id, triggered_by="listener_autostart")


async def trigger_workflow_from_scheduler(workflow_id: str, project_id: str = None, schedule_id: str = None):
    """Lịch tới giờ → chạy workflow từ đầu.

    APScheduler max_instances=1 chỉ bảo vệ hàm job (trả về ngay lập tức) chứ không
    bảo vệ workflow thực sự. Nếu cron dày hơn thời gian workflow chạy sẽ có nhiều run
    song song, cùng ghi 1 folder và insert DB trùng - nên vẫn skip nếu còn run ĐANG
    LÀM VIỆC.

    Ngoại lệ: run chỉ "thường trú" để giữ Telegram Listener (kẹt ở `while True` chờ nút
    Dừng, xem executor_blocks._listener_holder_runs) KHÔNG tính là đang làm việc.
    Trước đây nó bị tính là RUNNING nên mọi lịch của workflow bị bỏ qua vĩnh viễn suốt
    thời gian listener bật. Nay: dừng run đó (kéo theo tắt listener) rồi chạy mới lại từ
    đầu - run mới đi qua khối Listener sẽ tự bật lại listener.

    Đánh đổi đã được chấp nhận có chủ đích: trong khoảng dừng-và-bật-lại (vài giây)
    listener không lắng nghe, và tin nhắn Telegram tới trong khoảng đó bị MẤT vì listener
    bỏ backlog khi khởi động lại (xem telegram_listener._telegram_listener_loop).
    """
    import logging
    logger = logging.getLogger("pyflow.scheduler")

    from services.executor_blocks import _listener_holder_runs

    running = _pending_run_ids(workflow_id)
    working = running - _listener_holder_runs
    if working:
        logger.warning(
            f"⏭  Bỏ qua trigger schedule cho workflow {workflow_id}: còn run RUNNING chưa xong"
        )
        return

    listener_was_on = False
    if running:
        from services.telegram_listener import is_listener_running
        listener_was_on = is_listener_running(workflow_id)
        logger.info(
            f"⏹  Lịch tới giờ: dừng run đang giữ Telegram Listener của workflow {workflow_id} để chạy lại từ đầu"
        )
        await _stop_and_wait_workflow_runs(workflow_id)

        if _pending_run_ids(workflow_id):
            logger.warning(
                f"⏭  Bỏ qua trigger schedule cho workflow {workflow_id}: run cũ không dừng kịp sau 5s"
            )
            if listener_was_on:
                await _rearm_listener_if_needed(workflow_id)
            return

    run_id = str(uuid.uuid4())
    task = _spawn(run_workflow_internal(workflow_id, triggered_by="schedule", run_id=run_id))

    if listener_was_on:
        # Run mới kết thúc = nó KHÔNG dừng lại ở khối Listener (nếu có đi qua thì nó
        # đã kẹt ở `while True` và task này không bao giờ done) -> phải tự bật lại.
        task.add_done_callback(
            lambda _t: _spawn(_rearm_listener_if_needed(workflow_id, run_id))
        )

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

# ── Ghi thao tác trình duyệt (Recorder) ─────────────────────
# Mở trình duyệt headed, tiêm recorder.js để ghi lại thao tác của người dùng và
# tự sinh ra danh sách step (kèm fallback selector chain) cho khối Browser.

@router.post("/api/workflows/{workflow_id}/record/start")
async def record_start(workflow_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")

    from services import browser_recorder
    from services.venv_manager import get_project_dir, slugify as _slug

    wf_dir = get_project_dir(wf.project_id) / f"wf_{_slug(wf.name)}"
    # Profile riêng cho việc ghi — giữ phiên đăng nhập giữa các lần ghi.
    profile_dir = str(wf_dir / "browser_profile_record").replace("\\", "/")

    loop = asyncio.get_running_loop()
    start_url = (body.get("url") or "").strip()
    res = browser_recorder.start(workflow_id, profile_dir, start_url, loop)
    if not res["ok"]:
        raise HTTPException(400, res["reason"])
    return {"ok": True}


@router.post("/api/workflows/{workflow_id}/record/stop")
async def record_stop(workflow_id: str):
    from services import browser_recorder
    browser_recorder.stop(workflow_id)
    return {"ok": True}


@router.get("/api/workflows/{workflow_id}/record/stream")
async def record_stream(workflow_id: str):
    import json as _json
    from services import browser_recorder

    if not browser_recorder.get_session(workflow_id):
        raise HTTPException(404, "Không có phiên ghi nào đang chạy")

    queue = asyncio.Queue()
    # Phát lại các sự kiện đã có (vd bước navigate ban đầu ghi trước khi SSE kết nối)
    for ev in browser_recorder.snapshot_events(workflow_id):
        queue.put_nowait(ev)
    browser_recorder.subscribe(workflow_id, queue)

    async def event_generator():
        try:
            while True:
                ev = await queue.get()
                yield f"data: {_json.dumps(ev, ensure_ascii=False)}\n\n"
                if ev.get("type") == "done":
                    break
        except asyncio.CancelledError:
            pass
        finally:
            browser_recorder.unsubscribe(workflow_id, queue)

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
