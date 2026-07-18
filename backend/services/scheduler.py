import json
from datetime import datetime
from typing import Optional, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

scheduler = AsyncIOScheduler()
_run_callback: Optional[Callable] = None

def set_run_callback(cb: Callable):
    global _run_callback
    _run_callback = cb

def start_scheduler():
    if not scheduler.running:
        scheduler.start()

def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown()

async def trigger_workflow_job(workflow_id: str, project_id: str, schedule_id: str):
    if _run_callback:
        await _run_callback(workflow_id, project_id, schedule_id)
    await _record_schedule_run(schedule_id)

async def _record_schedule_run(schedule_id: str):
    """Cập nhật last_run_at và next_run_at sau khi job đã kích hoạt.

    APScheduler đã tính next_run_time cho lần chạy kế tiếp trước khi job này
    được thực thi, nên get_next_run_time() ở đây trả về đúng thời điểm chạy tiếp theo.
    """
    from database import AsyncSessionLocal
    from models import Schedule

    async with AsyncSessionLocal() as session:
        sched = await session.get(Schedule, schedule_id)
        if not sched:
            return
        sched.last_run_at = datetime.now()
        sched.next_run_at = get_next_run_time(schedule_id)
        await session.commit()

def get_next_run_time(schedule_id: str) -> Optional[datetime]:
    """Lấy thời điểm chạy kế tiếp (giờ local, naive) của job từ APScheduler."""
    job = scheduler.get_job(schedule_id)
    if job and job.next_run_time:
        return job.next_run_time.replace(tzinfo=None)
    return None

def build_cron_trigger(cron_expr: str) -> CronTrigger:
    """Chuyển cron_expr thành CronTrigger.

    FE lưu cron_expr dưới dạng chuỗi JSON, ví dụ:
    {"schedule_type": "week", "hour": "08", "minute": "00", "days": ["mon","tue"],
     "day_of_month": 1, "start_date": "2026-01-01", "end_date": null}
    Chuỗi cron chuẩn "phút giờ ngày tháng thứ" vẫn được hỗ trợ để tương thích ngược.
    """
    cron_expr = (cron_expr or "").strip()

    if cron_expr.startswith("{"):
        config = json.loads(cron_expr)
        hour = config.get("hour") or "0"
        minute = config.get("minute") or "0"
        kwargs = {"hour": hour, "minute": minute, "second": 0}

        if config.get("schedule_type") == "month":
            kwargs["day"] = config.get("day_of_month") or 1
        else:
            days = config.get("days") or []
            kwargs["day_of_week"] = ",".join(days) if days else "*"

        start_date = config.get("start_date")
        end_date = config.get("end_date")
        if start_date:
            kwargs["start_date"] = start_date
        if end_date:
            kwargs["end_date"] = f"{end_date} 23:59:59"

        return CronTrigger(**kwargs)

    parts = cron_expr.split()
    if len(parts) != 5:
        raise ValueError(f"cron_expr không hợp lệ: {cron_expr}")
    minute, hour, day, month, day_of_week = parts
    return CronTrigger(minute=minute, hour=hour, day=day, month=month, day_of_week=day_of_week)
