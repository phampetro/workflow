"""Hẹn giờ (services/scheduler.py): lượt chạy bị trễ vẫn phải chạy, không bị bỏ qua.

Lỗi thật 11/2026: "đặt giờ mà hôm sau không chạy". APScheduler mặc định chỉ cho trễ
1 GIÂY (misfire_grace_time=1); máy ngủ đúng giờ, event loop bận, hay timer ~24 giờ lệch
sau khi máy thức dậy là lượt đó bị bỏ qua lặng lẽ.
"""
import asyncio
import json
from datetime import datetime, timedelta

from apscheduler.triggers.date import DateTrigger

from services import scheduler as sch


def test_job_defaults_never_drop_late_runs():
    d = sch.scheduler._job_defaults
    assert d["misfire_grace_time"] is None and d["coalesce"] is True and d["max_instances"] == 1


def test_late_run_still_fires_and_heartbeat_wakes_scheduler(monkeypatch):
    monkeypatch.setattr(sch, "HEARTBEAT_SEC", 0.2)
    wakes = []
    real_wakeup = sch.scheduler.wakeup
    monkeypatch.setattr(sch.scheduler, "wakeup", lambda: (wakes.append(1), real_wakeup()))

    async def main():
        ran = []

        async def job():
            ran.append(1)

        sch.start_scheduler()
        try:
            # Lượt đáng lẽ chạy 10 phút trước (máy ngủ đúng giờ đó) → vẫn phải chạy bù.
            sch.scheduler.add_job(job, DateTrigger(run_date=datetime.now() - timedelta(minutes=10)),
                                  id="test-late")
            await asyncio.sleep(1.0)
        finally:
            sch.stop_scheduler()
        return ran

    assert asyncio.run(main()) == [1]
    assert len(wakes) >= 2                      # nhịp đánh thức chạy đều


def test_build_cron_trigger_week_month_and_end_date():
    t = sch.build_cron_trigger(json.dumps({"schedule_type": "week", "hour": "07", "minute": "30",
                                            "days": ["mon", "fri"]}))
    nxt = t.get_next_fire_time(None, datetime(2026, 11, 26, 8, 0).astimezone())   # thứ Năm
    assert (nxt.weekday(), nxt.hour, nxt.minute) == (4, 7, 30)                     # thứ Sáu 07:30

    t = sch.build_cron_trigger(json.dumps({"schedule_type": "month", "hour": "6", "minute": "0",
                                            "day_of_month": 15, "end_date": "2026-12-31"}))
    nxt = t.get_next_fire_time(None, datetime(2026, 11, 26).astimezone())
    assert (nxt.month, nxt.day, nxt.hour) == (12, 15, 6)
    assert t.get_next_fire_time(None, datetime(2027, 1, 1).astimezone()) is None    # hết hạn
