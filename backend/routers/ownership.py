"""Kiểm chủ sở hữu tài nguyên theo header X-User-Id.

⚠ Đây là HÀNG RÀO CHỐNG NHẦM LẪN, KHÔNG phải xác thực.
`X-User-Id` do chính client tự khai (đọc từ localStorage), không có session/token
nên bất kỳ ai gọi được API cũng tự đặt được header này. Mục tiêu ở đây là chặn
thao tác nhầm chéo workspace — ví dụ một tab còn mở của user cũ bấm Xoá project
sau khi đã activate user khác.

Chỉ chặn khi header CÓ MẶT và LỆCH chủ sở hữu. Thiếu header thì cho qua, vì:
  * link Export dùng `window.location.href` nên trình duyệt không gửi header nào;
  * các request phát ra trước lúc người dùng chọn user cũng chưa có header
    (axios interceptor chỉ gắn khi `currentUser?.id` tồn tại).
Siết chặt hơn mà không có auth thật sẽ chỉ làm gãy các luồng đó chứ không tăng
được mức an toàn.
"""
from fastapi import HTTPException
from sqlalchemy import select

from models import Project, Workflow


async def _owner_of_project(session, project_id: str):
    return (await session.execute(
        select(Project.user_id).where(Project.id == project_id)
    )).scalars().first()


async def _owner_of_workflow(session, workflow_id: str):
    return (await session.execute(
        select(Project.user_id)
        .join(Workflow, Workflow.project_id == Project.id)
        .where(Workflow.id == workflow_id)
    )).scalars().first()


def _caller(request) -> str | None:
    uid = request.headers.get("X-User-Id")
    return uid.strip() if uid and uid.strip() else None


async def ensure_project_owner(request, session, project_id: str) -> None:
    caller = _caller(request)
    if not caller:
        return
    owner = await _owner_of_project(session, project_id)
    if owner and owner != caller:
        raise HTTPException(403, "Project này thuộc về người dùng khác.")


async def ensure_workflow_owner(request, session, workflow_id: str) -> None:
    caller = _caller(request)
    if not caller:
        return
    owner = await _owner_of_workflow(session, workflow_id)
    if owner and owner != caller:
        raise HTTPException(403, "Workflow này thuộc về người dùng khác.")
