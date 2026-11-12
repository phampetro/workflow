"""Kết nối lưu trữ đám mây (Google Drive / OneDrive) cho khối "Tải lên đám mây".

Luồng đăng nhập:
1. FE gọi POST /api/cloud/connections/start → nhận auth_url, mở tab mới.
2. Người dùng đăng nhập + đồng ý quyền trên trang Google/Microsoft.
3. Google/Microsoft redirect về GET /api/cloud/oauth/<provider>/callback (chính
   backend này, loopback) → đổi code lấy refresh token, lưu vào cloud_connection.
4. FE thấy kết nối mới qua GET /api/cloud/connections (poll).
"""
import asyncio
import html
import logging
import sys

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_session
from models import CloudConnection
from services import cloud_oauth_config, cloud_storage

logger = logging.getLogger("pyflow.cloud")
router = APIRouter(prefix="/api/cloud", tags=["Cloud"])

# Host loopback dùng làm redirect_uri. Google chấp nhận mọi cổng với 127.0.0.1;
# Microsoft bỏ qua cổng với "localhost". Cả 2 đều qua được _host_guard của main.py.
_REDIRECT_HOST = {"google": "127.0.0.1", "onedrive": "localhost"}


class StartBody(BaseModel):
    workflow_id: str
    provider: str
    connection_id: str | None = None   # có = đăng nhập lại cho kết nối đã có


def _redirect_uri(request: Request, provider: str) -> str:
    port = request.url.port or (8000 if getattr(sys, "frozen", False) else 7000)
    return f"http://{_REDIRECT_HOST[provider]}:{port}/api/cloud/oauth/{provider}/callback"


@router.get("/providers")
async def providers():
    """Dịch vụ nào đã được cấu hình Client ID (chưa có thì FE ẩn/khoá nút đăng nhập)."""
    return {p: cloud_oauth_config.is_configured(p) for p in cloud_storage.PROVIDERS}


@router.get("/connections")
async def list_connections(workflow_id: str, session: AsyncSession = Depends(get_session)):
    rows = await session.execute(
        select(CloudConnection).where(CloudConnection.workflow_id == workflow_id).order_by(CloudConnection.created_at))
    return [c.to_dict() for c in rows.scalars().all()]


@router.post("/connections/start")
async def start_login(body: StartBody, request: Request):
    if body.provider not in cloud_storage.PROVIDERS:
        raise HTTPException(400, detail={"code": "bad_provider"})
    try:
        url = cloud_storage.build_auth_url(body.provider, _redirect_uri(request, body.provider),
                                           body.workflow_id, body.connection_id)
    except cloud_storage.CloudError as e:
        raise HTTPException(400, detail={"code": e.code, **e.params})
    return {"auth_url": url}


@router.delete("/connections/{connection_id}")
async def delete_connection(connection_id: str, session: AsyncSession = Depends(get_session)):
    conn = await session.get(CloudConnection, connection_id)
    if not conn:
        raise HTTPException(404, detail={"code": "not_found"})
    await session.delete(conn)
    await session.commit()
    return {"status": "ok"}


# Trang trả về sau khi đăng nhập hiển thị trong TAB TRÌNH DUYỆT RIÊNG (ngoài app React,
# không có i18n) nên in song ngữ cố định.
_PAGE = """<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>PyFlow Studio</title>
<style>body{{font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;
align-items:center;justify-content:center;min-height:100vh;margin:0}}
main{{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:440px}}
h1{{font-size:1.15rem;margin:0 0 12px}} p{{margin:6px 0;color:#334155;line-height:1.5}}</style></head>
<body><main><h1>{title}</h1>{body}</main>{script}</body></html>"""


def _page(ok: bool, vi: str, en: str) -> HTMLResponse:
    title = "✅ Đã kết nối / Connected" if ok else "❌ Không kết nối được / Connection failed"
    body = f"<p>{html.escape(vi)}</p><p>{html.escape(en)}</p>"
    script = "<script>setTimeout(()=>window.close(),2500)</script>" if ok else ""
    return HTMLResponse(_PAGE.format(title=title, body=body, script=script), status_code=200 if ok else 400)


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, state: str = "", code: str = "", error: str = "",
                         session: AsyncSession = Depends(get_session)):
    if error:
        return _page(False, f"Bạn đã huỷ hoặc dịch vụ từ chối: {error}",
                     f"Cancelled or rejected by the provider: {error}")
    if provider not in cloud_storage.PROVIDERS or not state or not code:
        return _page(False, "Thiếu thông tin đăng nhập.", "Missing login parameters.")
    try:
        # httpx sync (đổi code lấy token) chặn vài giây → chạy ngoài event loop.
        result = await asyncio.to_thread(cloud_storage.complete_oauth, provider, state, code)
    except cloud_storage.CloudError as e:
        logger.warning("OAuth %s thất bại: %s %s", provider, e.code, e.params)
        if e.code == "bad_state":
            return _page(False, "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy bấm đăng nhập lại trong app.",
                         "The login session expired or is invalid. Start the login again from the app.")
        if e.code == "no_refresh_token":
            return _page(False, "Dịch vụ không cấp quyền dùng lâu dài. Hãy đăng nhập lại và đồng ý mọi quyền.",
                         "No long-term access was granted. Log in again and accept all permissions.")
        return _page(False, f"Lỗi: {e.params.get('detail') or e.code}", f"Error: {e.params.get('detail') or e.code}")

    conn = await session.get(CloudConnection, result["connection_id"]) if result["connection_id"] else None
    if conn and conn.workflow_id == result["workflow_id"] and conn.provider == provider:
        conn.refresh_token = result["refresh_token"]
        conn.account = result["account"]
    else:
        session.add(CloudConnection(workflow_id=result["workflow_id"], provider=provider,
                                    label=result["account"], account=result["account"],
                                    refresh_token=result["refresh_token"]))
    await session.commit()
    who = result["account"] or provider
    return _page(True, f"Đã kết nối {who}. Bạn có thể đóng tab này và quay lại PyFlow Studio.",
                 f"Connected {who}. You can close this tab and return to PyFlow Studio.")
