import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_session
from models import Schedule, Workflow
from services.scheduler import add_schedule, remove_schedule, get_next_run

router = APIRouter(tags=["schedules"])


@router.get("/api/workflows/{workflow_id}/schedules")
async def list_schedules(workflow_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Schedule).where(Schedule.workflow_id == workflow_id))
    return [s.to_dict() for s in result.scalars().all()]


@router.post("/api/workflows/{workflow_id}/schedules", status_code=201)
async def create_schedule(workflow_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")

    cron_expr = body.get("cron_expr", "0 8 * * *")
    next_run = get_next_run(cron_expr)

    sched = Schedule(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        cron_expr=cron_expr,
        label=body.get("label") or cron_expr,
        enabled=body.get("enabled", True),
        created_at=datetime.utcnow(),
        next_run_at=next_run,
    )
    session.add(sched)
    await session.commit()
    await session.refresh(sched)

    if sched.enabled:
        add_schedule(sched.id, workflow_id, wf.project_id, cron_expr)

    return sched.to_dict()


@router.put("/api/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    sched = await session.get(Schedule, schedule_id)
    if not sched:
        raise HTTPException(404, "Schedule không tồn tại")

    for field in ["cron_expr", "label", "enabled"]:
        if field in body:
            setattr(sched, field, body[field])

    if "cron_expr" in body:
        sched.next_run_at = get_next_run(sched.cron_expr)

    await session.commit()
    await session.refresh(sched)

    wf = await session.get(Workflow, sched.workflow_id)
    if sched.enabled and wf:
        add_schedule(sched.id, sched.workflow_id, wf.project_id, sched.cron_expr)
    else:
        remove_schedule(sched.id)

    return sched.to_dict()


@router.patch("/api/schedules/{schedule_id}/toggle")
async def toggle_schedule(schedule_id: str, session: AsyncSession = Depends(get_session)):
    sched = await session.get(Schedule, schedule_id)
    if not sched:
        raise HTTPException(404, "Schedule không tồn tại")

    sched.enabled = not sched.enabled
    wf = await session.get(Workflow, sched.workflow_id)

    if sched.enabled and wf:
        add_schedule(sched.id, sched.workflow_id, wf.project_id, sched.cron_expr)
        sched.next_run_at = get_next_run(sched.cron_expr)
    else:
        remove_schedule(sched.id)
        sched.next_run_at = None

    await session.commit()
    return sched.to_dict()


@router.delete("/api/schedules/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: str, session: AsyncSession = Depends(get_session)):
    sched = await session.get(Schedule, schedule_id)
    if not sched:
        raise HTTPException(404, "Schedule không tồn tại")
    remove_schedule(schedule_id)
    await session.delete(sched)
    await session.commit()
