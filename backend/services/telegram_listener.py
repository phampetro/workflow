import asyncio
import logging
import httpx
from typing import Dict
from services.executor import execute_workflow

logger = logging.getLogger("pyflow.telegram_listener")

# Lưu trữ các task listener đang chạy (workflow_id -> Task)
_active_listeners: Dict[str, asyncio.Task] = {}
# Lưu trữ cờ dừng (workflow_id -> Event)
_stop_events: Dict[str, asyncio.Event] = {}

async def _send_telegram_reply(client: httpx.AsyncClient, bot_token: str, chat_id, text: str):
    """Gửi tin nhắn trả lời trực tiếp (dùng cho lệnh không bật runWorkflow).

    Hỗ trợ định dạng HTML của Telegram (in đậm <b>, in nghiêng <i>, link <a>...),
    giống hệt khối Telegram gửi tin thường. Nếu nội dung HTML không hợp lệ,
    Telegram trả lỗi 400 -> tự động gửi lại dạng văn bản thuần để không mất tin nhắn.
    """
    if not text or chat_id is None:
        return
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        resp = await client.post(url, data={"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
        data = resp.json()
        if not data.get("ok"):
            logger.warning(f"Gửi reply HTML thất bại ({data.get('description')}), thử lại dạng văn bản thuần")
            await client.post(url, data={"chat_id": chat_id, "text": text})
    except Exception as e:
        logger.error(f"Lỗi gửi reply Telegram: {e}")


async def _set_bot_commands(client: httpx.AsyncClient, bot_token: str, commands: list):
    """Đăng ký danh sách lệnh "/" với Telegram (menu gõ lệnh của bot).

    Gọi setMyCommands sẽ THAY THẾ HOÀN TOÀN danh sách lệnh cũ đã đăng ký trước đó
    (theo đúng cơ chế của Telegram Bot API), không cộng dồn.
    Chỉ những dòng lệnh hợp lệ (bắt đầu bằng "/", có mô tả) mới được đăng ký -
    dòng để trống/"*" (khớp mọi tin nhắn) chỉ dùng nội bộ, Telegram không cho đăng ký kiểu này.
    """
    telegram_commands = []
    for entry in commands:
        cmd = (entry.get("command") or "").strip()
        desc = (entry.get("description") or "").strip()
        if not cmd or cmd == "*" or not cmd.startswith("/") or not desc:
            continue
        cmd_name = cmd[1:].lower()
        if not cmd_name:
            continue
        telegram_commands.append({"command": cmd_name, "description": desc[:256]})

    try:
        resp = await client.post(
            f"https://api.telegram.org/bot{bot_token}/setMyCommands",
            json={"commands": telegram_commands}
        )
        data = resp.json()
        if not data.get("ok"):
            logger.warning(f"setMyCommands thất bại: {data.get('description')}")
        else:
            logger.info(f"✅ Đã đăng ký {len(telegram_commands)} lệnh với Telegram: {[c['command'] for c in telegram_commands]}")
    except Exception as e:
        logger.error(f"Lỗi khi đăng ký lệnh Telegram: {e}")


async def _telegram_listener_loop(
    project_id: str,
    workflow_id: str,
    workflow_name: str,
    graph_json: str,
    bot_token: str,
    commands: list,
    stop_event: asyncio.Event
):
    """
    Vòng lặp long-polling để nhận tin nhắn Telegram.
    Sử dụng httpx để gọi API getUpdates.

    commands: list các dict {"command": str, "reply": str, "runWorkflow": bool}.
    - runWorkflow=True  -> chạy tiếp workflow từ khối Listener (có _initial_input).
    - runWorkflow=False -> chỉ gửi lại "reply" cho người dùng, không chạy workflow.
    """
    url = f"https://api.telegram.org/bot{bot_token}/getUpdates"
    offset = 0
    timeout = 30  # seconds long-polling

    logger.info(f"🎧 Đang bắt đầu Telegram Listener cho Workflow {workflow_name} ({workflow_id})")
    logger.info(f"   Commands: {commands}")

    async with httpx.AsyncClient(timeout=timeout + 5) as client:
        await _set_bot_commands(client, bot_token, commands)

        while not stop_event.is_set():
            try:
                response = await client.get(url, params={"offset": offset, "timeout": timeout})
                if response.status_code == 200:
                    data = response.json()
                    if not data.get("ok"):
                        logger.error(f"Telegram API Error: {data.get('description')}")
                        await asyncio.sleep(5)
                        continue
                        
                    for update in data.get("result", []):
                        offset = update["update_id"] + 1
                        message = update.get("message") or update.get("channel_post")
                        if message:
                            text = message.get("text", "") or ""
                            # Tìm lệnh khớp với tin nhắn (nếu không cấu hình lệnh nào -> khớp tất cả)
                            matched = None
                            if commands:
                                for entry in commands:
                                    cmd = (entry.get("command") or "").strip()
                                    if cmd == "*" or cmd == "" or text.startswith(cmd):
                                        matched = entry
                                        break
                            else:
                                matched = {"command": "*", "reply": "", "runWorkflow": True}

                            if not matched:
                                logger.debug(f"   Bỏ qua tin nhắn không khớp lệnh: {text[:50]}")
                                continue

                            logger.info(f"📩 Nhận tin nhắn khớp lệnh '{matched.get('command')}' (Update ID: {update['update_id']})")

                            if not matched.get("runWorkflow"):
                                # Lệnh không bật "Chạy workflow" -> chỉ trả lời mặc định, không chạy workflow
                                chat_id = message.get("chat", {}).get("id")
                                await _send_telegram_reply(client, bot_token, chat_id, matched.get("reply", ""))
                                continue

                            # Cấu trúc initial_input để truyền vào workflow
                            initial_input = {
                                "chat_id": message.get("chat", {}).get("id"),
                                "message_id": message.get("message_id"),
                                "text": message.get("text", ""),
                                "sender_name": message.get("from", {}).get("first_name", "") if message.get("from") else "",
                                "raw_message": message
                            }
                            
                            # Ghi đè vào graph_json để truyền _initial_input
                            import json
                            try:
                                graph = json.loads(graph_json)
                                for node in graph.get("nodes", []):
                                    if node.get("data", {}).get("type") == "telegram_listener":
                                        node["data"]["_initial_input"] = initial_input
                                modified_graph_json = json.dumps(graph)
                            except Exception as e:
                                logger.error(f"Lỗi khi inject initial_input vào graph: {e}")
                                modified_graph_json = graph_json
                            
                            # Gọi thực thi Workflow
                            import uuid
                            run_id = str(uuid.uuid4())
                            
                            # Tạo dummy log_callback
                            async def dummy_log(block_id, level, msg):
                                pass
                                
                            wf_stop_event = asyncio.Event()
                            
                            # Kích hoạt workflow trong background
                            asyncio.create_task(
                                execute_workflow(
                                    project_id=project_id,
                                    workflow_id=workflow_id,
                                    run_id=run_id,
                                    workflow_name=workflow_name,
                                    graph_json=modified_graph_json,
                                    log_callback=dummy_log,
                                    stop_flag=wf_stop_event
                                )
                            )
                elif response.status_code == 401:
                    logger.error(f"Bot Token không hợp lệ cho Workflow {workflow_id}. Đang dừng Listener.")
                    break
                else:
                    await asyncio.sleep(5)
            
            except httpx.ReadTimeout:
                # Long polling timeout (bình thường)
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Lỗi trong quá trình lắng nghe Telegram: {e}")
                await asyncio.sleep(5)
                
    logger.info(f"⏹ Đã dừng Telegram Listener cho Workflow {workflow_name} ({workflow_id})")


async def start_telegram_listener(
    project_id: str,
    workflow_id: str,
    workflow_name: str,
    graph_json: str,
    bot_token: str,
    commands: list = None
) -> bool:
    """Bắt đầu listener mới."""
    await stop_telegram_listener(workflow_id)  # Dừng listener cũ nếu có
    
    if commands is None:
        commands = []
    
    stop_event = asyncio.Event()
    _stop_events[workflow_id] = stop_event
    
    task = asyncio.create_task(
        _telegram_listener_loop(
            project_id=project_id,
            workflow_id=workflow_id,
            workflow_name=workflow_name,
            graph_json=graph_json,
            bot_token=bot_token,
            commands=commands,
            stop_event=stop_event
        )
    )
    _active_listeners[workflow_id] = task
    return True

async def stop_telegram_listener(workflow_id: str) -> bool:
    """Dừng listener đang chạy."""
    if workflow_id in _stop_events:
        _stop_events[workflow_id].set()
        del _stop_events[workflow_id]
        
    if workflow_id in _active_listeners:
        task = _active_listeners[workflow_id]
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        del _active_listeners[workflow_id]
        return True
    return False

def is_listener_running(workflow_id: str) -> bool:
    return workflow_id in _active_listeners
