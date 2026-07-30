import logging
import os
import sys
from contextlib import asynccontextmanager

# ── Chromium riêng của Playwright: ưu tiên thư mục cạnh app (portable) ───────
# Nếu có thư mục `ms-playwright` nằm cạnh pyflow-backend.exe thì dùng nó thay cho
# %LOCALAPPDATA%\ms-playwright. Nhờ vậy máy khách bị mạng công ty chặn CDN
# Playwright vẫn cài được: chỉ cần copy nguyên thư mục đó từ máy đã chạy sang.
# PHẢI set trước khi Playwright khởi động driver → đặt ngay đầu module.
def _setup_playwright_browsers_path() -> str:
    base = (os.path.dirname(sys.executable) if getattr(sys, "frozen", False)
            else os.path.dirname(os.path.abspath(__file__)))
    portable = os.path.join(base, "ms-playwright")
    if os.path.isdir(portable):
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = portable
        return portable
    return os.environ.get("PLAYWRIGHT_BROWSERS_PATH", "")


PLAYWRIGHT_BROWSERS_DIR = _setup_playwright_browsers_path()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn
import os

from database import init_db
from services.scheduler import start_scheduler, stop_scheduler, set_run_callback
from routers import projects, workflows, users, dashboard, files, schedule_endpoints, ai_codegen, database, system, license
from services import licensing
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("pyflow.main")

from database import AsyncSessionLocal
from sqlalchemy import select, update
from models import User, Schedule, Workflow, Project, WorkflowRun, RunStatus
import asyncio

async def cleanup_stuck_runs():
    """Mark any runs stuck in RUNNING status as FAILED on startup."""
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(WorkflowRun).where(WorkflowRun.status == RunStatus.RUNNING)
        )
        stuck = result.scalars().all()
        if stuck:
            logger.warning(f"Found {len(stuck)} stuck runs - marking as failed")
            for run in stuck:
                run.status = RunStatus.ERROR
                run.finished_at = run.started_at
                run.error_message = "Run bị treo - backend khởi động lại"
            await session.commit()

async def reload_telegram_listeners():
    """Sau khi backend khởi động, bật lại mọi Telegram Listener đang được đánh dấu
    listener_on=True (chỉ với workflow thuộc user đang active - đồng bộ với policy
    schedule)."""
    async with AsyncSessionLocal() as session:
        active_user = (await session.execute(
            select(User).where(User.is_active == True)
        )).scalars().first()
        if not active_user:
            return

        stmt = select(Workflow.id).join(
            Project, Workflow.project_id == Project.id
        ).where(Workflow.listener_on == True, Project.user_id == active_user.id)
        wf_ids = [row[0] for row in (await session.execute(stmt)).all()]

        if not wf_ids:
            return

        # Reset cờ trước khi trigger - khối telegram_listener sẽ set lại True khi
        # bật thành công. Nếu bật thất bại (bot token sai, mạng...), cờ ở False
        # là đúng trạng thái thực tế.
        from sqlalchemy import update as sa_update
        from models import Workflow as W
        await session.execute(sa_update(W).where(W.id.in_(wf_ids)).values(listener_on=False))
        await session.commit()

    from routers.workflows import schedule_run_on_main_loop
    for wf_id in wf_ids:
        try:
            schedule_run_on_main_loop(wf_id, triggered_by="listener_autostart")
            logger.info(f"🎧 Auto-restart listener cho workflow {wf_id}")
        except Exception as e:
            logger.warning(f"Không auto-restart được listener {wf_id}: {e}")


async def reload_schedules():
    async with AsyncSessionLocal() as session:
        # Find active user
        user = (await session.execute(select(User).where(User.is_active == True))).scalars().first()
        if not user:
            # Set first user as active if none
            user = (await session.execute(select(User).order_by(User.created_at.asc()))).scalars().first()
            if user:
                user.is_active = True
                await session.commit()
        
        if user:
            # Join schedule -> workflow -> project
            stmt = select(Schedule, Workflow.project_id, Workflow.graph_json).join(
                Workflow, Schedule.workflow_id == Workflow.id
            ).join(
                Project, Workflow.project_id == Project.id
            ).where(Schedule.enabled == True, Project.user_id == user.id)

            rows = (await session.execute(stmt)).all()
            loaded = 0

            from services.scheduler import scheduler as aps_scheduler, trigger_workflow_job, build_cron_trigger, get_next_run_time
            from services.block_rules import is_feature_disabled
            # Remove all jobs
            aps_scheduler.remove_all_jobs()

            for sched, proj_id, graph_json in rows:
                # Luật: workflow có khối interactive không được chạy theo lịch
                if is_feature_disabled(graph_json, "scheduler"):
                    logger.info(f"⏭ Bỏ qua lịch {sched.id}: workflow có khối chờ người nhập")
                    continue
                try:
                    aps_scheduler.add_job(
                        trigger_workflow_job,
                        trigger=build_cron_trigger(sched.cron_expr),
                        id=sched.id,
                        kwargs={"workflow_id": sched.workflow_id, "project_id": proj_id, "schedule_id": sched.id},
                        replace_existing=True,
                    )
                    sched.next_run_at = get_next_run_time(sched.id)
                    loaded += 1
                except Exception as e:
                    pass
            await session.commit()
            logger.info(f"✅ APScheduler started for user {user.name} - loaded {loaded} schedules")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing FastAPI backend resources...")
    # Initialize DB schema for SQLAlchemy
    await init_db()
    
    # Cleanup any runs stuck in RUNNING status from previous sessions
    await cleanup_stuck_runs()
    
    # Ghi nhớ loop chính để các trigger từ thread khác (Telegram listener) điều phối về
    workflows.set_main_loop(asyncio.get_running_loop())

    # Load schedules and start Scheduler
    set_run_callback(workflows.trigger_workflow_from_scheduler)
    start_scheduler()
    
    # Run DB tasks in background event loop and wait for it
    try:
        await reload_schedules()
    except Exception as e:
        logger.warning(f"Could not reload schedules on startup: {e}")

    # Bật lại các Telegram Listener đã bật trước khi backend restart
    try:
        await reload_telegram_listeners()
    except Exception as e:
        logger.warning(f"Could not reload telegram listeners on startup: {e}")

    yield
    
    # Shutdown gracefully
    stop_scheduler()
    logger.info("APScheduler stopped")

