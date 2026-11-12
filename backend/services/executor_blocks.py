"""Hạ tầng thực thi workflow: chạy script con trong venv project, quản lý run đang
chạy (dừng/kill), venv/pip, và các quy tắc biến output dùng chung.

Logic RIÊNG của từng loại khối nằm ở ``services/block_handlers`` (mỗi khối một
handler; vòng lặp điều phối ở ``block_handlers/runner.py``).
"""
import os
import json
import logging
import urllib.parse
import subprocess
import threading
import unicodedata
import re
from datetime import datetime
from pathlib import Path
import shutil

from services import venv_manager
# connect_sqlite = sqlite3.connect tới pyflow.db đã bật sẵn WAL + busy_timeout 15s.
# Bắt buộc dùng ở mọi chỗ trong thread executor: kênh sync này ghi song song với
# SQLAlchemy async của tầng API, chỉ cần một kết nối quên bật là đủ gây
# "database is locked" và làm run kẹt RUNNING (xem database.apply_sqlite_pragmas).
from database import connect_sqlite
from services.log_messages import tr

DATA_DIR = venv_manager.DATA_DIR
WORKFLOW_DB = DATA_DIR / "pyflow.db"

logger = logging.getLogger("pyflow.executor_blocks")

_active_runs = {}
_active_procs = {}
# run_id -> thu muc data/pj_*/wf_*/runs/<run_id> chua main.py sinh ra cho lan chay do.
# _finish_run xoa theo dict nay.
_active_run_script_dirs = {}
_workflow_run_ids = {}

# Các run "thường trú" chỉ để giữ Telegram Listener sống (kẹt ở `while True` chờ nút
# Dừng), không còn làm việc gì. Phải tách khỏi run đang làm việc thật: scheduler được
# phép dừng loại này để chạy lịch, nhưng không được dừng run đang làm việc.
_listener_holder_runs = set()

_active_listeners = {}
_active_browser_profiles = {}

# ── Khối "Biến đầu vào": trạng thái chờ người dùng nhập (khóa an toàn đa thread) ──
# run_id -> {block_id, label, fields, deadline, event(threading.Event), values}
_pending_inputs = {}
_pending_lock = threading.Lock()


def register_pending_input(run_id, block_id, label, fields, deadline):
    """Đăng ký một yêu cầu nhập; trả threading.Event để executor thread chờ."""
    ev = threading.Event()
    with _pending_lock:
        _pending_inputs[run_id] = {
            "block_id": block_id, "label": label, "fields": fields,
            "deadline": deadline, "event": ev, "values": None,
        }
    return ev


def clear_pending_input(run_id):
    with _pending_lock:
        _pending_inputs.pop(run_id, None)


def get_pending_input(run_id):
    """Cho API đọc: trả spec + số giây còn lại (nguồn cho đếm ngược), hoặc None."""
    import time
    with _pending_lock:
        p = _pending_inputs.get(run_id)
        if not p:
            return None
        return {
            "block_id": p["block_id"],
            "label": p["label"],
            "fields": p["fields"],
            "remaining_seconds": max(0, int(round(p["deadline"] - time.time()))),
        }


def submit_input(run_id, values):
    """API giao giá trị người dùng nhập cho executor thread đang chờ."""
    import time
    with _pending_lock:
        p = _pending_inputs.get(run_id)
        if not p:
            return {"ok": False, "reason": "Không có yêu cầu nhập nào đang chờ (có thể đã hết thời gian hoặc đã nhập)."}
        if time.time() > p["deadline"]:
            return {"ok": False, "reason": "Đã hết thời gian nhập."}
        p["values"] = values or {}
        p["event"].set()
    return {"ok": True}


def kill_run(run_id):
    """Force kill tất cả processes liên quan đến một run"""
    # Kill subproc nếu đang chạy
    if run_id in _active_procs:
        proc = _active_procs.pop(run_id, None)
        if proc:
            try:
                proc.kill()
            except Exception:
                pass
    # Kill CỨNG trình duyệt Playwright đang treo (nếu có) theo marker = run_id.
    # Chrome/Edge do khối Browser mở không nằm trong _active_procs nên phải kill riêng.
    if run_id in _active_browser_profiles:
        try:
            from services.browser_executor import force_kill_browser_by_marker
            force_kill_browser_by_marker(run_id)
        except Exception:
            pass
    # Set cờ dừng để vòng lặp workflow không chạy tiếp block kế
    ev = _active_runs.pop(run_id, None)
    if ev is not None:
        try:
            ev.set()
        except Exception:
            pass


