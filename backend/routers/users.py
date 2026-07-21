import uuid
from datetime import datetime
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_session
from models import User, Project, Workflow, Schedule

router = APIRouter(prefix="/api/users", tags=["users"])

@router.get("")
async def list_users(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(User).order_by(User.created_at.desc()))
    return [u.to_dict() for u in result.scalars().all()]


@router.get("/{user_id}/stats")
async def get_user_stats(user_id: str, session: AsyncSession = Depends(get_session)):
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User không tồn tại")

    # Đếm projects
    projects = (await session.execute(select(Project).where(Project.user_id == user_id))).scalars().all()
    project_ids = [p.id for p in projects]

    # Đếm workflows
    if project_ids:
        workflows = (await session.execute(select(Workflow).where(Workflow.project_id.in_(project_ids)))).scalars().all()
        workflow_ids = [w.id for w in workflows]
    else:
        workflows = []
        workflow_ids = []

    # Đếm schedules
    if workflow_ids:
        schedules = (await session.execute(select(Schedule).where(Schedule.workflow_id.in_(workflow_ids)))).scalars().all()
    else:
        schedules = []

    return {
        "project_count": len(projects),
        "workflow_count": len(workflows),
        "schedule_count": len(schedules),
    }


@router.post("", status_code=201)
async def create_user(body: dict, session: AsyncSession = Depends(get_session)):
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "Tên người dùng không được để trống")
        
    user = User(
        id=str(uuid.uuid4()),
        name=name,
        is_active=False,
        created_at=datetime.now()
    )
    session.add(user)
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(400, "Tên người dùng đã tồn tại")
        
    await session.refresh(user)
    return user.to_dict()


@router.delete("/{user_id}", status_code=204)
async def delete_user(user_id: str, session: AsyncSession = Depends(get_session)):
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User không tồn tại")
        
    if user.is_active:
        raise HTTPException(400, "Không thể xóa user đang active")
        
    await session.delete(user)
    await session.commit()


@router.post("/{user_id}/activate")
async def activate_user(user_id: str, session: AsyncSession = Depends(get_session)):
    from database import AsyncSessionLocal

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User không tồn tại")

    # Dừng listener của user cũ (thuộc mọi workflow trong DB đang có cờ listener_on)
    # trước khi chuyển sang user mới - để listener không tiếp tục nhận tin nhắn cho
    # workspace không còn active.
    try:
        from services.telegram_listener import _active_listeners, stop_telegram_listener
        running_wf_ids = list(_active_listeners.keys())
        for wf_id in running_wf_ids:
            try:
                await stop_telegram_listener(wf_id)
            except Exception:
                pass
    except Exception:
        pass

    # Deactivate all
    users = await session.execute(select(User))
    for u in users.scalars().all():
        u.is_active = False

    user.is_active = True
    await session.commit()

    schedules_loaded = 0
    listeners_loaded = 0
    # Reload schedules + listeners của user mới
    try:
        async with AsyncSessionLocal() as new_session:
            from sqlalchemy import select as sa_select, update as sa_update
            from models import User as U, Schedule, Workflow, Project

            active_user = (await new_session.execute(
                sa_select(U).where(U.is_active == True)
            )).scalars().first()

            if active_user:
                from services.scheduler import scheduler as aps_scheduler, trigger_workflow_job, build_cron_trigger, get_next_run_time
                aps_scheduler.remove_all_jobs()

                stmt = sa_select(Schedule, Workflow.project_id).join(
                    Workflow, Schedule.workflow_id == Workflow.id
                ).join(
                    Project, Workflow.project_id == Project.id
                ).where(Schedule.enabled == True, Project.user_id == active_user.id)

                rows = (await new_session.execute(stmt)).all()
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
                        schedules_loaded += 1
                    except Exception:
                        pass
                await new_session.commit()

                # Bật lại các Telegram Listener của user mới
                wf_stmt = sa_select(Workflow.id).join(
                    Project, Workflow.project_id == Project.id
                ).where(Workflow.listener_on == True, Project.user_id == active_user.id)
                listener_wf_ids = [row[0] for row in (await new_session.execute(wf_stmt)).all()]
                if listener_wf_ids:
                    await new_session.execute(
                        sa_update(Workflow).where(Workflow.id.in_(listener_wf_ids)).values(listener_on=False)
                    )
                    await new_session.commit()
                    from routers.workflows import schedule_run_on_main_loop
                    for wf_id in listener_wf_ids:
                        try:
                            schedule_run_on_main_loop(wf_id, triggered_by="listener_autostart")
                            listeners_loaded += 1
                        except Exception:
                            pass
    except Exception:
        pass

    return {"status": "ok", "schedules_loaded": schedules_loaded, "listeners_loaded": listeners_loaded}
