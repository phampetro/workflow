import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from database import init_db
from services.scheduler import start_scheduler, stop_scheduler, set_run_callback
from routers import projects, workflows, users, dashboard, files, schedule_endpoints

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
            stmt = select(Schedule, Workflow.project_id).join(
                Workflow, Schedule.workflow_id == Workflow.id
            ).join(
                Project, Workflow.project_id == Project.id
            ).where(Schedule.enabled == True, Project.user_id == user.id)
            
            rows = (await session.execute(stmt)).all()
            loaded = 0

            from services.scheduler import scheduler as aps_scheduler, trigger_workflow_job, build_cron_trigger, get_next_run_time
            # Remove all jobs
            aps_scheduler.remove_all_jobs()

            for sched, proj_id in rows:
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
    
    # Load schedules and start Scheduler
    set_run_callback(workflows.trigger_workflow_from_scheduler)
    start_scheduler()
    
    # Run DB tasks in background event loop and wait for it
    try:
        await reload_schedules()
    except Exception as e:
        logger.warning(f"Could not reload schedules on startup: {e}")
    
    yield
    
    # Shutdown gracefully
    stop_scheduler()
    logger.info("APScheduler stopped")

app = FastAPI(lifespan=lifespan, title="PyFlow Studio API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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

@app.get("/health")
def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
