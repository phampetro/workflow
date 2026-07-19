import json
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
import httpx

from database import get_session
from models import Setting

router = APIRouter(tags=["ai_codegen"])

class AiSettingsUpdate(BaseModel):
    ai_base_url: str
    ai_model: str
    ai_api_key: str | None = None
    ai_enabled: bool

class AiGenerateRequest(BaseModel):
    instruction: str
    code: str
    selection: str | None = None
    language: str = "python"
    context: str | None = None

async def get_settings_dict(session: AsyncSession) -> dict:
    result = await session.execute(select(Setting).where(Setting.key.in_([
        "ai_base_url", "ai_model", "ai_api_key", "ai_enabled"
    ])))
    settings = result.scalars().all()
    return {s.key: s.value for s in settings}

@router.get("/api/ai/settings")
async def get_ai_settings(session: AsyncSession = Depends(get_session)):
    s_dict = await get_settings_dict(session)
    has_key = bool(s_dict.get("ai_api_key"))
    
    return {
        "base_url": s_dict.get("ai_base_url", "https://generativelanguage.googleapis.com/v1beta/openai"),
        "model": s_dict.get("ai_model", "gemini-2.0-flash"),
        "enabled": s_dict.get("ai_enabled", "true") == "true",
        "has_key": has_key
    }

@router.put("/api/ai/settings")
async def update_ai_settings(body: AiSettingsUpdate, session: AsyncSession = Depends(get_session)):
    s_dict = await get_settings_dict(session)
    
    updates = {
        "ai_base_url": body.ai_base_url,
        "ai_model": body.ai_model,
        "ai_enabled": "true" if body.ai_enabled else "false",
    }
    
    # Chỉ update api key nếu client có gửi lên
    if body.ai_api_key is not None:
        updates["ai_api_key"] = body.ai_api_key

    for k, v in updates.items():
        setting = await session.get(Setting, k)
        if setting:
            setting.value = v
        else:
            session.add(Setting(key=k, value=v))
            
    await session.commit()
    return {"status": "ok"}

@router.post("/api/ai/test")
async def test_ai_settings(session: AsyncSession = Depends(get_session)):
    s_dict = await get_settings_dict(session)
    base_url = s_dict.get("ai_base_url", "https://generativelanguage.googleapis.com/v1beta/openai")
    model = s_dict.get("ai_model", "gemini-2.0-flash")
    api_key = s_dict.get("ai_api_key")
    
    if not base_url or not model or not api_key:
        raise HTTPException(400, "Cấu hình AI chưa đầy đủ (thiếu URL, model hoặc API Key)")
        
    # Tạo request dummy (OpenAI compatible)
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
        "max_tokens": 5
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(f"{base_url.rstrip('/')}/chat/completions", json=payload, headers=headers, timeout=10)
            if res.status_code != 200:
                raise HTTPException(400, f"Lỗi từ nhà cung cấp: HTTP {res.status_code} - {res.text}")
            return {"status": "ok", "message": "Kết nối thành công!"}
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(400, f"Lỗi kết nối: {str(e)}")

@router.post("/api/ai/generate")
async def generate_ai_code(body: AiGenerateRequest, session: AsyncSession = Depends(get_session)):
    s_dict = await get_settings_dict(session)
    base_url = s_dict.get("ai_base_url", "https://generativelanguage.googleapis.com/v1beta/openai")
    model = s_dict.get("ai_model", "gemini-2.0-flash")
    api_key = s_dict.get("ai_api_key")
    enabled = s_dict.get("ai_enabled", "true") == "true"
    
    if not enabled or not base_url or not model or not api_key:
        raise HTTPException(400, "AI chưa được cấu hình hoặc đã bị tắt")
        
    system_prompt = f"""Bạn là trợ lý lập trình Python cho người dùng trên hệ thống PyFlow Studio (một nền tảng tạo workflow kéo thả).
Bạn đang giúp họ sửa đổi code cho một node Python. Người dùng sẽ cung cấp hướng dẫn (instruction) bằng tiếng Việt.
Code của người dùng chạy trên Python 3. Có một số biến đặc biệt được cung cấp sẵn:
- input_data: Chứa dữ liệu đầu vào (từ block trước)
- output_data: Biến để gán dữ liệu đầu ra
- input_dir: Đường dẫn tới thư mục chứa input
- output_dir: Đường dẫn tới thư mục chứa output

NHIỆM VỤ CỦA BẠN:
- Cung cấp DUY NHẤT mã code Python. Không viết bất kỳ văn bản giải thích nào trước hoặc sau khối mã.
- KHÔNG sử dụng ký tự đánh dấu markdown như ```python hay ``` xung quanh kết quả.
- Giữ nguyên cấu trúc thụt lề (indentation).
- Chỉ thay thế đoạn mã trong vùng lựa chọn (selection) nếu có, hoặc tạo code mới. Cố gắng bảo toàn phần code không liên quan của người dùng.
"""
    
    user_prompt = f"Ngôn ngữ: {body.language}\n"
    if body.code:
        user_prompt += f"Code hiện tại:\n{body.code}\n\n"
    if body.selection:
        user_prompt += f"Đoạn code đang được chọn (cần sửa): {body.selection}\n\n"
        
    user_prompt += f"Yêu cầu: {body.instruction}"
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "stream": True,
        "temperature": 0.2
    }
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    async def event_generator():
        try:
            async with httpx.AsyncClient() as client:
                async with client.stream("POST", f"{base_url.rstrip('/')}/chat/completions", json=payload, headers=headers, timeout=60) as response:
                    if response.status_code != 200:
                        err_text = await response.aread()
                        yield f"data: {json.dumps({'error': f'HTTP {response.status_code}: {err_text.decode()}'})}\n\n"
                        return

                    async for line in response.aiter_lines():
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                yield f"data: {json.dumps({'done': True})}\n\n"
                                break
                            
                            try:
                                chunk = json.loads(data_str)
                                delta = chunk.get("choices", [{}])[0].get("delta", {})
                                content = delta.get("content", "")
                                if content:
                                    yield f"data: {json.dumps({'token': content})}\n\n"
                            except json.JSONDecodeError:
                                pass
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
