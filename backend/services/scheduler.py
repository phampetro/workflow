from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import asyncio
from typing import Optional, Callable

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

def _cron_kwargs(expr: str) -> dict:
    parts = expr.split()
    if len(parts) != 5:
        return {}
    return {
        "minute": parts[0],
        "hour": parts[1],
        "day": parts[2],
        "month": parts[3],
        "day_of_week": parts[4],
    }
