"""Khối Telegram: Gửi tin (telegram) và Lắng nghe (telegram_listener)."""
import json
import threading
import time
import urllib.request
import uuid

from services import executor_blocks as eb
from services.net import https_context

from .context import BREAK, SKIP


# ── Gửi tin ──────────────────────────────────────────────────────────
def _post_json(url, payload, timeout=15):
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout, context=https_context()) as response:
        return json.loads(response.read().decode("utf-8"))


def _tg_send_message(bot_token, chat_id, text, parse_mode, reply_to=None):
    payload = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_to:
        payload["reply_to_message_id"] = reply_to
    return _post_json(f"https://api.telegram.org/bot{bot_token}/sendMessage", payload)


def _tg_edit_message_text(bot_token, chat_id, text, message_id, parse_mode):
    payload = {"chat_id": chat_id, "message_id": message_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    return _post_json(f"https://api.telegram.org/bot{bot_token}/editMessageText", payload)


def _tg_send_document(bot_token, chat_id, file_path, file_name, caption="", parse_mode="", reply_to=None):
    """Gửi file qua sendDocument (multipart/form-data tự dựng, không cần thư viện ngoài)."""
    boundary = uuid.uuid4().hex

    def field(name, value):
        return [f"--{boundary}".encode(), f'Content-Disposition: form-data; name="{name}"'.encode(),
                b"", value.encode() if isinstance(value, str) else value]

    with open(file_path, "rb") as fp:
        file_data = fp.read()
    lines = field("chat_id", chat_id)
    lines += [f"--{boundary}".encode(),
              f'Content-Disposition: form-data; name="document"; filename="{file_name}"'.encode(),
              b"Content-Type: application/octet-stream", b"", file_data]
    if caption:
        lines += field("caption", caption)
    if parse_mode:
        lines += field("parse_mode", parse_mode)
    if reply_to:
        lines += field("reply_to_message_id", str(reply_to))
    lines.append(f"--{boundary}--".encode())

    req = urllib.request.Request(
        f"https://api.telegram.org/bot{bot_token}/sendDocument", data=b"\r\n".join(lines),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60, context=https_context()) as response:
        return json.loads(response.read().decode("utf-8"))


def _resolve_attachments(ctx, step, attachments):
    resolved = []
    for att in attachments:
        # Chỉ nhận TÊN FILE THUẦN. Ô đính kèm đi qua nội suy {{var}}, nên cấu hình
        # ["{{text}}"] + tin nhắn "../../pyflow.db" từng đủ để bot GỬI CẢ DATABASE
        # (mật khẩu DB, API key) cho người lạ.
        att_name = eb.safe_filename(att, "")
        if not att_name:
            continue
        # Tìm trong output trước, rồi input
        att_path = ctx.output_dir / att_name
        if not att_path.exists():
            att_path = ctx.input_dir / att_name
        if att_path.exists() and att_path.is_file():
            resolved.append((att_name, att_path))
        else:
            ctx.log(step.bid, "warning", "tg_attachment_not_found", name=att_name)
    return resolved


def _parse_msg_id(ctx, step, msg_id, log_key):
    """Trả (int | None, Signal | None)."""
    try:
        return int(msg_id), None
    except ValueError:
        ctx.log(step.bid, "error", log_key, label=step.label, msg_id=msg_id)
        return None, ctx.fail(step, f"Message ID phải là số (hiện tại là '{msg_id}')")


def handle_telegram(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    bot_token = bdata.get("telegramBotToken", "").strip()
    chat_id = bdata.get("telegramChatId", "").strip()
    text = bdata.get("telegramMessage", "")
    parse_mode = bdata.get("telegramParseMode", "")
    action = bdata.get("telegramAction", "send")
    msg_id = str(bdata.get("telegramMessageId", ""))

    if not bot_token or not chat_id:
        ctx.log(bid, "error", "tg_missing_config", label=label)
        return ctx.fail(step, "Thiếu Bot Token hoặc Chat ID cho khối Telegram")

    resolved_files = _resolve_attachments(ctx, step, bdata.get("telegramAttachments", []))
    ctx.log(bid, "info", "tg_sending", label=label, chat_id=chat_id)

    try:
        # Chuỗi rỗng = không lỗi; khi lỗi thì mang luôn mô tả để đẩy sang khối Bắt
        # Lỗi (error_detail) chứ không chỉ là cờ bool.
        telegram_error = ""
        last_message_id = None

        if action == "edit":
            if not msg_id:
                ctx.log(bid, "error", "tg_edit_invalid_id", label=label)
                return ctx.fail(step, "Chế độ 'Sửa tin nhắn' yêu cầu Message ID hợp lệ")
            msg_id_int, sig = _parse_msg_id(ctx, step, msg_id, "tg_msg_id_not_number")
            if sig:
                return sig
            res = _tg_edit_message_text(bot_token, chat_id, text, msg_id_int, parse_mode)
            if not res.get("ok"):
                ctx.log(bid, "error", "tg_edit_error", label=label, description=res.get("description"))
                telegram_error = f"Lỗi sửa tin nhắn Telegram: {res.get('description')}"
            else:
                last_message_id = res.get("result", {}).get("message_id")
        else:
            reply_to_id = None
            if action == "reply" and msg_id:
                reply_to_id, sig = _parse_msg_id(ctx, step, msg_id, "tg_msg_id_not_number_short")
                if sig:
                    return sig

            if not resolved_files:
                res = _tg_send_message(bot_token, chat_id, text, parse_mode, reply_to_id)
                if not res.get("ok"):
                    ctx.log(bid, "error", "tg_api_error", label=label, description=res.get("description"))
                    telegram_error = f"Lỗi API Telegram: {res.get('description')}"
                else:
                    last_message_id = res.get("result", {}).get("message_id")
            elif len(resolved_files) == 1:
                fname, fpath = resolved_files[0]
                ctx.log(bid, "info", "tg_attachment_sending", label=label, name=fname)
                res = _tg_send_document(bot_token, chat_id, str(fpath), fname, caption=text,
                                        parse_mode=parse_mode, reply_to=reply_to_id)
                if not res.get("ok"):
                    ctx.log(bid, "error", "tg_send_file_error", label=label, name=fname,
                            description=res.get("description"))
                    telegram_error = f"Lỗi gửi file '{fname}' qua Telegram: {res.get('description')}"
                else:
                    last_message_id = res.get("result", {}).get("message_id")
            else:
                # Nhiều file: gửi text trước (nếu có), rồi từng file
                if text.strip():
                    res = _tg_send_message(bot_token, chat_id, text, parse_mode, reply_to_id)
                    if not res.get("ok"):
                        ctx.log(bid, "error", "tg_send_message_error", label=label,
                                description=res.get("description"))
                        telegram_error = f"Lỗi gửi tin nhắn Telegram: {res.get('description')}"
                    else:
                        last_message_id = res.get("result", {}).get("message_id")

                if not telegram_error:
                    for i, (fname, fpath) in enumerate(resolved_files):
                        ctx.log(bid, "info", "tg_attachment_sending", label=label, name=fname)
                        # File đầu reply tin gốc (nếu text trống và có reply_to_id)
                        cur_reply_to = reply_to_id if (i == 0 and not text.strip()) else None
                        res = _tg_send_document(bot_token, chat_id, str(fpath), fname, reply_to=cur_reply_to)
                        if not res.get("ok"):
                            ctx.log(bid, "error", "tg_send_file_error", label=label, name=fname,
                                    description=res.get("description"))
                            telegram_error = f"Lỗi gửi file '{fname}' qua Telegram: {res.get('description')}"
                            break
                        if not last_message_id:
                            last_message_id = res.get("result", {}).get("message_id")

        if telegram_error:
            return ctx.fail(step, telegram_error)

        ctx.log(bid, "success", "tg_send_success", label=label, message_id=last_message_id)
        # Đổi tên key theo tên biến đặt trên UI. Người dùng đổi tên chat_id thành tên
        # riêng thì chat_id cũ (của Listener / tin nhắn người dùng) KHÔNG bị ghi đè.
        tg_out = eb.rename_output_keys(step.btype, bdata, {
            "sent_message_id": last_message_id,
            "chat_id": chat_id,
        })
        if isinstance(step.current_input, dict):
            # Giữ message_id cũ (tin nhắn người dùng), thêm sent_message_id (tin vừa gửi)
            step.current_input.update(tg_out)
        else:
            step.current_input = {"message_id": last_message_id, **tg_out}
    except Exception as e:
        ctx.log(bid, "error", "tg_send_failed_exception", label=label, error=str(e))
        return ctx.fail(step, f"Telegram gửi thất bại: {e}")


# ── Lắng nghe ────────────────────────────────────────────────────────
def _listener_commands(bdata):
    raw = bdata.get("telegramListenerCommands") or bdata.get("telegramCommands", "")
    if isinstance(raw, list):
        cmds = []
        for c in raw:
            if isinstance(c, dict):
                cmds.append({
                    "command": (c.get("command") or "").strip(),
                    "description": c.get("description", ""),
                    "reply": c.get("reply", ""),
                    "runWorkflow": bool(c.get("runWorkflow", False)),
                })
            else:
                cmds.append({"command": str(c).strip(), "reply": "", "runWorkflow": True})
        return cmds
    return [{"command": c.strip(), "reply": "", "runWorkflow": True}
            for c in str(raw).split(",") if c.strip()]


def _start_listener_thread(ctx, tg_token, tg_commands):
    """Chạy listener trong thread riêng có event loop riêng (thread executor không có loop)."""
    from services.telegram_listener import start_telegram_listener

    def _run():
        import asyncio
        from services.telegram_listener import (
            _active_configs as cfg_map, _active_listeners as listeners_map, _stop_events as stops_map,
        )
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        task = None
        try:
            # start_telegram_listener chỉ tạo task nền rồi trả về ngay, nên phải tự giữ
            # loop sống bằng run_until_complete chính task đó.
            loop.run_until_complete(start_telegram_listener(
                project_id=ctx.project_id, workflow_id=ctx.workflow_id,
                workflow_name=ctx.workflow_name, graph_json=ctx.graph_json,
                bot_token=tg_token, commands=tg_commands,
            ))
            task = listeners_map.get(ctx.workflow_id)
            if task:
                try:
                    loop.run_until_complete(task)
                except asyncio.CancelledError:
                    pass
        finally:
            # CHỈ dọn khi bảng còn trỏ tới ĐÚNG task này (so danh tính `is`). Thread
            # cũ có thể chết muộn (kẹt long-poll 30s) sau khi người dùng đã Chạy lại
            # và listener MỚI đã đăng ký cùng key. Pop theo key sẽ xoá mất listener
            # mới → lần sau bật listener thứ 2 cùng token, MỖI TIN NHẮN chạy 2 lần.
            if listeners_map.get(ctx.workflow_id) is task:
                listeners_map.pop(ctx.workflow_id, None)
                stops_map.pop(ctx.workflow_id, None)
                cfg_map.pop(ctx.workflow_id, None)
            loop.close()

    threading.Thread(target=_run, daemon=True, name=f"tg-listener-{ctx.workflow_id}").start()


def _wait_until(predicate, tries, interval=0.1):
    for _ in range(tries):
        if predicate():
            return True
        time.sleep(interval)
    return False


def handle_telegram_listener(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label

    if "_initial_input" in bdata:
        # Run được kích hoạt bởi tin nhắn tới: đổi tên key theo tên biến trên UI
        # (raw_message giữ nguyên vì không có field đặt tên). workflow_env được cập
        # nhật ở vòng lặp chính qua workflow_env.update(current_input).
        ctx.log(bid, "info", "tg_listener_received", label=label)
        step.current_input = eb.rename_output_keys(step.btype, bdata, bdata["_initial_input"])
        return None

    # Bấm Chạy thủ công → bật Listener, workflow giữ RUNNING chờ tin nhắn.
    ctx.log(bid, "info", "tg_listener_enabling", label=label)
    try:
        from services.telegram_listener import get_listener_config, is_listener_running
        wf_id = ctx.workflow_id
        tg_token = bdata.get("telegramListenerToken") or bdata.get("telegramBotToken", "")
        tg_commands = _listener_commands(bdata)

        # Listener đang chạy nhưng token/commands đã đổi → dừng cái cũ để bật lại
        # với cấu hình mới (tránh sửa token rồi Chạy lại mà vẫn dùng token cũ).
        if is_listener_running(wf_id):
            cur_cfg = get_listener_config(wf_id) or {}
            if cur_cfg.get("token") != tg_token or cur_cfg.get("commands") != tg_commands:
                ctx.log(bid, "info", "tg_listener_config_changed")
                eb._stop_telegram_listener_sync(wf_id, log_fn=ctx.log_fn, language=ctx.language)
                _wait_until(lambda: not is_listener_running(wf_id), 20)

        if not is_listener_running(wf_id):
            _start_listener_thread(ctx, tg_token, tg_commands)
            # Chờ listener ĐĂNG KÝ được rồi mới ghi cờ persist. Trước đây set cờ ngay:
            # Bot Token sai → listener chết sau ~1s nhưng listener_on vẫn = 1, mỗi lần
            # restart backend lại hồi sinh đúng cái xác đó.
            if not _wait_until(lambda: is_listener_running(wf_id), 60):   # tối đa 6s
                eb._set_workflow_listener_flag(wf_id, False)
                return ctx.block_failed(
                    step, "Không bật được Telegram Listener (kiểm tra Bot Token và kết nối mạng)")
            eb._set_workflow_listener_flag(wf_id, True)
            ctx.log(bid, "success", "tg_listener_enabled")
        else:
            eb._set_workflow_listener_flag(wf_id, True)
            ctx.log(bid, "info", "tg_listener_already_running")
    except Exception as e:
        ctx.log(bid, "warning", "tg_listener_enable_error", error=e)

    # Listener chỉ tắt khi người dùng bấm Dừng — run giữ RUNNING trong lúc chờ, không
    # tự "hoàn thành" khi chưa chạm khối End. Đánh dấu run chỉ còn nhiệm vụ giữ
    # listener sống → scheduler được phép dừng nó để chạy lịch.
    from services.telegram_listener import is_listener_running
    eb._listener_holder_runs.add(ctx.run_id)
    while True:
        if ctx.stopped():
            ctx.log(bid, "warning", "tg_listener_stopping")
            eb._stop_telegram_listener_sync(ctx.workflow_id, log_fn=ctx.log_fn, language=ctx.language)
            eb._set_workflow_listener_flag(ctx.workflow_id, False)
            ctx.final_status = "stopped"
            return BREAK
        # Listener có thể chết giữa chừng (token bị thu hồi, mất mạng dài...). Trước
        # đây vòng này chỉ nhìn stop_event nên run treo RUNNING vô hạn, chiếm 1 worker.
        if not is_listener_running(ctx.workflow_id):
            eb._set_workflow_listener_flag(ctx.workflow_id, False)
            ctx.log(bid, "error", "tg_listener_dead")
            ctx.final_status = "error"
            ctx.final_error = "Telegram Listener ngừng hoạt động ngoài ý muốn"
            return BREAK
        time.sleep(0.5)


HANDLERS = {
    "telegram": handle_telegram,
    "telegram_listener": handle_telegram_listener,
}
