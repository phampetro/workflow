import io
import json
import uuid
import zipfile
import asyncio
from pathlib import Path
from datetime import datetime

from sqlalchemy import select

from models import Workflow, Project, DbConnection
from services.venv_manager import get_project_dir, slugify


_SAVED_CONNECTION_FIELDS = (
    "sqlToExcelSavedConnectionId",
    "excelToSqlSavedConnectionId",
    "sqlExecSavedConnectionId",
)


async def _get_workflow_db_connections(workflow_id: str, session) -> list:
    """Lấy toàn bộ kết nối Database thuộc về 1 workflow, để đóng gói kèm khi export."""
    result = await session.execute(
        select(DbConnection).where(DbConnection.workflow_id == workflow_id)
    )
    return [
        {
            "id": c.id,
            "label": c.label,
            "db_type": c.db_type,
            "host": c.host,
            "port": c.port,
            "username": c.username,
            "password": c.password,
            "dbname": c.dbname,
        }
        for c in result.scalars().all()
    ]


async def _import_db_connections_and_remap(db_connections_data: list, new_workflow_id: str, graph_json, session):
    """Tạo lại các kết nối Database đã export dưới workflow mới, rồi sửa lại
    savedConnectionId trong graph_json (đang trỏ tới id cũ) thành id mới tương ứng.
    """
    if not db_connections_data:
        return graph_json

    id_map = {}
    for conn_data in db_connections_data:
        old_id = conn_data.get("id")
        new_conn = DbConnection(
            id=str(uuid.uuid4()),
            workflow_id=new_workflow_id,
            label=conn_data.get("label", ""),
            db_type=conn_data.get("db_type", "sqlserver"),
            host=conn_data.get("host", ""),
            port=conn_data.get("port", ""),
            username=conn_data.get("username", ""),
            password=conn_data.get("password", ""),
            dbname=conn_data.get("dbname", ""),
        )
        session.add(new_conn)
        if old_id:
            id_map[old_id] = new_conn.id
    await session.commit()

    if not graph_json or not id_map:
        return graph_json

    try:
        graph = json.loads(graph_json)
    except Exception:
        return graph_json

    for node in graph.get("nodes", []):
        data = node.get("data", {})
        for field in _SAVED_CONNECTION_FIELDS:
            val = data.get(field)
            if val in id_map:
                data[field] = id_map[val]

    return json.dumps(graph)


def _wf_dir(project_id: str, wf_name: str) -> Path:
    return get_project_dir(project_id) / f"wf_{slugify(wf_name)}"


async def _unique_workflow_name(session, project_id: str, desired_name: str) -> str:
    """Trả về tên không trùng slug với workflow nào khác trong cùng project.

    Nếu tên gốc đã tồn tại, tự thêm hậu tố (Copy), (Copy 2), (Copy 3)... - dùng
    chung cho cả sao chép workflow lẫn import zip vào project đã có workflow cùng tên.
    """
    existing_names = (await session.execute(
        select(Workflow.name).where(Workflow.project_id == project_id)
    )).scalars().all()
    existing_slugs = {slugify(n) for n in existing_names}

    if slugify(desired_name) not in existing_slugs:
        return desired_name

    candidate = f"{desired_name} (Copy)"
    counter = 2
    while slugify(candidate) in existing_slugs:
        candidate = f"{desired_name} (Copy {counter})"
        counter += 1
    return candidate