app = FastAPI(lifespan=lifespan, title="PyFlow Studio API")

# ── License guard ────────────────────────────────────────────────────────────
# Khi PYFLOW_LICENSE_ENFORCE=1 và license không hợp lệ/hết hạn → chặn mọi API
# (trừ health, /api/license/* để kích hoạt, /api/system/* để vẫn cập nhật được).
# Mặc định TẮT (env=0) → middleware thoát ngay, không ảnh hưởng bản dev.
_LICENSE_ALLOW = ("/health", "/api/license", "/api/system")

async def _license_guard(request, call_next):
    if licensing.ENFORCE:
        path = request.url.path
        # Chỉ chặn nếu là gọi API (và không nằm trong danh sách cho phép)
        if path.startswith("/api/") and not any(path.startswith(p) for p in _LICENSE_ALLOW):
            if licensing.is_locked():
                return JSONResponse(
                    status_code=403,
                    content={"error": "license_required",
                             "detail": "Phần mềm chưa kích hoạt hoặc đã hết hạn."},
                )
    return await call_next(request)

# Thêm guard TRƯỚC CORS để CORS bọc ngoài (response 403 vẫn có header CORS).
app.add_middleware(BaseHTTPMiddleware, dispatch=_license_guard)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:9000", "http://127.0.0.1:9000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(dashboard.router)
app.include_router(projects.router)
app.include_router(workflows.router)
app.include_router(files.router)
app.include_router(schedule_endpoints.router)
app.include_router(ai_codegen.router)
app.include_router(database.router)
app.include_router(system.router)
app.include_router(license.router)

@app.get("/health")
def health_check():
    return {"status": "ok"}

# ── Serve Frontend ───────────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    # Dang chay tu file thuc thi (PyInstaller)
    base_dir = os.path.dirname(sys.executable)
else:
    # Dang chay tu ma nguon Python
    base_dir = os.path.dirname(os.path.abspath(__file__))

frontend_dist = os.path.join(base_dir, "..", "frontend", "dist")

if os.path.exists(frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist, "assets")), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Nếu yêu cầu file cụ thể trong dist (ví dụ favicon.ico)
        file_path = os.path.join(frontend_dist, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        # Còn lại (các route của react-router) trả về index.html
        return FileResponse(os.path.join(frontend_dist, "index.html"))

if __name__ == "__main__":
    # ── Chế độ phụ: cài Chromium riêng cho Playwright ────────────────────────
    # Được start.vbs gọi ("pyflow-backend.exe install-browser") khi máy khách chưa
    # có Chromium riêng. Dùng driver Playwright đã bundle sẵn trong exe (không cần pip).
    # Chromium riêng giúp automation tách khỏi Chrome đang mở giao diện PyFlow (tránh
    # tranh GPU làm "đen" tab ứng dụng) và tách khỏi group policy/tiện ích của Chrome
    # cá nhân — thứ gây lỗi "máy này chạy được, máy khách không đăng nhập được".
    if len(sys.argv) > 1 and sys.argv[1] in ("install-browser", "install-chromium"):
        print("=" * 60)
        print(" PyFlow Studio - Cai dat trinh duyet Chromium (chi 1 lan)")
        print(" Thu muc dich:", PLAYWRIGHT_BROWSERS_DIR or "%LOCALAPPDATA%\\ms-playwright")
        print(" Dang tai (~150MB), vui long cho va giu ket noi Internet...")
        print("=" * 60)
        install_err = None
        try:
            from playwright.__main__ import main as _pw_main
            sys.argv = ["playwright", "install", "chromium"]
            _pw_main()
        except SystemExit as e:
            # _pw_main() luôn sys.exit(mã trả về của driver) → mã ≠ 0 là tải lỗi
            if e.code:
                install_err = f"playwright install tra ve ma loi {e.code}"
        except Exception as e:
            install_err = e

        # Xác minh thật sự đã có chrome.exe — trước đây tải fail vẫn exit 0 nên
        # máy khách âm thầm chạy bằng Chrome hệ thống mà không ai biết.
        from services.browser_executor import find_installed_chromium
        chromium_exe = find_installed_chromium()
        if chromium_exe:
            print("\n[OK] Da co Chromium rieng:", chromium_exe)
            sys.exit(0)

        print("\n[LOI] Khong cai duoc Chromium rieng." + (f" Chi tiet: {install_err}" if install_err else ""))
        print(" PyFlow van chay duoc bang Chrome/Edge he thong, NHUNG khoi Browser co the")
        print(" bi chan dang nhap (do policy/tien ich cua Chrome ca nhan) va hien thanh vang.")
        print(" Cach cai offline: copy thu muc ms-playwright tu may da chay duoc vao:")
        print("   ", os.path.join(base_dir, "ms-playwright"))
        import time as _t
        _t.sleep(12)
        sys.exit(1)

    port = 8000 if getattr(sys, 'frozen', False) else 7000
    uvicorn.run(app, host="127.0.0.1", port=port)
