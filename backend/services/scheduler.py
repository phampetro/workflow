"""
APScheduler Service — Quản lý lịch chạy định kỳ cho workflows.
"""
import json
import asyncio
import logging
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from croniter import croniter

logger = logging.getLogger("pyflow.scheduler")

# Scheduler toàn cục
scheduler = AsyncIOScheduler(timezone="Asia/Ho_Chi_Minh")

# Callback sẽ được inject từ main.py khi startup
_run_workflow_callback = None


def set_run_callback(callback):
    """Inject callback để scheduler có thể gọi run workflow"""
    global _run_workflow_callback
    _run_workflow_callback = callback


async def _trigger_workflow(schedule_id: str, workflow_id: str, project_id: str):
    """Hàm được gọi bởi scheduler khi đến giờ"""
    logger.info(f"⏰ Scheduler trigger: schedule={schedule_id}, workflow={workflow_id}")
    if _run_workflow_callback:
        await _run_workflow_callback(
            workflow_id=workflow_id,
            project_id=project_id,
            triggered_by=f"schedule:{schedule_id}",
        )


def add_schedule(schedule_id: str, workflow_id: str, project_id: str, cron_expr: str):
    """Thêm job vào scheduler"""
    try:
        # Xóa job cũ nếu tồn tại
        remove_schedule(schedule_id)

        trigger = CronTrigger.from_crontab(cron_expr, timezone="Asia/Ho_Chi_Minh")
        scheduler.add_job(
            _trigger_workflow,
            trigger=trigger,
            id=schedule_id,
            kwargs={
                "schedule_id": schedule_id,
                "workflow_id": workflow_id,
                "project_id": project_id,
            },
            replace_existing=True,
            misfire_grace_time=60,
        )
        logger.info(f"✅ Đã thêm schedule: {schedule_id} ({cron_expr})")
    except Exception as e:
        logger.error(f"❌ Lỗi thêm schedule {schedule_id}: {e}")
        raise


def remove_schedule(schedule_id: str):
    """Xóa job khỏi scheduler"""
    try:
        if scheduler.get_job(schedule_id):
            scheduler.remove_job(schedule_id)
            logger.info(f"🗑 Đã xóa schedule: {schedule_id}")
    except Exception:
        pass


def pause_schedule(schedule_id: str):
    """Tạm dừng schedule"""
    try:
        job = scheduler.get_job(schedule_id)
        if job:
            job.pause()
    except Exception:
        pass


def resume_schedule(schedule_id: str):
    """Tiếp tục schedule"""
    try:
        job = scheduler.get_job(schedule_id)
        if job:
            job.resume()
    except Exception:
        pass


def get_next_run(cron_expr: str) -> Optional[datetime]:
    """Tính thời gian chạy tiếp theo từ cron expression"""
    try:
        cron = croniter(cron_expr, datetime.now())
        return cron.get_next(datetime)
    except Exception:
        return None


def list_jobs() -> list:
    """Liệt kê tất cả jobs đang chạy"""
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id": job.id,
            "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
            "pending": job.pending,
        })
    return jobs


def start_scheduler():
    """Khởi động scheduler"""
    if not scheduler.running:
        scheduler.start()
        logger.info("🟢 APScheduler đã khởi động")


def stop_scheduler():
    """Dừng scheduler"""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("🔴 APScheduler đã dừng")
