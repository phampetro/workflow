import os
import io
import mimetypes
from pathlib import Path
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
import subprocess

from database import get_session
from models import Workflow
from services.executor_blocks import get_project_dir

router = APIRouter(prefix="/api/workflows", tags=["files"])

def _get_wf_dir(wf: Workflow) -> Path:
    import re
    def slugify(text: str) -> str:
        import unicodedata
        import re
        text = unicodedata.normalize('NFKD', str(text)).encode('ascii', 'ignore').decode('utf-8')
        text = re.sub(r'[^\w\s-]', '', text).strip().lower()
        text = re.sub(r'[-\s_]+', '_', text)
        return text
    proj_dir = get_project_dir(wf.project_id)
    return proj_dir / f"wf_{slugify(wf.name)}"

# ── Input Files ──────────────────────────────────────────────

@router.get("/{workflow_id}/files")
async def list_input_files(workflow_id: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    input_dir = wf_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    
    files = []
    for entry in input_dir.iterdir():
        if entry.is_file() and entry.name != "input.json":
            files.append({
                "name": entry.name,
                "type": "input",
                "size": entry.stat().st_size,
                "modified": entry.stat().st_mtime
            })
    return sorted(files, key=lambda x: x["modified"], reverse=True)


@router.post("/{workflow_id}/files")
async def upload_file(workflow_id: str, file: UploadFile = File(...), session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    input_dir = wf_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = input_dir / file.filename
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
        
    return {"status": "ok", "filename": file.filename}


@router.delete("/{workflow_id}/files/{filename}")
async def delete_input_file(workflow_id: str, filename: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    file_path = wf_dir / "input" / filename
    
    if file_path.exists():
        os.remove(file_path)
        return {"status": "ok"}
    raise HTTPException(404, "File không tồn tại")


@router.get("/{workflow_id}/files/{filename}/open")
async def open_input_file_os(workflow_id: str, filename: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    file_path = wf_dir / "input" / filename
    
    if not file_path.exists():
        raise HTTPException(404, "File không tồn tại")
        
    import platform
    sys_os = platform.system()
    try:
        if sys_os == "Windows":
            os.startfile(str(file_path))
        elif sys_os == "Darwin": # macOS
            subprocess.run(["open", str(file_path)])
        else: # Linux
            subprocess.run(["xdg-open", str(file_path)])
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Output Files ─────────────────────────────────────────────

@router.get("/{workflow_id}/output-files")
async def list_output_files(workflow_id: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    output_dir = wf_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    files = []
    for entry in output_dir.iterdir():
        if entry.is_file():
            files.append({
                "name": entry.name,
                "type": "output",
                "size": entry.stat().st_size,
                "modified": entry.stat().st_mtime
            })
    return sorted(files, key=lambda x: x["modified"], reverse=True)


@router.delete("/{workflow_id}/output-files/{filename}")
async def delete_output_file(workflow_id: str, filename: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    file_path = wf_dir / "output" / filename
    
    if file_path.exists():
        os.remove(file_path)
        return {"status": "ok"}
    raise HTTPException(404, "File không tồn tại")


@router.get("/{workflow_id}/output-files/{filename}/open")
async def open_output_file_os(workflow_id: str, filename: str, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    file_path = wf_dir / "output" / filename
    
    if not file_path.exists():
        raise HTTPException(404, "File không tồn tại")
        
    import platform
    sys_os = platform.system()
    try:
        if sys_os == "Windows":
            os.startfile(str(file_path))
        elif sys_os == "Darwin": # macOS
            subprocess.run(["open", str(file_path)])
        else: # Linux
            subprocess.run(["xdg-open", str(file_path)])
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Excel Columns & Data Analysis ─────────────────────────────

@router.get("/{workflow_id}/file-columns")
async def get_excel_columns(workflow_id: str, filename: str, header_row: int = 0, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    file_path = wf_dir / "input" / filename
    
    if not file_path.exists():
        file_path = wf_dir / "output" / filename
        
    if not file_path.exists():
        raise HTTPException(404, "File không tồn tại")
        
    if not str(file_path).endswith(('.xlsx', '.xls', '.csv')):
        return {"columns": []}
        
    try:
        import pandas as pd
        if str(file_path).endswith('.csv'):
            df = pd.read_csv(file_path, header=header_row, nrows=0)
        else:
            df = pd.read_excel(file_path, header=header_row, nrows=0)
        return {"columns": list(df.columns)}
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/{workflow_id}/file-column-values")
async def get_excel_column_values(workflow_id: str, filename: str, col_name: str, header_row: int = 0, session: AsyncSession = Depends(get_session)):
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise HTTPException(404, "Workflow không tồn tại")
        
    wf_dir = _get_wf_dir(wf)
    file_path = wf_dir / "input" / filename
    
    if not file_path.exists():
        file_path = wf_dir / "output" / filename
        
    if not file_path.exists():
        raise HTTPException(404, "File không tồn tại")
        
    try:
        import pandas as pd
        if str(file_path).endswith('.csv'):
            df = pd.read_csv(file_path, header=header_row, usecols=[col_name])
        else:
            df = pd.read_excel(file_path, header=header_row, usecols=[col_name])
            
        # Lấy giá trị unique, loại bỏ null và convert sang list
        unique_vals = df[col_name].dropna().unique().tolist()
        # Trả về tối đa 1000 giá trị unique để tối ưu hiệu năng
        return {"values": unique_vals[:1000]}
    except Exception as e:
        raise HTTPException(500, str(e))