def stop_workflow_by_id(run_id):
    """Stop a specific workflow run by killing its processes"""
    kill_run(run_id)


def stop_all_runs_for_workflow(workflow_id):
    """Stop all active runs for a workflow"""
    # Đọc set qua .get(...) rồi wrap list() ngay - trước đây if-in-then-index có 2 bước
    # không atomic: _finish_run ở thread khác có thể pop key giữa 2 bước, gây KeyError
    # crash endpoint /stop.
    for run_id in list(_workflow_run_ids.get(workflow_id, set())):
        kill_run(run_id)

def now_iso() -> str:
    return datetime.now().astimezone().isoformat()

def slugify(text: str) -> str:
    if not text:
        return "untitled"
    import unicodedata
    import re
    text = unicodedata.normalize('NFKD', str(text)).encode('ascii', 'ignore').decode('utf-8')
    text = re.sub(r'[^\w\s-]', '', text).strip().lower()
    text = re.sub(r'[-\s_]+', '_', text)
    return text

def get_project_dir(project_id: str) -> Path:
    with connect_sqlite() as conn:
        row = conn.execute("SELECT name FROM project WHERE id=?", (project_id,)).fetchone()
        name = row[0] if row else "unknown"
    return DATA_DIR / f"pj_{slugify(name)}"

def get_saved_db_connection(connection_id: str) -> dict | None:
    if not connection_id:
        return None
    with connect_sqlite() as conn:
        row = conn.execute(
            "SELECT db_type, host, port, username, password, dbname FROM db_connection WHERE id=?",
            (connection_id,)
        ).fetchone()
    if not row:
        return None
    return {
        "db_type": row[0], "host": row[1], "port": row[2],
        "username": row[3], "password": row[4], "dbname": row[5],
    }

def build_conn_str(db_config: dict) -> str:
    db_type = db_config.get("db_type") or "sqlserver"
    host = db_config.get("host") or ""
    port = db_config.get("port") or ""
    dbname = db_config.get("dbname") or ""
    user = db_config.get("username") or ""
    pwd = db_config.get("password") or ""

    user_enc = urllib.parse.quote_plus(str(user)) if user else ""
    pwd_enc = urllib.parse.quote_plus(str(pwd)) if pwd else ""
    port_str = (":" + str(port)) if port else ""

    if db_type == "postgresql":
        return "postgresql://" + user_enc + ":" + pwd_enc + "@" + host + port_str + "/" + dbname
    elif db_type == "mysql":
        return "mysql+pymysql://" + user_enc + ":" + pwd_enc + "@" + host + port_str + "/" + dbname
    elif db_type == "sqlite":
        return "sqlite:///" + dbname
    else:
        return "mssql+pyodbc://" + user_enc + ":" + pwd_enc + "@" + host + port_str + "/" + dbname + "?driver=ODBC+Driver+17+for+SQL+Server&TrustServerCertificate=yes"

def get_venv_dir(project_id: str) -> Path:
    return venv_manager.get_venv_path(project_id)

def get_python_path(project_id: str) -> str:
    return venv_manager.get_python_path(project_id)

def get_pip_path(project_id: str) -> str:
    return venv_manager.get_pip_path(project_id)

def get_pip_cmd(project_id: str) -> list:
    """Xem venv_manager.get_pip_cmd — luôn gọi pip qua `python -m pip`."""
    return venv_manager.get_pip_cmd(project_id)

def venv_exists(project_id: str) -> bool:
    return venv_manager.venv_exists(project_id)

def _stop_telegram_listener_sync(workflow_id: str, log_fn=None, language="vi"):
    """Dừng Telegram Listener từ thread thực thi workflow (đồng bộ, không có event loop riêng)."""
    try:
        from services.telegram_listener import _stop_events, _active_listeners
        if workflow_id in _stop_events:
            _stop_events[workflow_id].set()
        task = _active_listeners.get(workflow_id)
        if task:
            try:
                # Lấy đúng loop mà task listener đang chạy trên đó (thread riêng),
                # KHÔNG dùng asyncio.get_running_loop() vì hàm này được gọi từ một
                # thread đồng bộ không có loop nào đang chạy cả.
                task.get_loop().call_soon_threadsafe(task.cancel)
            except RuntimeError:
                # Loop của task đã đóng - stop_event.set() ở trên vẫn đủ để vòng
                # lặp long-polling tự thoát trong lần lặp kế tiếp (nếu còn sống).
                pass
    except Exception as e:
        if log_fn:
            log_fn("system", "warning", tr(language, "listener_stop_error", error=e))


