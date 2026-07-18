import asyncio
import json
import os
from pathlib import Path
from typing import Dict, Set

# run_id -> set of asyncio.Queue
_log_queues: Dict[str, Set[asyncio.Queue]] = {}
_run_history: Dict[str, list] = {}



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
    if run_id in _run_history:
        del _run_history[run_id]

async def broadcast_log(run_id: str, block_id: str, level: str, message: str):
    payload = json.dumps({
        "run_id": run_id,
        "block_id": block_id,
        "level": level,
        "message": message,
        "timestamp": asyncio.get_event_loop().time(),
    })
    
    if run_id not in _run_history:
        _run_history[run_id] = []
    _run_history[run_id].append(payload)

    if run_id in _log_queues:
        # Put to all queues
        for q in list(_log_queues[run_id]):
            await q.put(payload)

def get_run_history(run_id: str, offset: int = 0) -> list:
    """Read run history from memory or database"""
    if run_id in _run_history:
        return _run_history[run_id][offset:]
    
    # Not in memory -> Run has finished. Read from SQLite.
    import sqlite3
    try:
        from services.venv_manager import DATA_DIR
        db_path = DATA_DIR / "pyflow.db"
        if db_path.exists():
            with sqlite3.connect(str(db_path)) as conn:
                row = conn.execute("SELECT logs_json FROM workflow_run WHERE id=?", (run_id,)).fetchone()
                if row and row[0]:
                    try:
                        logs = json.loads(row[0])
                        # Return as list of JSON strings to match memory format
                        return [json.dumps(log) for log in logs][offset:]
                    except json.JSONDecodeError:
                        pass
    except Exception:
        pass
            
    return []


def make_log_callback(run_id: str):
    """Tạo callback function để truyền vào executor"""
    async def callback(block_id: str, level: str, message: str):
        await broadcast_log(run_id, block_id, level, message)
    return callback
