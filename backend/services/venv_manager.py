"""
VEnv Manager — Quản lý virtual environment riêng cho mỗi project.
Mỗi project có 1 venv tại: data/pj_{slugify_name}/.venv
"""
import os
import sys
import subprocess
import json
import sqlite3
import unicodedata
import re
import asyncio
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent  # thư mục gốc workflow/
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)


def slugify(text: str) -> str:
    """Convert text to URL-safe slug"""
    if not text:
        return "untitled"
    text = unicodedata.normalize('NFKD', str(text)).encode('ascii', 'ignore').decode('utf-8')
    text = re.sub(r'[^\w\s-]', '', text).strip().lower()
    text = re.sub(r'[-\s_]+', '_', text)
    return text


def get_project_dir(project_id: str) -> Path:
    """Lấy thư mục của project"""
    db_path = DATA_DIR / "pyflow.db"
    if not db_path.exists():
        raise RuntimeError(f"Database not found: {db_path}")
    with sqlite3.connect(str(db_path), timeout=5) as conn:
        row = conn.execute("SELECT name FROM project WHERE id=?", (project_id,)).fetchone()
        if not row:
            raise RuntimeError(f"Project not found: {project_id}")
        name = row[0]
    return DATA_DIR / f"pj_{slugify(name)}"


def get_venv_path(project_id: str) -> Path:
    """Trả về đường dẫn venv nằm trong thư mục project: data/pj_{slug}/.venv"""
    return get_project_dir(project_id) / ".venv"


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

    # subprocess.run chặn (blocking) - chạy trong thread riêng để không đứng hình
    # toàn bộ event loop (mọi request khác của app) trong lúc tạo venv (vài giây).
    result = await asyncio.to_thread(
        subprocess.run,
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
    result = await asyncio.to_thread(
        subprocess.run,
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
    result = await asyncio.to_thread(
        subprocess.run,
        [pip, "uninstall", package, "-y"],
        capture_output=True,
        text=True,
        timeout=60
    )
    return {"package": package, "status": "uninstalled"}


async def list_packages(project_id: str) -> list[dict]:
    """Liệt kê tất cả packages trong venv"""
    import logging
    logger = logging.getLogger("pyflow")

    if not venv_exists(project_id):
        logger.warning(f"Venv không tồn tại cho project {project_id}")
        return []

    pip = get_pip_path(project_id)
    logger.info(f"pip path: {pip}")

    result = await asyncio.to_thread(
        subprocess.run,
        [pip, "list", "--format=json"],
        capture_output=True,
        text=True,
        timeout=30
    )

    logger.info(f"pip list returncode: {result.returncode}")
    logger.info(f"pip list stdout: {result.stdout[:500] if result.stdout else 'empty'}")
    logger.info(f"pip list stderr: {result.stderr}")

    if result.returncode != 0:
        return []

    try:
        pkgs = json.loads(result.stdout)
        return [{"name": p["name"], "version": p["version"]} for p in pkgs]
    except Exception as e:
        logger.error(f"Lỗi parse pip list output: {e}")
        return []


def delete_venv(project_id: str):
    """Xóa venv khi xóa project"""
    import shutil
    import threading
    venv_path = get_venv_path(project_id)
    if venv_path.exists():
        # Chạy trong thread để không block event loop
        def _delete():
            shutil.rmtree(venv_path, ignore_errors=True)
        t = threading.Thread(target=_delete, daemon=True)
        t.start()
        t.join(timeout=10)


def delete_workflow_dir(workflow_id: str, wf_name: str = None, pj_name: str = None):
    """Xóa thư mục workflow khi xóa workflow. Truyền name trực tiếp để tránh query sau khi đã xóa DB."""
    import shutil
    import threading
    if wf_name and pj_name:
        wf_slug = slugify(wf_name)
        pj_slug = slugify(pj_name)
        wf_dir = DATA_DIR / f"pj_{pj_slug}" / f"wf_{wf_slug}"
        if wf_dir.exists():
            def _delete():
                shutil.rmtree(wf_dir, ignore_errors=True)
            t = threading.Thread(target=_delete, daemon=True)
            t.start()
            t.join(timeout=10)
            return
    # Fallback: query DB (chỉ khi chưa xóa)
    import sqlite3
    db_path = DATA_DIR / "pyflow.db"
    conn = sqlite3.connect(str(db_path), timeout=5)
    try:
        row = conn.execute(
            "SELECT w.name, p.name FROM workflow w JOIN project p ON w.project_id = p.id WHERE w.id=?",
            (workflow_id,)
        ).fetchone()
    finally:
        conn.close()
    if row:
        wf_name, pj_name = row
        wf_slug = slugify(wf_name)
        pj_slug = slugify(pj_name)
        wf_dir = DATA_DIR / f"pj_{pj_slug}" / f"wf_{wf_slug}"
        if wf_dir.exists():
            def _delete():
                shutil.rmtree(wf_dir, ignore_errors=True)
            t = threading.Thread(target=_delete, daemon=True)
            t.start()
            t.join(timeout=10)


def delete_project_dir(project_id: str, pj_name: str = None):
    """Xóa toàn bộ thư mục project (venv + workflows + files)"""
    import shutil
    import threading
    if pj_name:
        pj_slug = slugify(pj_name)
        proj_dir = DATA_DIR / f"pj_{pj_slug}"
    else:
        proj_dir = get_project_dir(project_id)
    if proj_dir.exists():
        def _delete():
            shutil.rmtree(proj_dir, ignore_errors=True)
        t = threading.Thread(target=_delete, daemon=True)
        t.start()
        t.join(timeout=30)  # đợi tối đa 10s


# Export for use by other modules
__all__ = [
    'get_venv_path', 'get_python_path', 'get_pip_path', 'venv_exists',
    'create_venv', 'install_package', 'uninstall_package', 'list_packages',
    'delete_venv', 'delete_workflow_dir', 'delete_project_dir', 'DATA_DIR', 'get_project_dir'
]
