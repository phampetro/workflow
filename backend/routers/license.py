"""Endpoints license: xem trạng thái, lấy vân tay máy, kích hoạt."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import licensing

router = APIRouter(prefix="/api/license", tags=["license"])


class ActivateBody(BaseModel):
    key: str


@router.get("/status")
def get_status():
    """Trạng thái license. FE khóa app khi enforced=True và valid=False."""
    return licensing.get_status()


@router.get("/fingerprint")
def get_fingerprint():
    """Vân tay máy — khách gửi cho nhà phát hành để cấp key."""
    return {"machine": licensing.get_machine_fingerprint()}


@router.post("/activate")
def activate(body: ActivateBody):
    """Kích hoạt bằng key khách dán vào."""
    res = licensing.activate(body.key)
    if not res["ok"]:
        raise HTTPException(400, res["reason"])
    return res["status"]
