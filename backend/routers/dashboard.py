from datetime import datetime, date
from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_session
from models import Project, Workflow, Schedule, WorkflowRun
from routers.workflows import _workflow_run_ids
from services.scheduler import scheduler

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("/stats")
async def get_dashboard_stats(request: Request, session: AsyncSession = Depends(get_session)):
    user_id = request.headers.get('X-User-Id')

    # Đếm running workflows (chỉ của user)
    running_count = 0
    if user_id:
        user_project_ids = set()
        projects = (await session.execute(select(Project).where(Project.user_id == user_id))).scalars().all()
        user_project_ids = {p.id for p in projects}
        total_projects = len(projects)

        stmt = select(Workflow).where(Workflow.project_id.in_(user_project_ids))
        workflows = (await session.execute(stmt)).scalars().all()
        workflow_ids = {w.id for w in workflows}
        total_workflows = len(workflows)

        # Đếm running của user
        for wf_id in workflow_ids:
            if wf_id in _workflow_run_ids:
                running_count += len(_workflow_run_ids[wf_id])

        # Filter runs theo project_ids của user
        stmt = select(WorkflowRun).where(WorkflowRun.project_id.in_(user_project_ids))
    else:
        total_projects = len((await session.execute(select(Project))).scalars().all())
        total_workflows = len((await session.execute(select(Workflow))).scalars().all())
        running_count = sum(len(runs) for runs in _workflow_run_ids.values())
        stmt = select(WorkflowRun)

    runs = (await session.execute(stmt)).scalars().all()
    today = date.today()
    completed_today = 0
    failed_today = 0
    stopped_today = 0
    total_today = 0

    for r in runs:
        if r.started_at and r.started_at.date() == today:
            total_today += 1
            if r.status == "success":
                completed_today += 1
            elif r.status == "error":
                failed_today += 1
            elif r.status == "stopped":
                stopped_today += 1

    # Jobs hôm nay - lọc theo workflows của user nếu có user_id
    jobs = scheduler.get_jobs()
    today_remaining = 0
    for job in jobs:
        if job.next_run_time and job.next_run_time.date() == today:
            if user_id:
                # Kiểm tra job thuộc workflow của user
                job_wf_id = job.kwargs.get('workflow_id') if job.kwargs else None
                if job_wf_id and job_wf_id in workflow_ids:
                    today_remaining += 1
            else:
                today_remaining += 1

    return {
        "data": {
            "total_projects": total_projects,
            "total_workflows": total_workflows,
            "running": running_count,
            "today_executed": completed_today,
            "today_total": completed_today + today_remaining,
            "success_today": completed_today,
            "failed_today": failed_today,
            "stopped_today": stopped_today,
            "total_today": total_today,
        }
    }
