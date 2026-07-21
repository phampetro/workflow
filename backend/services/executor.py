import asyncio
import uuid
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Any

from services.executor_blocks import execute_workflow_thread

logger = logging.getLogger("pyflow.executor")

# Executor riêng cho workflow threads. Không dùng default ThreadPoolExecutor của asyncio
# (mặc định ~min(32, cpu+4)) vì khối telegram_listener chờ ở dạng `while True: sleep(0.5)`,
# chiếm chỗ 1 worker đến khi bấm Dừng. Nếu bật nhiều listener song song sẽ cạn pool và
# mọi workflow mới bị treo im lặng, kèm mọi create_venv/install_package (cũng qua to_thread).
_WORKFLOW_EXECUTOR = ThreadPoolExecutor(max_workers=256, thread_name_prefix="wf-exec")

async def execute_workflow(
    project_id: str,
    workflow_id: str,
    run_id: str,
    workflow_name: str,
    graph_json: str,
    log_callback: Callable,
    stop_flag: asyncio.Event
) -> dict:
    loop = asyncio.get_running_loop()

    # Bridge để chuyển log từ thread đồng bộ sang coroutine bất đồng bộ
    def sync_log_cb(block_id, level, msg):
        asyncio.run_coroutine_threadsafe(
            log_callback(block_id, level, msg),
            loop
        )

    class SyncStopEvent:
        def is_set(self):
            return stop_flag.is_set()

        def set(self):
            # Có thể được gọi từ thread khác (kill_run) — phải qua call_soon_threadsafe
            loop.call_soon_threadsafe(stop_flag.set)

    try:
        result = await loop.run_in_executor(
            _WORKFLOW_EXECUTOR,
            execute_workflow_thread,
            run_id,
            project_id,
            workflow_id,
            workflow_name,
            graph_json,
            sync_log_cb,
            SyncStopEvent()
        )
        return result
    except Exception as e:
        logger.error(f"Error in execute_workflow: {e}")
        return {"status": "error", "error": str(e)}
