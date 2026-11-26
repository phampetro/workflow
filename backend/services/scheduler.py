import asyncio
import json
import logging
from datetime import datetime
from typing import Optional, Callable

from apscheduler.events import EVENT_JOB_MISSED
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger("pyflow.scheduler")

# misfire_grace_time=None + coalesce: tới giờ mà job bị TRỄ (máy ngủ/ngủ đông đúng giờ
# đó, event loop bận, đồng hồ hẹn giờ lệch sau khi máy thức dậy) thì VẪN CHẠY, gộp các
# lượt lỡ thành 1. Mặc định của APScheduler là grace 1 GIÂY: trễ hơn là bỏ qua lặng lẽ,
# chỉ để lại "was missed by" trong log — đúng triệu chứng "đặt giờ mà hôm sau không
# chạy" (gặp thật 11/2026). Workflow đang chạy dở thì trigger_workflow_from_scheduler
# vẫn tự bỏ qua lượt mới, nên chạy bù không gây chạy chồng.
scheduler = AsyncIOScheduler(job_defaults={"misfire_grace_time": None, "coalesce": True, "max_instances": 1})
_run_callback: Optional[Callable] = None
_heartbeat_task: Optional[asyncio.Task] = None

# Nhịp đánh thức scheduler (giây). APScheduler hẹn MỘT timer tới lần chạy kế tiếp (lịch
# hằng ngày: ~24 giờ) theo đồng hồ monotonic của event loop; sau khi máy ngủ dậy hoặc
# chỉnh giờ hệ thống, timer đó có thể kêu lệch hẳn so với giờ thật. Đánh thức mỗi phút
# để scheduler so lại với giờ thật → lịch chạy trễ tối đa ~1 phút thay vì lệch hàng giờ.
HEARTBEAT_SEC = 60


def set_run_callback(cb: Callable):
    global _run_callback
    _run_callback = cb


def _on_job_missed(event):
    logger.warning(f"⏰ Lịch {event.job_id} lỡ giờ chạy {event.scheduled_run_time} (đã quá hạn chờ)")


async def _heartbeat():
    while True:
        await asyncio.sleep(HEARTBEAT_SEC)
        if scheduler.running:
            scheduler.wakeup()


def start_scheduler():
    global _heartbeat_task
    if not scheduler.running:
        scheduler.add_listener(_on_job_missed, EVENT_JOB_MISSED)
        scheduler.start()
    if _heartbeat_task is None or _heartbeat_task.done():
        # Giữ tham chiếu ở biến module: task không ai giữ có thể bị GC giữa chừng.
        _heartbeat_task = asyncio.get_running_loop().create_task(_heartbeat())


def stop_scheduler():
    global _heartbeat_task
    if _heartbeat_task is not None:
        _heartbeat_task.cancel()
        _heartbeat_task = None
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
