"""
WebSocket Log Streaming
"""
import asyncio
import json
from typing import Dict, Set
from fastapi import WebSocket

# Lưu danh sách clients đang kết nối theo run_id
_connections: Dict[str, Set[WebSocket]] = {}


async def connect(run_id: str, websocket: WebSocket):
    await websocket.accept()
    if run_id not in _connections:
        _connections[run_id] = set()
    _connections[run_id].add(websocket)


def disconnect(run_id: str, websocket: WebSocket):
    if run_id in _connections:
        _connections[run_id].discard(websocket)
        if not _connections[run_id]:
            del _connections[run_id]


async def broadcast_log(run_id: str, block_id: str, level: str, message: str):
    """Gửi log tới tất cả clients đang theo dõi run này"""
    if run_id not in _connections:
        return

    payload = json.dumps({
        "run_id": run_id,
        "block_id": block_id,
        "level": level,
        "message": message,
        "timestamp": asyncio.get_event_loop().time(),
    })

    dead = set()
    for ws in _connections[run_id]:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)

    for ws in dead:
        _connections[run_id].discard(ws)


def make_log_callback(run_id: str):
    """Tạo callback function để truyền vào executor"""
    async def callback(block_id: str, level: str, message: str):
        await broadcast_log(run_id, block_id, level, message)
    return callback
