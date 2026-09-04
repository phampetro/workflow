import asyncio
import collections
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Deque, Dict, Set

logger = logging.getLogger("pyflow.log_socket")

# Trần số dòng log giữ trong RAM cho MỖI run.
# Bắt buộc phải có trần: _run_history chỉ được dọn bởi cleanup_log() khi run KẾT
# THÚC, mà run giữ Telegram Listener thì sống hàng ngày/hàng tuần và vẫn sinh log
# đều — list cũ không giới hạn nên RAM chỉ có tăng. Một khối Python lỡ in
# `for i in range(2_000_000): print(i)` cũng đủ làm phình vài trăm MB, rồi
# routers/workflows.py còn `",".join(history)` nhân đôi lần nữa để ghi logs_json.
MAX_HISTORY_LINES = 5000

# run_id -> set of asyncio.Queue
_log_queues: Dict[str, Set[asyncio.Queue]] = {}
_run_history: Dict[str, Deque[str]] = {}
# Số dòng đã bị đẩy khỏi deque của từng run. Cần để quy đổi `offset` tuyệt đối mà
# client SSE gửi lên (nó đếm theo tổng số dòng từ đầu run) sang chỉ số trong deque.
_run_dropped: Dict[str, int] = {}


async def subscribe(run_id: str, queue: asyncio.Queue):
    """Subscribe a queue to receive logs for a run"""
    if run_id not in _log_queues:
        _log_queues[run_id] = set()
    _log_queues[run_id].add(queue)

async def unsubscribe(run_id: str, queue: asyncio.Queue):
    """Unsubscribe a queue from receiving logs"""
    if run_id in _log_queues:
        _log_queues[run_id].discard(queue)
        if not _log_queues[run_id]:
            del _log_queues[run_id]

def cleanup_log(run_id: str):
    """Xóa log khỏi bộ nhớ sau khi lưu vào database"""
    _run_history.pop(run_id, None)
    _run_dropped.pop(run_id, None)

async def broadcast_log(run_id: str, block_id: str, level: str, message: str):
    payload = json.dumps({
        "run_id": run_id,
        "block_id": block_id,
        "level": level,
        "message": message,
        # "time" = GIỜ THỰC lúc sinh ra dòng log, ISO kèm timezone. Bắt buộc phải
        # có: FE hiển thị theo field này. Trước đây chỉ gửi "timestamp" (đồng hồ
        # monotonic) nên FE không tìm thấy "time" và rơi vào nhánh dự phòng
        # `new Date()` — mở log của run đã xong thì SSE replay cả lịch sử trong
        # vài chục ms nên MỌI dòng bị đóng dấu bằng giờ lúc mở view.
        "time": datetime.now().astimezone().isoformat(),
        # Đồng hồ monotonic, chỉ để đo khoảng cách giữa 2 dòng. KHÔNG phải giờ
        # thực, đừng dùng để hiển thị.
        "timestamp": asyncio.get_running_loop().time(),
    })

    hist = _run_history.get(run_id)
    if hist is None:
        hist = collections.deque(maxlen=MAX_HISTORY_LINES)
        _run_history[run_id] = hist
        _run_dropped[run_id] = 0

    # deque(maxlen) tự đẩy dòng cũ nhất ra khi đầy — phải tự đếm để get_run_history
    # quy đổi được offset tuyệt đối của client.
    if len(hist) == hist.maxlen:
        if _run_dropped[run_id] == 0:
            logger.warning(
                f"Run {run_id}: log vượt {MAX_HISTORY_LINES} dòng, bắt đầu cắt bớt dòng cũ nhất trong RAM."
            )
        _run_dropped[run_id] += 1
    hist.append(payload)

    if run_id in _log_queues:
        # Put to all queues
        for q in list(_log_queues[run_id]):
            await q.put(payload)

def get_run_history(run_id: str, offset: int = 0) -> list:
    """Read run history from memory or database.

    `offset` là chỉ số TUYỆT ĐỐI theo tổng số dòng từ đầu run (client SSE tự đếm số
    dòng đã nhận). Vì deque có thể đã đẩy bớt dòng cũ, phải trừ đi số dòng đã mất
    mới ra chỉ số thật trong deque. offset nhỏ hơn số dòng đã mất nghĩa là client
    kết nối lại quá muộn — trả về từ dòng cũ nhất còn giữ, hơn là trả rỗng.
    """
    hist = _run_history.get(run_id)
    if hist is not None:
        start = max(0, offset - _run_dropped.get(run_id, 0))
        return list(hist)[start:]

    # Not in memory -> Run has finished. Read from SQLite.
    from database import connect_sqlite
    try:
        from services.venv_manager import DATA_DIR
        db_path = DATA_DIR / "pyflow.db"
        if db_path.exists():
            with connect_sqlite() as conn:
                row = conn.execute("SELECT logs_json FROM workflow_run WHERE id=?", (run_id,)).fetchone()
                if row and row[0]:
                    try:
                        logs = json.loads(row[0])
                        # Return as list of JSON strings to match memory format
                        return [json.dumps(log) for log in logs][offset:]
                    except json.JSONDecodeError as e:
                        # Không nuốt im lặng: mở log của run cũ mà thấy trống trơn thì
                        # phải có dấu vết ở server log để còn lần ra.
                        logger.warning(f"logs_json của run {run_id} hỏng, không parse được: {e}")
    except Exception as e:
        logger.warning(f"Không đọc được logs_json của run {run_id} từ DB: {e}")

    return []


def make_log_callback(run_id: str):
    """Tạo callback function để truyền vào executor"""
    async def callback(block_id: str, level: str, message: str):
        await broadcast_log(run_id, block_id, level, message)
    return callback
