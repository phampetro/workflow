from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import urllib.parse
import subprocess
import json
from services.executor_blocks import get_python_path
from database import get_session
from models import DbConnection

router = APIRouter(tags=["database"])

class DbConfig(BaseModel):
    project_id: str | None = None
    db_type: str = "sqlserver"
    server: str = ""
    port: int | str = ""
    username: str = ""
    password: str = ""
    dbname: str = ""
    driver: str = "ODBC Driver 17 for SQL Server"

class GetSchemaRequest(BaseModel):
    config: DbConfig
    table_name: str | None = None

class DbConnectionBody(BaseModel):
    workflow_id: str
    label: str
    db_type: str = "sqlserver"
    host: str = ""
    port: str = ""
    username: str = ""
    password: str = ""
    dbname: str = ""

def run_db_script(config: DbConfig, script_template: str):
    python_path = get_python_path(config.project_id) if config.project_id else "python"
    
    # Cài đặt thư viện theo db_type
    if config.project_id:
        from services.executor_blocks import ensure_packages
        pkgs = ["sqlalchemy"]
        if config.db_type == "postgresql": pkgs.append("psycopg2-binary")
        elif config.db_type == "mysql": pkgs.extend(["pymysql", "cryptography"])
        elif config.db_type == "sqlserver": pkgs.append("pyodbc")
        ensure_packages(config.project_id, pkgs, None, "api", "Schema Check", None)
        
    config_json = config.json() if hasattr(config, "json") else json.dumps(config.dict())
    code = f'''
import json, urllib.parse, sys
from sqlalchemy import create_engine, inspect

config = json.loads(sys.argv[1])
db_type = config.get("db_type", "sqlserver")
host = config.get("server", "")
port = config.get("port", "")
user = urllib.parse.quote_plus(config.get("username", "")) if config.get("username") else ""
password = urllib.parse.quote_plus(config.get("password", "")) if config.get("password") else ""
dbname = config.get("dbname", "")

if db_type == "postgresql":
    conn_str = f"postgresql://{{user}}:{{password}}@{{host}}{{':' + str(port) if port else ''}}/{{dbname}}"
elif db_type == "mysql":
    conn_str = f"mysql+pymysql://{{user}}:{{password}}@{{host}}{{':' + str(port) if port else ''}}/{{dbname}}"
elif db_type == "sqlite":
    conn_str = f"sqlite:///{{dbname}}"
else:
    conn_str = f"mssql+pyodbc://{{user}}:{{password}}@{{host}}{{':' + str(port) if port else ''}}/{{dbname}}?driver=ODBC+Driver+17+for+SQL+Server&timeout=5"

{script_template}
'''
    try:
        result = subprocess.run(
            [str(python_path), "-c", code, config_json],
            capture_output=True, text=True, timeout=20
        )
        out = result.stdout.strip()
        if not out:
            raise HTTPException(400, f"Lỗi thực thi script DB: {result.stderr.strip()}")
            
        try:
            res_json = json.loads(out)
        except Exception:
            raise HTTPException(400, f"Dữ liệu trả về không hợp lệ: {out}\\nSTDERR: {result.stderr}")
            
        if "error" in res_json:
            raise HTTPException(400, res_json["error"])
            
        return res_json
    except subprocess.TimeoutExpired:
        raise HTTPException(400, "Quá thời gian kết nối Database (Timeout)")
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(400, f"Lỗi hệ thống: {str(e)}")

@router.post("/api/database/tables")
async def get_tables(body: DbConfig):
    script = """
try:
    engine = create_engine(conn_str, fast_executemany=True)
    engine.connect().close()
    insp = inspect(engine)
    tables = insp.get_table_names()
    print(json.dumps({"tables": tables}))
except ValueError as e:
    if "invalid literal for int" in str(e):
        print(json.dumps({"error": f"Port (cổng kết nối) không hợp lệ. Vui lòng kiểm tra lại: {port}"}))
    else:
        print(json.dumps({"error": str(e)}))
except Exception as e:
    print(json.dumps({"error": str(e)}))
"""
    return run_db_script(body, script)

@router.post("/api/database/columns")
async def get_columns(body: GetSchemaRequest):
    if not body.table_name:
        raise HTTPException(400, "Vui lòng cung cấp tên bảng")
        
    table_name = body.table_name
    script = f"""
try:
    engine = create_engine(conn_str, fast_executemany=True)
    engine.connect().close()
    insp = inspect(engine)
    columns = insp.get_columns({table_name!r})
    result = [{{"name": col["name"], "type": str(col["type"])}} for col in columns]
    print(json.dumps({{"columns": result}}))
except ValueError as e:
    if "invalid literal for int" in str(e):
        print(json.dumps({{"error": f"Port (cổng kết nối) không hợp lệ. Vui lòng kiểm tra lại: {{port}}"}}))
    else:
        print(json.dumps({{"error": str(e)}}))
except Exception as e:
    print(json.dumps({{"error": str(e)}}))
"""
    return run_db_script(body.config, script)

@router.get("/api/database/connections")
async def list_db_connections(workflow_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(DbConnection).where(DbConnection.workflow_id == workflow_id).order_by(DbConnection.label)
    )
    return [c.to_dict() for c in result.scalars().all()]

@router.post("/api/database/connections")
async def create_db_connection(body: DbConnectionBody, session: AsyncSession = Depends(get_session)):
    conn = DbConnection(**body.dict())
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn.to_dict()

@router.put("/api/database/connections/{connection_id}")
async def update_db_connection(connection_id: str, body: DbConnectionBody, session: AsyncSession = Depends(get_session)):
    conn = await session.get(DbConnection, connection_id)
    if not conn:
        raise HTTPException(404, "Không tìm thấy kết nối")
    for k, v in body.dict().items():
        setattr(conn, k, v)
    await session.commit()
    await session.refresh(conn)
    return conn.to_dict()

@router.delete("/api/database/connections/{connection_id}")
async def delete_db_connection(connection_id: str, session: AsyncSession = Depends(get_session)):
    conn = await session.get(DbConnection, connection_id)
    if not conn:
        raise HTTPException(404, "Không tìm thấy kết nối")
    await session.delete(conn)
    await session.commit()
    return {"status": "ok"}