def _set_workflow_listener_flag(workflow_id: str, on: bool):
    """Cập nhật cột workflow.listener_on trong DB (sync, chạy trong thread executor)."""
    try:
        with connect_sqlite() as conn:
            conn.execute(
                "UPDATE workflow SET listener_on=? WHERE id=?",
                (1 if on else 0, workflow_id)
            )
    except Exception:
        pass


def create_venv_sync(project_id: str) -> dict:
    proj_dir = get_project_dir(project_id)
    proj_dir.mkdir(parents=True, exist_ok=True)
    venv_path = get_venv_dir(project_id)
    venv_path.mkdir(parents=True, exist_ok=True)
    # KHÔNG dùng sys.executable: ở bản đóng gói nó là pyflow-backend.exe, gọi
    # "pyflow-backend.exe -m venv ..." không tạo được venv mà khởi động thêm một
    # backend nữa. get_system_python() chọn đúng python.exe theo từng chế độ.
    result = subprocess.run(
        venv_manager.venv_create_cmd(venv_manager.get_system_python(), project_id),
        capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        raise RuntimeError(f"Không tạo được venv: {result.stderr}")
    return {"path": str(venv_path), "python": get_python_path(project_id)}


def install_pkg_sync(project_id: str, package: str) -> dict:
    if not venv_exists(project_id):
        create_venv_sync(project_id)
    pip = get_pip_cmd(project_id)
    result = subprocess.run(pip + ["install", package, "--quiet"], capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"Cài thất bại: {result.stderr[:500]}")
    return {"package": package, "status": "installed"}


def uninstall_pkg_sync(project_id: str, package: str) -> dict:
    pip = get_pip_cmd(project_id)
    subprocess.run(pip + ["uninstall", package, "-y"], capture_output=True, text=True, timeout=60)
    return {"package": package, "status": "uninstalled"}

def ensure_packages(project_id: str, packages: list, log_fn=None, bid=None, label="", stop_event=None, language="vi"):
    if not packages: return
    if not venv_exists(project_id):
        create_venv_sync(project_id)
    
    pip = get_pip_cmd(project_id)
    result = subprocess.run(pip + ["freeze"], capture_output=True, text=True, timeout=30)
    installed = result.stdout.lower()
    
    missing = []
    for pkg in packages:
        pkg_name = pkg.lower().split('==')[0].split('>')[0].split('<')[0]
        if f"{pkg_name}==" not in installed and f"{pkg_name} @" not in installed:
            missing.append(pkg)
            
    if missing:
        if log_fn:
            log_fn(bid, "info", tr(language, "ensure_packages_installing", label=label, packages=', '.join(missing)))
        
        import time
        res = subprocess.Popen(
            pip + ["install"] + missing,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            text=True,
            encoding="utf-8",
            errors="replace"
        )
        
        # Stream output với kiểm tra stop và timeout
        last_check = time.time()
        check_interval = 1.0  # Check mỗi giây
        while True:
            # Check stop event
            if stop_event and stop_event.is_set():
                res.kill()
                if log_fn:
                    log_fn(bid, "warning", tr(language, "ensure_packages_stopped"))
                raise RuntimeError("Installation stopped by user")
            
            # Non-blocking read with timeout
            line = res.stdout.readline()
            if line:
                line = line.strip()
                if line and log_fn:
                    log_fn(bid, "info", f"      [pip] {line}")
                last_check = time.time()
            else:
                # No more output, check if process ended
                if res.poll() is not None:
                    break
                # Small sleep to avoid busy loop
                time.sleep(0.1)
                
                # Check timeout (5 minutes max for installation)
                if time.time() - last_check > 300:
                    res.kill()
                    if log_fn:
                        log_fn(bid, "error", tr(language, "ensure_packages_timeout"))
                    raise RuntimeError(f"Cài đặt {missing} timeout")
        
        if res.returncode != 0:
            if log_fn:
                log_fn(bid, "error", tr(language, "ensure_packages_failed", code=res.returncode))
            raise RuntimeError(f"Không thể cài đặt {missing}")

def list_pkgs_sync(project_id: str) -> list:
    if not venv_exists(project_id):
        return []
    pip = get_pip_cmd(project_id)
    result = subprocess.run(pip + ["list", "--format=json"], capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return []
    try:
        return [{"name": p["name"], "version": p["version"]} for p in json.loads(result.stdout)]
    except Exception:
        return []


def delete_venv_sync(project_id: str):
    import shutil
    venv_path = get_venv_dir(project_id)
    if venv_path.exists():
        shutil.rmtree(venv_path, ignore_errors=True)


# ══════════════════════════════════════════════════════════════
#  Execution Engine
# ══════════════════════════════════════════════════════════════

RUNNER_TEMPLATE = '''
import sys, json, traceback, os

workflow_id = {workflow_id!r}
block_id = {block_id!r}
OUTPUT_DIR = {output_dir!r}
INPUT_DIR = {input_dir!r}
# Alias chữ thường: AI hỗ trợ viết code (routers/ai_codegen.py) từng được dặn tên
# `output_dir`/`input_dir`, nên code sinh ra hay dùng tên này. Thiếu alias thì code
# kiểu `if 'output_dir' not in locals(): output_dir = os.getcwd()` âm thầm rơi vào
# thư mục backend/ thay vì output của workflow.
output_dir = OUTPUT_DIR
input_dir = INPUT_DIR

input_data = None
workflow_env = {{}}

try:
    _raw = sys.stdin.read().strip()
    if _raw:
        _payload = json.loads(_raw)
        if isinstance(_payload, dict) and "input_data" in _payload and "workflow_env" in _payload:
            input_data = _payload["input_data"]
            workflow_env = _payload["workflow_env"]
        else:
            input_data = _payload
except Exception:
    pass

output_data = None

try:
{user_code}
except Exception as _e:
    print("[ERROR] " + traceback.format_exc(), file=sys.stderr)
    sys.exit(1)

try:
    _out = json.dumps(output_data, ensure_ascii=False, default=str)
except Exception:
    _out = json.dumps(str(output_data))
print("__OUTPUT__:" + _out)
'''


def indent_code(code: str, spaces: int = 4) -> str:
    return "\n".join(" " * spaces + line for line in code.splitlines())


# Định danh bảng SQL hợp lệ: ten_bang hoặc schema.ten_bang. Dùng để chặn chuỗi
# lạ được ghép vào "TRUNCATE TABLE [...]" ở khối excel_to_sql — ô tên bảng có đi
# qua nội suy {{var}} nên giá trị có thể đến từ dữ liệu người ngoài gửi vào.
_VALID_TABLE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")


def safe_filename(name: str, fallback: str) -> str:
    """Rút gọn về TÊN FILE THUẦN, bỏ mọi thành phần đường dẫn.

    Các ô tên file (excelFileName…) đều đi qua nội suy {{var}}, nên giá trị có thể
    đến từ tin nhắn Telegram hoặc ô Google Sheet của người khác. Tên file được
    nhúng vào script con rồi `os.path.join(OUTPUT_DIR, out_file)` — với
    "../../pyflow.db" thì df.to_excel() ghi đè thẳng lên database chính.
    """
    raw = str(name or "").replace("\\", "/").strip()
    base = os.path.basename(raw).strip()
    if not base or base in (".", ".."):
        return fallback
    return base

# Các field trong bdata chỉ chứa TÊN BIẾN (hoặc code), KHÔNG chứa giá trị →
# không được nội suy {{var}}/tên trần. Nếu nội suy, tên biến bị thay bằng chính
# giá trị của biến đó ngay khi tên đã tồn tại trong workflow_env (VD khối chạy
# lần 2 trong vòng lặp): dữ liệu ghi vào 1 key rác, còn {{ten_bien}} đứng im ở
# giá trị của vòng đầu → báo cáo sai số liệu mà không có log lỗi nào.
NON_INTERPOLATED_KEYS = frozenset({
    "code", "key_name", "condVariable",
    # Tên biến output do người dùng đặt trên giao diện
    "outputVarName", "rowCountVarName",
    "excelToSqlRowsVarName", "excelToSqlTableVarName",
    "sqlExecResultVarName", "sqlExecRowCountVarName",
    "telegramSentMessageIdVarName", "telegramChatIdVarName",
    "telegramListenerChatIdVarName", "telegramListenerMessageIdVarName",
    "telegramListenerTextVarName", "telegramListenerSenderNameVarName",
    "cloudLinkVarName", "cloudCountVarName",
    # Tên biến của khối Loop và khối "Biến đầu vào" (inputFields[].name)
    "loopArrayVar", "loopItemVar", "name",
    # dict {tên cột gốc: tên biến custom} của khối đọc Excel/Google Sheets
    "columnMappings",
    # Payload Telegram do NGƯỜI NGOÀI gửi tới (text, sender_name...) — đây là dữ
    # liệu, không phải ô cấu hình. Nội suy nó nghĩa là ai nhắn "{{password_web}}"
    # cho bot sẽ khiến chuỗi đó bị thay bằng chính mật khẩu trong input.json.
    "_initial_input",
})


# Khối nào trả về key gốc nào, và field nào trên UI đặt tên cho key đó.
# Tên người dùng gõ trên giao diện là TÊN DUY NHẤT của biến: dùng cho cả
# current_input (tức input_data của khối Python phía sau) lẫn workflow_env
# ({{ten_bien}}). Không giữ song song tên gốc — "giao diện 1 tên, chạy 1 tên"
# chính là thứ gây khó hiểu trước đây.
BLOCK_OUTPUT_VARS = {
    "telegram": [
        ("sent_message_id", "telegramSentMessageIdVarName"),
        ("chat_id", "telegramChatIdVarName"),
    ],
    "telegram_listener": [
        ("chat_id", "telegramListenerChatIdVarName"),
        ("message_id", "telegramListenerMessageIdVarName"),
        ("text", "telegramListenerTextVarName"),
        ("sender_name", "telegramListenerSenderNameVarName"),
    ],
    "excel_to_sql": [
        ("rows_inserted", "excelToSqlRowsVarName"),
        ("table", "excelToSqlTableVarName"),
    ],
    "run_sql_exec": [
        ("result", "sqlExecResultVarName"),
        ("row_count", "sqlExecRowCountVarName"),
    ],
    "sql_to_excel": [("file_name", "outputVarName")],
    "merge_excel": [("file_name", "outputVarName")],
    "pivot_excel": [("file_name", "outputVarName")],
    "excel_edit": [("file_name", "outputVarName")],
    "cloud_upload": [
        ("cloud_link", "cloudLinkVarName"),
        ("cloud_count", "cloudCountVarName"),
    ],
}


def rename_output_keys(btype: str, bdata: dict, data):
    """Đổi tên key output của khối theo tên biến người dùng đặt trên giao diện.

    Key gốc bị BỎ khi người dùng đặt tên khác — tên trên UI là tên duy nhất.
    Để trống hoặc gõ đúng tên gốc → giữ nguyên (mặc định của UI trùng tên gốc
    nên workflow không đổi tên vẫn chạy y như cũ).

    Các key không có field đặt tên (VD ``raw_message`` của Telegram Listener)
    được giữ nguyên vẹn.
    """
    if not isinstance(data, dict):
        return data
    mapping = BLOCK_OUTPUT_VARS.get(btype)
    if not mapping:
        return data
    out = dict(data)
    for orig_key, field in mapping:
        new_key = str(bdata.get(field) or "").strip()
        if not new_key or new_key == orig_key or orig_key not in out:
            continue
        out[new_key] = out.pop(orig_key)
    return out


def describe_output_vars(btype: str, bdata: dict, data, language="vi") -> str:
    """Mô tả biến khối vừa trả về (TÊN THẬT + gợi ý giá trị) để in ra log.

    Sai 1 chữ trong ô đặt tên biến thì khối Python phía sau đọc ra rỗng mà không
    có dấu hiệu gì — nên tên thật phải hiện rõ trong log, khỏi phải chèn print
    để debug.

    Chỉ liệt kê biến do CHÍNH khối này sinh ra (theo ``BLOCK_OUTPUT_VARS``),
    không liệt kê key có sẵn từ khối trước — tránh log rác. Trả về "" nếu khối
    không có field đặt tên biến.
    """
    mapping = BLOCK_OUTPUT_VARS.get(btype)
    if not mapping or not isinstance(data, dict):
        return ""
    parts = []
    for orig_key, field in mapping:
        name = str(bdata.get(field) or "").strip() or orig_key
        if name not in data:
            continue
        val = data[name]
        if isinstance(val, list):
            parts.append(tr(language, "output_var_elements", name=name, count=len(val)))
        elif isinstance(val, dict):
            parts.append(tr(language, "output_var_object", name=name, count=len(val)))
        elif val is None:
            parts.append(tr(language, "output_var_empty", name=name))
        else:
            s = str(val)
            parts.append(f"{name} = {s[:40] + '…' if len(s) > 40 else s}")
    return ", ".join(parts)


def topological_sort(nodes: list, edges: list) -> list:
    adj = {n["id"]: [] for n in nodes}
    in_deg = {n["id"]: 0 for n in nodes}
    for edge in edges:
        src, tgt = edge.get("source"), edge.get("target")
        if src in adj and tgt in adj:
            adj[src].append(tgt)
            in_deg[tgt] += 1
    queue = [nid for nid, d in in_deg.items() if d == 0]
    ordered = []
    while queue:
        nid = queue.pop(0)
        ordered.append(nid)
        for nxt in adj.get(nid, []):
            in_deg[nxt] -= 1
            if in_deg[nxt] == 0:
                queue.append(nxt)
    node_map = {n["id"]: n for n in nodes}
    return [node_map[nid] for nid in ordered if nid in node_map]


def get_workflow_dir(project_id: str, workflow_id: str) -> Path:
    with connect_sqlite() as conn:
        row = conn.execute("SELECT name FROM workflow WHERE id=?", (workflow_id,)).fetchone()
        name = row[0] if row else "unknown"
    return get_project_dir(project_id) / f"wf_{slugify(name)}"

def run_python_block_sync(project_id, block_id, workflow_id, code, input_data, timeout=60, label=None, log_fn=None, input_dir=None, stop_event=None, workflow_env=None, run_id=None, language="vi"):
    """Chạy 1 block Python synchronously, có thể bị ngắt bởi stop_event.

    ``timeout`` <= 0 (hoặc None) = chờ vô hạn, dùng cho thủ tục SQL chạy vài tiếng.
    Vẫn dừng được bằng nút Dừng vì ``stop_event`` được kiểm tra mỗi 0.5s.

    ``run_id`` quyết định thư mục chứa main.py sinh ra — xem giải thích bên dưới.
    """
    if not venv_exists(project_id):
        create_venv_sync(project_id)

    python_exe = get_python_path(project_id)
    wf_dir = get_workflow_dir(project_id, workflow_id)
    wf_dir.mkdir(parents=True, exist_ok=True)

    # Tách theo run_id. Trước đây đường dẫn chỉ gồm NHÃN khối, trong khi main.py
    # sinh ra đã NHÚNG SẴN giá trị nội suy của đúng lượt chạy đó (câu SQL kèm
    # {{text}}, tên file kết quả, chuỗi kết nối...). Hai run song song — rất dễ xảy
    # ra khi 2 tin nhắn Telegram tới gần nhau — sẽ ghi đè main.py của nhau:
    # run A ghi file → run B ghi đè → run A mới Popen → **run A chạy câu SQL của
    # tin nhắn B**, ghi kết quả sai mà không một dòng log nào bất thường.
    # Trường hợp nhẹ hơn nhưng chắc chắn xảy ra: 2 khối Python TRÙNG NHÃN trong
    # cùng workflow dùng chung một file.
    if run_id:
        run_root = wf_dir / "runs" / str(run_id)
        block_dir = run_root / slugify(label or block_id)
        # Ghi nhớ để _finish_run xoá — vừa chặn thư mục runs/ phình mãi, vừa không
        # để chuỗi kết nối (mssql+pyodbc://user:pass@...) nằm lại trên đĩa vĩnh viễn.
        _active_run_script_dirs[str(run_id)] = run_root
    else:
        block_dir = wf_dir / slugify(label or block_id)
    block_dir.mkdir(parents=True, exist_ok=True)
    output_dir = wf_dir / "output"
    output_dir.mkdir(exist_ok=True)

    block_path = block_dir / "main.py"
    wrapped = RUNNER_TEMPLATE.format(
        workflow_id=workflow_id,
        block_id=block_id,
        output_dir=str(output_dir).replace('\\', '/'),
        input_dir=str(input_dir).replace('\\', '/') if input_dir else '',
        user_code=indent_code(code),
    )
    block_path.write_text(wrapped, encoding="utf-8")

    payload = {
        "input_data": input_data,
        "workflow_env": workflow_env if workflow_env is not None else {}
    }
    input_json = json.dumps(payload, ensure_ascii=False, default=str)

    if log_fn:
        log_fn(block_id, "info", tr(language, "block_start", label=label or block_id))

    start = datetime.now()
    run_id_for_proc = None
    # Tìm run_id tương ứng dựa vào stop_event
    for rid, ev in list(_active_runs.items()):
        if ev is stop_event:
            run_id_for_proc = rid
            break

    try:
        proc = subprocess.Popen(
            [python_exe, "-u", "-X", "utf8", str(block_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            # Không đặt bufsize=1: pipe ở chế độ nhị phân nên line-buffering bị bỏ qua
            # và Python in RuntimeWarning mỗi lần chạy khối. Log vẫn ra theo dòng nhờ "-u".
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )

        # Đăng ký proc để có thể force-kill
        if run_id_for_proc:
            _active_procs[run_id_for_proc] = proc

        def write_stdin():
            try:
                proc.stdin.write(input_json.encode("utf-8"))
                proc.stdin.close()
            except Exception:
                pass

        t_in = threading.Thread(target=write_stdin, daemon=True)
        t_in.start()

        output_lines = []
        stderr_lines = []

        def read_stdout():
            try:
                for line in proc.stdout:
                    line_str = line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if line_str.startswith("__OUTPUT__:"):
                        output_lines.append(line_str)
                    elif line_str.strip() and log_fn:
                        log_fn(block_id, "info", f"   {line_str}")
            except Exception:
                pass

        def read_stderr():
            try:
                for line in proc.stderr:
                    line_str = line.decode("utf-8", errors="replace").rstrip("\r\n")
                    if line_str.strip():
                        stderr_lines.append(line_str)
                        if log_fn:
                            log_fn(block_id, "error", f"   ⚠ {line_str}")
            except Exception:
                pass

        t_out = threading.Thread(target=read_stdout, daemon=True)
        t_err = threading.Thread(target=read_stderr, daemon=True)
        t_out.start()
        t_err.start()

        # Chờ proc và check stop_event định kỳ
        # deadline = None → không giới hạn thời gian (timeout <= 0)
        deadline = None if not timeout or timeout <= 0 else datetime.now().timestamp() + timeout
        while True:
            # Chờ tối đa 0.5s mỗi lần
            try:
                proc.wait(timeout=0.5)
                break  # proc kết thúc
            except subprocess.TimeoutExpired:
                pass

            # Kiểm tra stop_event
            if stop_event and stop_event.is_set():
                import signal
                try:
                    proc.kill()
                except Exception:
                    pass
                duration = int((datetime.now() - start).total_seconds() * 1000)
                if log_fn:
                    log_fn(block_id, "warning", tr(language, "block_stopped", duration=duration))
                if run_id_for_proc:
                    _active_procs.pop(run_id_for_proc, None)
                return False, None, "stopped", duration

            # Kiểm tra timeout
            if deadline is not None and datetime.now().timestamp() > deadline:
                try:
                    proc.kill()
                except Exception:
                    pass
                duration = int((datetime.now() - start).total_seconds() * 1000)
                msg = tr(language, "block_timeout", timeout=timeout)
                if log_fn:
                    log_fn(block_id, "error", msg)
                if run_id_for_proc:
                    _active_procs.pop(run_id_for_proc, None)
                return False, None, msg, duration

        if run_id_for_proc:
            _active_procs.pop(run_id_for_proc, None)

        duration = int((datetime.now() - start).total_seconds() * 1000)
        output_data = None

        # Ensure threads have finished reading
        t_out.join(timeout=1)
        t_err.join(timeout=1)

        # Người dùng bấm Dừng: kill_run() giết tiến trình TRƯỚC rồi mới set cờ, nên
        # proc.wait(0.5) ở vòng trên trả về ngay và `break` — không đi qua nhánh kiểm
        # stop_event bên trong vòng. Không kiểm lại ở đây thì returncode != 0 sẽ bị
        # hiểu thành "Unknown error": lịch sử ghi LỖI và khối Bắt Lỗi bắn cảnh báo giả
        # dù người dùng chỉ bấm Dừng.
        if stop_event and stop_event.is_set():
            if log_fn:
                log_fn(block_id, "warning", tr(language, "block_stopped", duration=duration))
            return False, None, "stopped", duration

        for line in output_lines:
            try:
                output_data = json.loads(line[len("__OUTPUT__:"):])
            except Exception:
                output_data = line[len("__OUTPUT__:"):]

        if proc.returncode != 0:
            err = "\n".join(stderr_lines).strip() or "Unknown error"
            if log_fn:
                log_fn(block_id, "error", tr(language, "block_failed", duration=duration))
            return False, None, err, duration

        if log_fn:
            log_fn(block_id, "success", tr(language, "block_success", duration=duration))
        return True, output_data, None, duration

    except Exception as e:
        if run_id_for_proc:
            _active_procs.pop(run_id_for_proc, None)
        duration = int((datetime.now() - start).total_seconds() * 1000)
        if log_fn:
            log_fn(block_id, "error", tr(language, "block_exception", error=e))
        return False, None, str(e), duration


def execute_workflow_thread(run_id, project_id, workflow_id, workflow_name, graph_json, log_fn, stop_event, language="vi"):
    """Chạy toàn bộ workflow trong thread riêng.

    Logic nằm ở services/block_handlers: runner.py (vòng lặp điều phối) + mỗi loại
    khối một handler. Giữ hàm này làm điểm vào để executor.py không phải đổi.
    """
    from services.block_handlers.runner import run_workflow
    run_workflow(run_id, project_id, workflow_id, workflow_name, graph_json, log_fn, stop_event, language=language)


def _finish_run(run_id, status, start, error=None, log_fn=None, language="vi"):
    finished = datetime.now()
    duration = int((finished - start).total_seconds() * 1000)

    # Ghi trạng thái kết thúc là việc KHÔNG ĐƯỢC PHÉP làm hỏng cả thread. Trước đây
    # câu UPDATE này để trần: chỉ cần một "database is locked" là ngoại lệ bay lên,
    # thoát khỏi execute_workflow_thread mà không ai dọn 3 dict toàn cục → run kẹt
    # RUNNING vĩnh viễn trên giao diện tới lần restart backend kế tiếp.
    # Nay đã bật WAL + busy_timeout 15s nên hiếm, nhưng vẫn phải retry và nuốt có
    # kiểm soát — dọn dẹp bên dưới quan trọng hơn việc ghi được dòng UPDATE này.
    for attempt in range(3):
        try:
            with connect_sqlite() as conn:
                conn.execute(
                    "UPDATE workflow_run SET status=?, finished_at=?, duration_ms=?, error_message=? WHERE id=?",
                    (status, finished.isoformat(), duration, error, run_id)
                )
            break
        except Exception as e:
            if attempt == 2:
                logger.error(f"Không ghi được trạng thái kết thúc cho run {run_id}: {e}")
                if log_fn:
                    log_fn("system", "warning", tr(language, "finish_run_write_error", error=e))
            else:
                import time as _t_retry
                _t_retry.sleep(0.5 * (attempt + 1))

    _active_runs.pop(run_id, None)
    _active_procs.pop(run_id, None)
    _listener_holder_runs.discard(run_id)

    # Xoá thư mục main.py sinh ra cho lượt chạy này (data/pj_*/wf_*/runs/<run_id>).
    # Hai lý do: (1) không để runs/ phình mãi theo số lần chạy; (2) main.py có nhúng
    # conn_str dạng mssql+pyodbc://user:pass@... — trước đây nằm lại trên đĩa vĩnh
    # viễn, và còn bị đóng gói theo khi Export project.
    script_dir = _active_run_script_dirs.pop(str(run_id), None)
    if script_dir:
        import shutil as _sh_scripts
        _sh_scripts.rmtree(script_dir, ignore_errors=True)

    # Dọn dẹp profile duyệt web tạm thời của lượt chạy này
    profile_dir = _active_browser_profiles.pop(run_id, None)
    if profile_dir and profile_dir.parent.exists():
        import shutil
        shutil.rmtree(profile_dir.parent, ignore_errors=True)
        
    try:
        from services.browser_executor import cleanup_browser
        # cleanup_browser nhận log(level, msg) 2 tham số, log_fn ở đây là 3 tham số
        _blog = (lambda lv, msg: log_fn("system", lv, msg)) if log_fn else None
        cleanup_browser(run_id, _blog, language)
    except Exception:
        pass
    # Xóa run_id khỏi workflow mapping
    for wf_id, run_set in list(_workflow_run_ids.items()):
        run_set.discard(run_id)
        if not run_set:
            _workflow_run_ids.pop(wf_id, None)

