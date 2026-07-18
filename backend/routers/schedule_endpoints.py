import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_session
from models import Workflow, Schedule, Project
from services.scheduler import scheduler, _cron_kwargs, trigger_workflow_job

router = APIRouter(tags=["schedules"])

@router.get("/api/workflows/{workflow_id}/schedules")
async def get_workflow_schedules(workflow_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Schedule).where(Schedule.workflow_id == workflow_id).order_by(Schedule.created_at.desc())
    )
    return [s.to_dict() for s in result.scalars().all()]


@router.post("/api/workflows/{workflow_id}/schedules", status_code=201)
async def create_schedule(workflow_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    cron_expr = body.get("cron_expr", "").strip()
    if not cron_expr:
        raise HTTPException(400, "Thiếu cron_expr")
        
    sched = Schedule(
        id=str(uuid.uuid4()),
        workflow_id=workflow_id,
        cron_expr=cron_expr,
        label=body.get("label", ""),
        enabled=body.get("enabled", True),
        created_at=datetime.utcnow()
    )
    session.add(sched)
    await session.commit()
    await session.refresh(sched)
    
    if sched.enabled:
        try:
            scheduler.add_job(
                trigger_workflow_job,
                "cron",
                id=sched.id,
                kwargs={"workflow_id": workflow_id, "project_id": wf.project_id, "schedule_id": sched.id},
                **_cron_kwargs(sched.cron_expr),
                replace_existing=True,
            )
        except Exception as e:
            raise HTTPException(400, f"Lỗi cron: {str(e)}")
            
    return sched.to_dict()


@router.put("/api/schedules/{schedule_id}")
async def update_schedule(schedule_id: str, body: dict, session: AsyncSession = Depends(get_session)):
    sched = await session.get(Schedule, schedule_id)
    if not sched:
        raise HTTPException(404, "Schedule không tồn tại")
        
    wf = await session.get(Workflow, sched.workflow_id)
        
    if "cron_expr" in body:
        sched.cron_expr = body["cron_expr"]
    if "label" in body:
        sched.label = body["label"]
        
    await session.commit()
    await session.refresh(sched)
    
    if sched.enabled:
        try:
            scheduler.add_job(
                trigger_workflow_job,
                "cron",
                id=sched.id,
                kwargs={"workflow_id": sched.workflow_id, "project_id": wf.project_id, "schedule_id": sched.id},
                **_cron_kwargs(sched.cron_expr),
                replace_existing=True,
            )
        except Exception as e:
            pass
            
    return sched.to_dict()


@router.patch("/api/schedules/{schedule_id}/toggle")
async def toggle_schedule(schedule_id: str, body: dict = None, session: AsyncSession = Depends(get_session)):
    sched = await session.get(Schedule, schedule_id)
    if not sched:
        raise HTTPException(404, "Schedule không tồn tại")
        
    wf = await session.get(Workflow, sched.workflow_id)
        
    if body and "enabled" in body:
        enabled = body.get("enabled", True)
    else:
        enabled = not sched.enabled
        
    sched.enabled = enabled
    await session.commit()
    
    if enabled:
        try:
            scheduler.add_job(
                trigger_workflow_job,
                "cron",
                id=sched.id,
                kwargs={"workflow_id": sched.workflow_id, "project_id": wf.project_id, "schedule_id": sched.id},
                **_cron_kwargs(sched.cron_expr),
                replace_existing=True,
            )
        except Exception:
            pass
    else:
        try:
            scheduler.remove_job(sched.id)
        except Exception:
            pass
            
    return {"status": "ok", "enabled": enabled}


@router.delete("/api/schedules/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: str, session: AsyncSession = Depends(get_session)):
    sched = await session.get(Schedule, schedule_id)
    if not sched:
        raise HTTPException(404, "Schedule không tồn tại")
        
    try:
        scheduler.remove_job(sched.id)
    except Exception:
        pass
        
    await session.delete(sched)
    await session.commit()
