"""
VEnv Manager — Quản lý virtual environment riêng cho mỗi project.
Mỗi project có 1 venv tại: data/envs/{project_id}/
"""
import os
import sys
import subprocess
import json
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent  # thư mục gốc workflow/
ENVS_DIR = BASE_DIR / "data" / "envs"


def get_venv_path(project_id: str) -> Path:
    return ENVS_DIR / project_id


def get_python_path(project_id: str) -> str:
    """Trả về đường dẫn tới python executable của venv"""
    venv = get_venv_path(project_id)
    if sys.platform == "win32":
        return str(venv / "Scripts" / "python.exe")
    return str(venv / "bin" / "python")


def get_pip_path(project_id: str) -> str:
    venv = get_venv_path(project_id)
    if sys.platform == "win32":
        return str(venv / "Scripts" / "pip.exe")
    return str(venv / "bin" / "pip")


def venv_exists(project_id: str) -> bool:
    python = get_python_path(project_id)
    return os.path.isfile(python)


async def create_venv(project_id: str) -> dict:
    """Tạo virtual environment mới cho project"""
    venv_path = get_venv_path(project_id)
    venv_path.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        [sys.executable, "-m", "venv", str(venv_path)],
        capture_output=True,
        text=True,
        timeout=120
    )

    if result.returncode != 0:
        raise RuntimeError(f"Không thể tạo venv: {result.stderr}")

    return {
        "path": str(venv_path),
        "python": get_python_path(project_id),
    }


async def install_package(project_id: str, package: str) -> dict:
    """Cài đặt package vào venv của project"""
    if not venv_exists(project_id):
        await create_venv(project_id)

    pip = get_pip_path(project_id)
    result = subprocess.run(
        [pip, "install", package, "--quiet"],
        capture_output=True,
        text=True,
        timeout=300
    )

    if result.returncode != 0:
        raise RuntimeError(f"Không thể cài {package}: {result.stderr}")

    return {"package": package, "status": "installed"}


async def uninstall_package(project_id: str, package: str) -> dict:
    """Gỡ cài đặt package"""
    pip = get_pip_path(project_id)
    result = subprocess.run(
        [pip, "uninstall", package, "-y"],
        capture_output=True,
        text=True,
        timeout=60
    )
    return {"package": package, "status": "uninstalled"}


async def list_packages(project_id: str) -> list[dict]:
    """Liệt kê tất cả packages trong venv"""
    if not venv_exists(project_id):
        return []

    pip = get_pip_path(project_id)
    result = subprocess.run(
        [pip, "list", "--format=json"],
        capture_output=True,
        text=True,
        timeout=30
    )

    if result.returncode != 0:
        return []

    try:
        pkgs = json.loads(result.stdout)
        return [{"name": p["name"], "version": p["version"]} for p in pkgs]
    except Exception:
        return []


def delete_venv(project_id: str):
    """Xóa venv khi xóa project"""
    import shutil
    venv_path = get_venv_path(project_id)
    if venv_path.exists():
        shutil.rmtree(venv_path, ignore_errors=True)