def _build_workflow_zip_bytes(wf_dict: dict, wf_dir: Path, db_connections: list = None) -> bytes:
    """Đóng gói graph + toàn bộ file input/output của 1 workflow vào zip.

    Hàm đồng bộ (dùng zipfile/đọc đĩa) - luôn gọi qua asyncio.to_thread để
    không chặn event loop.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        export_data = {
            "type": "pyflow_workflow",
            "version": "2.0",
            "workflow": {
                "name": wf_dict["name"],
                "description": wf_dict["description"],
                "color": wf_dict["color"],
                "graph_json": wf_dict["graph_json"],
                "db_connections": db_connections or [],
            },
        }
        zf.writestr("workflow.json", json.dumps(export_data, ensure_ascii=False, indent=2))

        for sub in ("input", "output"):
            d = wf_dir / sub
            if d.exists():
                for f in d.rglob("*"):
                    if f.is_file():
                        zf.write(f, arcname=f"{sub}/{f.relative_to(d)}")
    return buffer.getvalue()


def _read_workflow_meta(zip_data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
        if "workflow.json" not in zf.namelist():
            raise ValueError("File zip không hợp lệ (thiếu workflow.json)")
        meta = json.loads(zf.read("workflow.json").decode("utf-8"))
    return meta.get("workflow", {})


def _safe_extract_dest(target_dir: Path, rel: str) -> Path | None:
    """Chống Zip Slip: bỏ qua entry có đường dẫn tuyệt đối hoặc thoát khỏi target_dir."""
    rel = rel.replace("\\", "/")
    if rel.startswith("/") or ".." in rel.split("/"):
        return None
    dest = (target_dir / rel).resolve()
    try:
        dest.relative_to(target_dir.resolve())
    except ValueError:
        return None
    return dest


def _extract_workflow_files(zip_data: bytes, wf_dir: Path):
    with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
        for sub in ("input", "output"):
            prefix = f"{sub}/"
            target_dir = wf_dir / sub
            for name in zf.namelist():
                if name.startswith(prefix) and not name.endswith("/"):
                    rel = name[len(prefix):]
                    dest = _safe_extract_dest(target_dir, rel)
                    if dest is None:
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(name))


async def export_workflow_to_zip(workflow_id: str, session) -> io.BytesIO:
    """Xuất 1 workflow (graph + input + output + kết nối Database) thành zip trong bộ nhớ."""
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise ValueError("Workflow không tồn tại")

    db_connections = await _get_workflow_db_connections(workflow_id, session)
    wf_dir = _wf_dir(wf.project_id, wf.name)
    data = await asyncio.to_thread(_build_workflow_zip_bytes, wf.to_dict(), wf_dir, db_connections)
    return io.BytesIO(data)


async def import_workflow_from_zip(zip_data: bytes, project_id: str, session) -> dict:
    """Nhập 1 workflow từ zip vào project đích (tạo workflow mới, giữ nguyên input/output,
    tạo lại kết nối Database đã export và tự remap savedConnectionId trong graph_json)."""
    proj = await session.get(Project, project_id)
    if not proj:
        raise ValueError("Project không tồn tại")

    wf_meta = await asyncio.to_thread(_read_workflow_meta, zip_data)
    name = await _unique_workflow_name(session, project_id, wf_meta.get("name") or "Untitled Workflow")

    new_wf = Workflow(
        id=str(uuid.uuid4()),
        name=name,
        description=wf_meta.get("description"),
        project_id=project_id,
        graph_json=wf_meta.get("graph_json"),
        color=wf_meta.get("color", "#6c63ff"),
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    session.add(new_wf)
    await session.commit()
    await session.refresh(new_wf)

    new_wf.graph_json = await _import_db_connections_and_remap(
        wf_meta.get("db_connections", []), new_wf.id, new_wf.graph_json, session
    )
    await session.commit()
    await session.refresh(new_wf)

    wf_dir = _wf_dir(project_id, name)
    await asyncio.to_thread(_extract_workflow_files, zip_data, wf_dir)

    return new_wf.to_dict()


async def duplicate_workflow_in_place(workflow_id: str, session) -> dict:
    """Sao chép 1 workflow (graph + input + output) ngay trong project của nó.

    Triển khai bằng chính export_workflow_to_zip + import_workflow_from_zip -
    "sao chép" về bản chất là export rồi import ngay vào cùng project.
    """
    wf = await session.get(Workflow, workflow_id)
    if not wf:
        raise ValueError("Workflow không tồn tại")

    memory_file = await export_workflow_to_zip(workflow_id, session)
    return await import_workflow_from_zip(memory_file.getvalue(), wf.project_id, session)


async def _unique_project_name(session, user_id: str, desired_name: str) -> str:
    """Tương tự _unique_workflow_name nhưng phạm vi theo user (project không thuộc project nào khác)."""
    existing_names = (await session.execute(
        select(Project.name).where(Project.user_id == user_id)
    )).scalars().all()
    existing_slugs = {slugify(n) for n in existing_names}

    if slugify(desired_name) not in existing_slugs:
        return desired_name

    candidate = f"{desired_name} (Copy)"
    counter = 2
    while slugify(candidate) in existing_slugs:
        candidate = f"{desired_name} (Copy {counter})"
        counter += 1
    return candidate


def _build_project_zip_bytes(proj_dict: dict, workflows: list, proj_dir: Path) -> bytes:
    """Đóng gói project + toàn bộ workflow (graph + input/output) vào 1 zip.

    Mỗi workflow được lưu theo chỉ số (workflows/{idx}/...) thay vì theo tên,
    để tránh nhầm lẫn khi có ký tự đặc biệt hoặc trùng slug.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        export_data = {
            "type": "pyflow_project",
            "version": "2.0",
            "project": {
                "name": proj_dict["name"],
                "description": proj_dict["description"],
                "icon": proj_dict["icon"],
                "color": proj_dict["color"],
            },
            "workflows": [],
        }

        for idx, wf in enumerate(workflows):
            export_data["workflows"].append({
                "name": wf["name"],
                "description": wf["description"],
                "color": wf["color"],
                "graph_json": wf["graph_json"],
                "db_connections": wf.get("db_connections", []),
            })
            wf_dir = proj_dir / f"wf_{slugify(wf['name'])}"
            for sub in ("input", "output"):
                d = wf_dir / sub
                if d.exists():
                    for f in d.rglob("*"):
                        if f.is_file():
                            zf.write(f, arcname=f"workflows/{idx}/{sub}/{f.relative_to(d)}")

        zf.writestr("project.json", json.dumps(export_data, ensure_ascii=False, indent=2))
    return buffer.getvalue()


