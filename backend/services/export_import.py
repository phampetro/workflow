import os
import json
import zipfile
import shutil
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"

def export_project(project_id: str, project_name: str, workflows: list) -> str:
    """
    Xuất một project (bao gồm workflows) thành file .zip.
    Trả về đường dẫn tới file .zip đã tạo.
    """
    export_dir = DATA_DIR / "exports"
    export_dir.mkdir(exist_ok=True)
    
    safe_name = "".join([c for c in project_name if c.isalpha() or c.isdigit() or c==' ']).rstrip()
    safe_name = safe_name.replace(" ", "_").lower() or "project"
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"{safe_name}_{timestamp}.zip"
    zip_path = export_dir / zip_filename
    
    # Gom dữ liệu để export
    export_data = {
        "type": "pyflow_project",
        "version": "1.0",
        "project": {
            "id": project_id,
            "name": project_name
        },
        "workflows": workflows
    }
    
    # Tạo zip file
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipf.writestr("project.json", json.dumps(export_data, ensure_ascii=False, indent=2))
        
    return str(zip_path)


def export_workflow(workflow_id: str, workflow_name: str, workflow_data: dict) -> str:
    """
    Xuất một workflow độc lập thành file .zip.
    Trả về đường dẫn tới file .zip đã tạo.
    """
    export_dir = DATA_DIR / "exports"
    export_dir.mkdir(exist_ok=True)
    
    safe_name = "".join([c for c in workflow_name if c.isalpha() or c.isdigit() or c==' ']).rstrip()
    safe_name = safe_name.replace(" ", "_").lower() or "workflow"
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_filename = f"{safe_name}_{timestamp}.zip"
    zip_path = export_dir / zip_filename
    
    export_data = {
        "type": "pyflow_workflow",
        "version": "1.0",
        "workflow": workflow_data
    }
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        zipf.writestr("workflow.json", json.dumps(export_data, ensure_ascii=False, indent=2))
        
    return str(zip_path)


def import_zip(zip_path: str) -> dict:
    """
    Đọc file .zip và trả về dữ liệu JSON bên trong (dù là project hay workflow).
    """
    if not os.path.exists(zip_path):
        raise FileNotFoundError("File không tồn tại")
        
    try:
        with zipfile.ZipFile(zip_path, 'r') as zipf:
            files = zipf.namelist()
            if "project.json" in files:
                with zipf.open("project.json") as f:
                    return json.loads(f.read().decode("utf-8"))
            elif "workflow.json" in files:
                with zipf.open("workflow.json") as f:
                    return json.loads(f.read().decode("utf-8"))
            else:
                raise ValueError("Không tìm thấy tệp dữ liệu project.json hoặc workflow.json trong tệp giải nén")
    except zipfile.BadZipFile:
        raise ValueError("File không phải định dạng .zip hợp lệ")
    except json.JSONDecodeError:
        raise ValueError("Dữ liệu cấu hình bị hỏng hoặc không đúng định dạng JSON")
    finally:
        # Tự động dọn dẹp file zip sau khi đọc xong
        try:
            os.remove(zip_path)
        except Exception:
            pass