def _read_project_meta(zip_data: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
        if "project.json" not in zf.namelist():
            raise ValueError("File zip không hợp lệ (thiếu project.json)")
        return json.loads(zf.read("project.json").decode("utf-8"))


def _extract_project_workflow_files(zip_data: bytes, idx: int, wf_dir: Path):
    with zipfile.ZipFile(io.BytesIO(zip_data), "r") as zf:
        for sub in ("input", "output"):
            prefix = f"workflows/{idx}/{sub}/"
            target_dir = wf_dir / sub
            for name in zf.namelist():
                if name.startswith(prefix) and not name.endswith("/"):
                    rel = name[len(prefix):]
                    dest = _safe_extract_dest(target_dir, rel)
                    if dest is None:
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(zf.read(name))


async def export_project_to_zip(project_id: str, session) -> io.BytesIO:
    """Xuất 1 project (metadata + toàn bộ workflow bên trong, kể cả input/output) thành zip."""
    proj = await session.get(Project, project_id)
    if not proj:
        raise ValueError("Project không tồn tại")

    workflows = (await session.execute(
        select(Workflow).where(Workflow.project_id == project_id)
    )).scalars().all()

    wf_dicts = []
    for w in workflows:
        wf_dict = w.to_dict()
        wf_dict["db_connections"] = await _get_workflow_db_connections(w.id, session)
        wf_dicts.append(wf_dict)

    proj_dir = get_project_dir(project_id)
    data = await asyncio.to_thread(
        _build_project_zip_bytes,
        proj.to_dict(),
        wf_dicts,
        proj_dir,
    )
    return io.BytesIO(data)


async def import_project_from_zip(zip_data: bytes, user_id: str, session) -> dict:
    """Nhập 1 project từ zip (tạo project mới + toàn bộ workflow, giữ nguyên input/output)."""
    meta = await asyncio.to_thread(_read_project_meta, zip_data)
    proj_meta = meta.get("project", {})
    wf_metas = meta.get("workflows", [])

    name = await _unique_project_name(session, user_id, proj_meta.get("name") or "Untitled Project")

    new_proj = Project(
        id=str(uuid.uuid4()),
        name=name,
        description=proj_meta.get("description"),
        icon=proj_meta.get("icon", "Box"),
        color=proj_meta.get("color", "#6c63ff"),
        user_id=user_id,
        created_at=datetime.now(),
        updated_at=datetime.now(),
    )
    session.add(new_proj)
    await session.commit()
    await session.refresh(new_proj)

    proj_dir = get_project_dir(new_proj.id)

    for idx, wf_meta in enumerate(wf_metas):
        wf_name = await _unique_workflow_name(session, new_proj.id, wf_meta.get("name") or "Untitled Workflow")
        new_wf = Workflow(
            id=str(uuid.uuid4()),
            name=wf_name,
            description=wf_meta.get("description"),
            project_id=new_proj.id,
            graph_json=wf_meta.get("graph_json"),
            color=wf_meta.get("color", "#6c63ff"),
            created_at=datetime.now(),
            updated_at=datetime.now(),
        )
        session.add(new_wf)
        await session.commit()
        await session.refresh(new_wf)

        new_wf.graph_json = await _import_db_connections_and_remap(
            wf_meta.get("db_connections", []), new_wf.id, new_wf.graph_json, session
        )
        await session.commit()

        wf_dir = proj_dir / f"wf_{slugify(wf_name)}"
        await asyncio.to_thread(_extract_project_workflow_files, zip_data, idx, wf_dir)

    return new_proj.to_dict()
