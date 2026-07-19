import os
import sys
import json
import uuid
import sqlite3
import logging
import urllib.request
import urllib.error
import urllib.parse
import smtplib
from email.message import EmailMessage
import asyncio
import subprocess
import threading
import unicodedata
import re
from datetime import datetime
from pathlib import Path
import platform
import zipfile
import shutil

from services import venv_manager

DATA_DIR = venv_manager.DATA_DIR
WORKFLOW_DB = DATA_DIR / "pyflow.db"

_active_runs = {}
_active_procs = {}
_workflow_run_ids = {}

_active_listeners = {}

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
    if workflow_id in _workflow_run_ids:
        for run_id in list(_workflow_run_ids[workflow_id]):
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
    db_path = venv_manager.DATA_DIR / "pyflow.db"
    with sqlite3.connect(str(db_path), timeout=5) as conn:
        row = conn.execute("SELECT name FROM project WHERE id=?", (project_id,)).fetchone()
        name = row[0] if row else "unknown"
    return DATA_DIR / f"pj_{slugify(name)}"

def get_venv_dir(project_id: str) -> Path:
    return venv_manager.get_venv_path(project_id)

def get_python_path(project_id: str) -> str:
    return venv_manager.get_python_path(project_id)

def get_pip_path(project_id: str) -> str:
    return venv_manager.get_pip_path(project_id)

def venv_exists(project_id: str) -> bool:
    return venv_manager.venv_exists(project_id)

def _stop_telegram_listener_sync(workflow_id: str, log_fn=None):
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
            log_fn("system", "warning", f"⚠ Không tắt được listener: {e}")


def create_venv_sync(project_id: str) -> dict:
    proj_dir = get_project_dir(project_id)
    proj_dir.mkdir(parents=True, exist_ok=True)
    venv_path = get_venv_dir(project_id)
    venv_path.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [sys.executable, "-m", "venv", str(venv_path)],
        capture_output=True, text=True, timeout=120
    )
    if result.returncode != 0:
        raise RuntimeError(f"Không tạo được venv: {result.stderr}")
    return {"path": str(venv_path), "python": get_python_path(project_id)}


def install_pkg_sync(project_id: str, package: str) -> dict:
    if not venv_exists(project_id):
        create_venv_sync(project_id)
    pip = get_pip_path(project_id)
    result = subprocess.run([pip, "install", package, "--quiet"], capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"Cài thất bại: {result.stderr[:500]}")
    return {"package": package, "status": "installed"}


def uninstall_pkg_sync(project_id: str, package: str) -> dict:
    pip = get_pip_path(project_id)
    subprocess.run([pip, "uninstall", package, "-y"], capture_output=True, text=True, timeout=60)
    return {"package": package, "status": "uninstalled"}

def ensure_packages(project_id: str, packages: list, log_fn=None, bid=None, label="", stop_event=None):
    if not packages: return
    if not venv_exists(project_id):
        create_venv_sync(project_id)
    
    pip = get_pip_path(project_id)
    result = subprocess.run([pip, "freeze"], capture_output=True, text=True, timeout=30)
    installed = result.stdout.lower()
    
    missing = []
    for pkg in packages:
        pkg_name = pkg.lower().split('==')[0].split('>')[0].split('<')[0]
        if f"{pkg_name}==" not in installed and f"{pkg_name} @" not in installed:
            missing.append(pkg)
            
    if missing:
        if log_fn:
            log_fn(bid, "info", f"📦 [{label}] Đang tải & cài đặt: {', '.join(missing)}...")
        
        import time
        res = subprocess.Popen(
            [pip, "install"] + missing,
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
                    log_fn(bid, "warning", f"⏹ Cài đặt bị dừng bởi người dùng")
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
                        log_fn(bid, "error", f"❌ Cài đặt timeout sau 5 phút")
                    raise RuntimeError(f"Cài đặt {missing} timeout")
        
        if res.returncode != 0:
            if log_fn:
                log_fn(bid, "error", f"❌ Cài đặt thất bại mã {res.returncode}")
            raise RuntimeError(f"Không thể cài đặt {missing}")

def list_pkgs_sync(project_id: str) -> list:
    if not venv_exists(project_id):
        return []
    pip = get_pip_path(project_id)
    result = subprocess.run([pip, "list", "--format=json"], capture_output=True, text=True, timeout=30)
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

input_data = None
try:
    _raw = sys.stdin.read().strip()
    if _raw:
        input_data = json.loads(_raw)
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
    with sqlite3.connect(str(WORKFLOW_DB), timeout=5) as conn:
        row = conn.execute("SELECT name FROM workflow WHERE id=?", (workflow_id,)).fetchone()
        name = row[0] if row else "unknown"
    return get_project_dir(project_id) / f"wf_{slugify(name)}"

def run_python_block_sync(project_id, block_id, workflow_id, code, input_data, timeout=60, label=None, log_fn=None, input_dir=None, stop_event=None):
    """Chạy 1 block Python synchronously, có thể bị ngắt bởi stop_event"""
    if not venv_exists(project_id):
        create_venv_sync(project_id)

    python_exe = get_python_path(project_id)
    wf_dir = get_workflow_dir(project_id, workflow_id)
    wf_dir.mkdir(parents=True, exist_ok=True)
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

    input_json = json.dumps(input_data, ensure_ascii=False, default=str)

    if log_fn:
        log_fn(block_id, "info", f"▶  Chạy block [{label or block_id}]")

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
            bufsize=1,  # Line buffered
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
        deadline = datetime.now().timestamp() + timeout
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
                    log_fn(block_id, "warning", f"⏹ Block đã bị dừng ({duration}ms)")
                if run_id_for_proc:
                    _active_procs.pop(run_id_for_proc, None)
                return False, None, "stopped", duration

            # Kiểm tra timeout
            if datetime.now().timestamp() > deadline:
                try:
                    proc.kill()
                except Exception:
                    pass
                duration = int((datetime.now() - start).total_seconds() * 1000)
                msg = f"⏰ Timeout sau {timeout}s"
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

        for line in output_lines:
            try:
                output_data = json.loads(line[len("__OUTPUT__:"):])
            except Exception:
                output_data = line[len("__OUTPUT__:"):]

        if proc.returncode != 0:
            err = "\n".join(stderr_lines).strip() or "Unknown error"
            if log_fn:
                log_fn(block_id, "error", f"✗ Block thất bại ({duration}ms)")
            return False, None, err, duration

        if log_fn:
            log_fn(block_id, "success", f"✓ Block hoàn thành ({duration}ms)")
        return True, output_data, None, duration

    except Exception as e:
        if run_id_for_proc:
            _active_procs.pop(run_id_for_proc, None)
        duration = int((datetime.now() - start).total_seconds() * 1000)
        if log_fn:
            log_fn(block_id, "error", f"✗ Lỗi: {e}")
        return False, None, str(e), duration


def execute_workflow_thread(run_id, project_id, workflow_id, workflow_name, graph_json, log_fn, stop_event):
    """Chạy toàn bộ workflow trong thread riêng"""
    import time
    time.sleep(0.5) # Đợi client SSE kết nối trước khi chạy nhanh
    start = datetime.now()

    # Đăng ký run để cơ chế force-kill (kill_run / stop_all_runs_for_workflow)
    # tìm được stop_event và subprocess tương ứng. _finish_run sẽ dọn dẹp.
    _active_runs[run_id] = stop_event
    _workflow_run_ids.setdefault(workflow_id, set()).add(run_id)

    try:
        graph = json.loads(graph_json)
    except Exception as e:
        _finish_run(run_id, "error", start, error=str(e))
        return

    try:
        proj_dir = get_project_dir(project_id)
        wf_dir = proj_dir / f"wf_{slugify(workflow_name)}"
        input_dir = wf_dir / "input"
        input_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        # Lỗi trước vòng try chính (DB lock, PermissionError...) không được
        # để run kẹt ở trạng thái RUNNING vĩnh viễn
        _finish_run(run_id, "error", start, error=str(e))
        if log_fn:
            log_fn("system", "error", f"❌ Lỗi chuẩn bị thư mục workflow: {e}")
        return

    try:
        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])
        
        nodes_dict = {n["id"]: n for n in nodes}
        edges_from = {}
        for e in edges:
            edges_from.setdefault(e["source"], []).append(e)

        listener_nodes = [n for n in nodes if n.get("data", {}).get("type") == "telegram_listener" and "_initial_input" in n.get("data", {})]
        
        if listener_nodes:
            start_nodes = listener_nodes
            initial_input = listener_nodes[0]["data"]["_initial_input"]
        else:
            start_nodes = [n for n in nodes if n.get("data", {}).get("type") == "start"]
            initial_input = None

        if not start_nodes:
            if log_fn:
                log_fn("system", "error", "❌ Không tìm thấy khối Bắt đầu!")
            _finish_run(run_id, "error", start, error="Missing Start block")
            return

        from collections import deque
        queue = deque()
        # Enqueue: (node_id, input_data)
        queue.append((start_nodes[0]["id"], initial_input))

        if log_fn:
            log_fn("system", "info", f"🚀 Bắt đầu workflow (Dynamic Routing)")

        import collections
        final_status = "success"
        run_counts = collections.Counter()
        loop_states = {}

        while queue:
            if stop_event and stop_event.is_set():
                log_fn("system", "warning", "⏹ Đã dừng bởi người dùng")
                final_status = "stopped"
                break

            node_id, current_input = queue.popleft()
            if run_counts[node_id] > 2000:
                if log_fn:
                    log_fn("system", "error", f"❌ Phát hiện lặp vô hạn ở Node {node_id} (>2000 lần). Dừng luồng.")
                final_status = "error"
                break
            run_counts[node_id] += 1

            node = nodes_dict.get(node_id)
            if not node:
                continue

            bdata = node.get("data", {})
            
            # Đọc input.json một lần duy nhất nếu chưa đọc
            if "workflow_env" not in locals():
                workflow_env = {}
                try:
                    input_file = input_dir / "input.json"
                    if input_file.exists():
                        with open(input_file, "r", encoding="utf-8") as f:
                            workflow_env = json.load(f)
                except Exception:
                    pass
                    
                def interpolate(val):
                    if not isinstance(val, str):
                        return val
                    if val in workflow_env:
                        return str(workflow_env[val])
                    for k, v in workflow_env.items():
                        val = val.replace("{{" + k + "}}", str(v))
                    return val

                def interpolate_deep(val):
                    # Nội suy đệ quy vào dict/list lồng nhau (conditions, attachments,
                    # danh sách lệnh telegram...) — không chỉ field string cấp cao nhất
                    if isinstance(val, str):
                        return interpolate(val)
                    if isinstance(val, dict):
                        return {k: interpolate_deep(v) for k, v in val.items()}
                    if isinstance(val, list):
                        return [interpolate_deep(item) for item in val]
                    return val

            # Nội suy các biến môi trường (đệ quy vào cả cấu trúc lồng nhau)
            bdata = {k: interpolate_deep(v) for k, v in bdata.items()}

            btype = bdata.get("type", "python")
            bid = node["id"]
            label = bdata.get("label", bid)

            # Execution flags for branching
            continue_branch = True
            cond_branch_taken = None # 'true' or 'false'

            if btype == "start":
                if log_fn:
                    log_fn(bid, "info", f"▶  [Start] {label}")
            elif btype == "end":
                if log_fn:
                    log_fn(bid, "info", f"🏁 [End] {label}")
                break
            elif btype == "delay":
                delay_sec = float(bdata.get("delaySeconds", 3))
                if log_fn:
                    log_fn(bid, "info", f"⏳ [Delay] {label} - Đang chờ {delay_sec} giây...")
                
                # Chờ có kiểm tra stop_event định kỳ (mỗi 0.5s)
                import time
                waited = 0.0
                check_interval = 0.5
                while waited < delay_sec:
                    if stop_event and stop_event.is_set():
                        if log_fn:
                            log_fn(bid, "warning", f"⏹ Delay bị dừng sau {int(waited)}s")
                        final_status = "stopped"
                        break
                    sleep_time = min(check_interval, delay_sec - waited)
                    time.sleep(sleep_time)
                    waited += sleep_time
                else:
                    if log_fn:
                        log_fn(bid, "success", f"✅ Đã chờ xong {delay_sec} giây.")
            elif btype == "telegram_listener":
                if "_initial_input" in bdata:
                    if log_fn:
                        log_fn(bid, "info", f"🎧 [Telegram Listener] {label} - Đã nhận tin nhắn và chạy workflow")
                    current_input = bdata["_initial_input"]
                else:
                    # Manual run (bấm nút Chạy/Start) → bật Listener, workflow giữ RUNNING chờ tin nhắn
                    if log_fn:
                        log_fn(bid, "info", f"🎧 [Telegram Listener] {label} - Đang bật Listener để chờ tin nhắn...")

                    # Tự động bật Listener (nếu chưa bật) - chạy trong thread riêng có event loop
                    try:
                        import threading as _threading_listener
                        from services.telegram_listener import (
                            start_telegram_listener,
                            is_listener_running,
                        )
                        if not is_listener_running(workflow_id):
                            # Dùng bdata (đã nội suy biến {{key}}/input.json ở trên), KHÔNG dùng
                            # node["data"] thô - nếu không Bot Token dạng biến sẽ bị gửi nguyên văn.
                            tg_token = bdata.get("telegramListenerToken") or bdata.get("telegramBotToken", "")

                            # commands: list các {"command", "reply", "runWorkflow"} - giữ nguyên
                            # cấu hình reply/runWorkflow để listener biết trả lời trực tiếp hay chạy tiếp workflow.
                            # Lưu ý: command để trống (hoặc "*") là hợp lệ - nghĩa là khớp MỌI tin nhắn,
                            # nên KHÔNG được lọc bỏ các dòng có command rỗng.
                            raw_commands = bdata.get("telegramListenerCommands") or bdata.get("telegramCommands", "")
                            tg_commands = []
                            if isinstance(raw_commands, list):
                                for c in raw_commands:
                                    if isinstance(c, dict):
                                        tg_commands.append({
                                            "command": (c.get("command") or "").strip(),
                                            "description": c.get("description", ""),
                                            "reply": c.get("reply", ""),
                                            "runWorkflow": bool(c.get("runWorkflow", False)),
                                        })
                                    else:
                                        tg_commands.append({"command": str(c).strip(), "reply": "", "runWorkflow": True})
                            else:
                                tg_commands = [
                                    {"command": c.strip(), "reply": "", "runWorkflow": True}
                                    for c in str(raw_commands).split(",") if c.strip()
                                ]

                            def _run_listener_in_thread():
                                import asyncio as _aio
                                from services.telegram_listener import _active_listeners as _listeners_map, _stop_events as _stops_map
                                loop = _aio.new_event_loop()
                                _aio.set_event_loop(loop)
                                try:
                                    # start_telegram_listener chỉ tạo task nền rồi trả về ngay,
                                    # nên phải tự giữ loop sống bằng cách run_until_complete
                                    # chính task đó - nếu không loop đóng lại và task bị hủy ngay.
                                    loop.run_until_complete(start_telegram_listener(
                                        project_id=project_id,
                                        workflow_id=workflow_id,
                                        workflow_name=workflow_name,
                                        graph_json=graph_json,
                                        bot_token=tg_token,
                                        commands=tg_commands,
                                    ))
                                    task = _listeners_map.get(workflow_id)
                                    if task:
                                        try:
                                            loop.run_until_complete(task)
                                        except _aio.CancelledError:
                                            pass
                                finally:
                                    # Task đã kết thúc (bị dừng/hủy/lỗi) - dọn khỏi bảng theo dõi
                                    # để is_listener_running() phản ánh đúng trạng thái thật.
                                    _listeners_map.pop(workflow_id, None)
                                    _stops_map.pop(workflow_id, None)
                                    loop.close()

                            _t = _threading_listener.Thread(
                                target=_run_listener_in_thread,
                                daemon=True,
                                name=f"tg-listener-{workflow_id}",
                            )
                            _t.start()

                            if log_fn:
                                log_fn(bid, "success", f"✅ Listener đã được bật. Đang lắng nghe tin nhắn Telegram...")
                        else:
                            if log_fn:
                                log_fn(bid, "info", f"ℹ️ Listener đã chạy sẵn.")
                    except Exception as e:
                        if log_fn:
                            log_fn(bid, "warning", f"⚠ Lỗi khi bật listener: {e}")

                    # Listener chỉ được bật ở đây (từ khối Start) và chỉ tắt khi
                    # người dùng bấm Dừng - workflow giữ trạng thái RUNNING trong
                    # lúc chờ, không tự đánh dấu "hoàn thành" khi chưa chạm khối End.
                    import time as _time_listener
                    while True:
                        if stop_event and stop_event.is_set():
                            if log_fn:
                                log_fn(bid, "warning", f"⏹ Đang tắt Listener theo yêu cầu người dùng...")
                            _stop_telegram_listener_sync(workflow_id, log_fn=log_fn)
                            final_status = "stopped"
                            break
                        _time_listener.sleep(0.5)
                    break
            elif btype == "telegram":
                bot_token = interpolate(bdata.get("telegramBotToken", "")).strip()
                chat_id = interpolate(bdata.get("telegramChatId", "")).strip()
                message_template = bdata.get("telegramMessage", "")
                parse_mode = bdata.get("telegramParseMode", "")
                telegram_attachments = bdata.get("telegramAttachments", [])
                telegram_action = bdata.get("telegramAction", "send")
                telegram_message_id_template = bdata.get("telegramMessageId", "")
                
                if not bot_token or not chat_id:
                    if log_fn:
                        log_fn(bid, "error", f"❌ [Telegram] {label} - Thiếu Bot Token hoặc Chat ID")
                    final_status = "error"
                    break
                    
                try:
                    chat_id = chat_id.replace("{input_data}", str(current_input))
                    if isinstance(current_input, dict):
                        for k, v in current_input.items():
                            chat_id = chat_id.replace("{" + str(k) + "}", str(v))
                except Exception:
                    pass
                    
                text = message_template
                try:
                    text = text.replace("{input_data}", str(current_input))
                    if isinstance(current_input, dict):
                        for k, v in current_input.items():
                            text = text.replace("{" + str(k) + "}", str(v))
                except Exception:
                    pass
                
                msg_id = str(telegram_message_id_template)
                try:
                    msg_id = msg_id.replace("{input_data}", str(current_input))
                    if isinstance(current_input, dict):
                        for k, v in current_input.items():
                            msg_id = msg_id.replace("{" + str(k) + "}", str(v))
                except Exception:
                    pass

                # --- Resolve attachment file paths ---
                resolved_files = []
                for att in telegram_attachments:
                    att_name = att
                    try:
                        att_name = att_name.replace("{input_data}", str(current_input))
                        if isinstance(current_input, dict):
                            for k, v in current_input.items():
                                att_name = att_name.replace("{" + str(k) + "}", str(v))
                    except Exception:
                        pass
                    if not att_name:
                        continue
                    # Tìm trong output trước, rồi input
                    att_path = wf_dir / "output" / att_name
                    if not att_path.exists():
                        att_path = input_dir / att_name
                    if att_path.exists() and att_path.is_file():
                        resolved_files.append((att_name, att_path))
                    else:
                        if log_fn:
                            log_fn(bid, "warning", f"⚠ [Telegram] Không tìm thấy file đính kèm: {att_name}")

                def _tg_send_message(bot_token, chat_id, text, parse_mode, reply_to=None):
                    """Gửi tin nhắn văn bản qua Telegram sendMessage"""
                    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
                    payload = {"chat_id": chat_id, "text": text}
                    if parse_mode:
                        payload["parse_mode"] = parse_mode
                    if reply_to:
                        payload["reply_to_message_id"] = reply_to
                    req_data = json.dumps(payload).encode('utf-8')
                    req = urllib.request.Request(url, data=req_data, headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req, timeout=15) as response:
                        return json.loads(response.read().decode('utf-8'))
                        
                def _tg_edit_message_text(bot_token, chat_id, text, message_id, parse_mode):
                    """Sửa tin nhắn văn bản qua Telegram editMessageText"""
                    url = f"https://api.telegram.org/bot{bot_token}/editMessageText"
                    payload = {"chat_id": chat_id, "message_id": message_id, "text": text}
                    if parse_mode:
                        payload["parse_mode"] = parse_mode
                    req_data = json.dumps(payload).encode('utf-8')
                    req = urllib.request.Request(url, data=req_data, headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req, timeout=15) as response:
                        return json.loads(response.read().decode('utf-8'))

                def _tg_send_document(bot_token, chat_id, file_path, file_name, caption="", parse_mode="", reply_to=None):
                    """Gửi file qua Telegram sendDocument (multipart/form-data)"""
                    import uuid
                    boundary = uuid.uuid4().hex
                    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
                    
                    lines = []
                    # chat_id field
                    lines.append(f"--{boundary}".encode())
                    lines.append(b'Content-Disposition: form-data; name="chat_id"')
                    lines.append(b'')
                    lines.append(chat_id.encode())
                    # document field
                    lines.append(f"--{boundary}".encode())
                    lines.append(f'Content-Disposition: form-data; name="document"; filename="{file_name}"'.encode())
                    lines.append(b'Content-Type: application/octet-stream')
                    lines.append(b'')
                    with open(file_path, 'rb') as fp:
                        file_data = fp.read()
                    lines.append(file_data)
                    # caption field (optional)
                    if caption:
                        lines.append(f"--{boundary}".encode())
                        lines.append(b'Content-Disposition: form-data; name="caption"')
                        lines.append(b'')
                        lines.append(caption.encode())
                    # parse_mode field (optional)
                    if parse_mode:
                        lines.append(f"--{boundary}".encode())
                        lines.append(b'Content-Disposition: form-data; name="parse_mode"')
                        lines.append(b'')
                        lines.append(parse_mode.encode())
                    # reply_to field (optional)
                    if reply_to:
                        lines.append(f"--{boundary}".encode())
                        lines.append(b'Content-Disposition: form-data; name="reply_to_message_id"')
                        lines.append(b'')
                        lines.append(str(reply_to).encode())
                    lines.append(f"--{boundary}--".encode())
                    
                    body = b"\r\n".join(lines)
                    req = urllib.request.Request(url, data=body, headers={
                        'Content-Type': f'multipart/form-data; boundary={boundary}'
                    })
                    with urllib.request.urlopen(req, timeout=60) as response:
                        return json.loads(response.read().decode('utf-8'))
                    
                if log_fn:
                    log_fn(bid, "info", f"✉️ [Telegram] {label} - Đang gửi tin nhắn tới {chat_id}...")
                
                try:
                    telegram_error = False
                    last_message_id = None
                    
                    if telegram_action == "edit":
                        if not msg_id:
                            if log_fn:
                                log_fn(bid, "error", f"❌ [Telegram] {label} - Lỗi: Chế độ 'Sửa tin nhắn' yêu cầu Message ID hợp lệ.")
                            final_status = "error"
                            break
                        res = _tg_edit_message_text(bot_token, chat_id, text, msg_id, parse_mode)
                        if not res.get("ok"):
                            if log_fn: log_fn(bid, "error", f"❌ [Telegram] {label} - Lỗi sửa tin nhắn: {res.get('description')}")
                            telegram_error = True
                        else:
                            last_message_id = res.get("result", {}).get("message_id")
                    else:
                        reply_to_id = msg_id if telegram_action == "reply" else None
                        
                        if not resolved_files:
                            # Không có file đính kèm
                            res = _tg_send_message(bot_token, chat_id, text, parse_mode, reply_to_id)
                            if not res.get("ok"):
                                if log_fn:
                                    log_fn(bid, "error", f"❌ [Telegram] {label} - Lỗi API: {res.get('description')}")
                                telegram_error = True
                            else:
                                last_message_id = res.get("result", {}).get("message_id")
                        elif len(resolved_files) == 1:
                            # 1 file
                            fname, fpath = resolved_files[0]
                            if log_fn:
                                log_fn(bid, "info", f"📎 [Telegram] {label} - Đính kèm file: {fname}")
                            res = _tg_send_document(bot_token, chat_id, str(fpath), fname, caption=text, parse_mode=parse_mode, reply_to=reply_to_id)
                            if not res.get("ok"):
                                if log_fn:
                                    log_fn(bid, "error", f"❌ [Telegram] {label} - Lỗi gửi file {fname}: {res.get('description')}")
                                telegram_error = True
                            else:
                                last_message_id = res.get("result", {}).get("message_id")
                        else:
                            # Nhiều file
                            if text.strip():
                                res = _tg_send_message(bot_token, chat_id, text, parse_mode, reply_to_id)
                                if not res.get("ok"):
                                    if log_fn:
                                        log_fn(bid, "error", f"❌ [Telegram] {label} - Lỗi gửi tin nhắn: {res.get('description')}")
                                    telegram_error = True
                                else:
                                    last_message_id = res.get("result", {}).get("message_id")
                            
                            if not telegram_error:
                                for i, (fname, fpath) in enumerate(resolved_files):
                                    if log_fn:
                                        log_fn(bid, "info", f"📎 [Telegram] {label} - Đính kèm file: {fname}")
                                    # File đầu tiên reply to the message (nếu text trống và có reply_to_id)
                                    cur_reply_to = reply_to_id if (i == 0 and not text.strip()) else None
                                    res = _tg_send_document(bot_token, chat_id, str(fpath), fname, reply_to=cur_reply_to)
                                    if not res.get("ok"):
                                        if log_fn:
                                            log_fn(bid, "error", f"❌ [Telegram] {label} - Lỗi gửi file {fname}: {res.get('description')}")
                                        telegram_error = True
                                        break
                                    if not last_message_id:
                                        last_message_id = res.get("result", {}).get("message_id")
                    
                    if telegram_error:
                        final_status = "error"
                        break
                    else:
                        if log_fn:
                            log_fn(bid, "success", f"✅ [Telegram] {label} - Đã gửi thành công! (message_id={last_message_id})")
                        if isinstance(current_input, dict):
                            # Giữ lại message_id cũ (tin nhắn người dùng), thêm sent_message_id (tin vừa gửi ra)
                            current_input["sent_message_id"] = last_message_id
                            current_input["chat_id"] = chat_id
                        else:
                            current_input = {"sent_message_id": last_message_id, "message_id": last_message_id, "chat_id": chat_id, "previous_input": current_input}
                except Exception as e:
                    if log_fn:
                        log_fn(bid, "error", f"❌ [Telegram] {label} - Gửi thất bại: {str(e)}")
                    final_status = "error"
                    break
            elif btype == "email":
                mail_host = bdata.get("mailHost", "").strip()
                mail_port = int(bdata.get("mailPort", 465) or 465)
                mail_user = bdata.get("mailUser", "").strip()
                mail_pass = bdata.get("mailPass", "").replace(" ", "")
                mail_to = bdata.get("mailTo", "").strip()
                mail_cc = bdata.get("mailCc", "").strip()
                mail_subject = bdata.get("mailSubject", "").strip()
                mail_body = bdata.get("mailBody", "")
                mail_attachments = bdata.get("mailAttachments", [])

                def tpl(txt):
                    if not txt: return ""
                    t = txt.replace("{input_data}", str(current_input))
                    if isinstance(current_input, dict):
                        for k, v in current_input.items():
                            t = t.replace("{" + str(k) + "}", str(v))
                    return t

                final_to = tpl(mail_to)
                final_cc = tpl(mail_cc)
                final_subject = tpl(mail_subject)
                final_body = tpl(mail_body)

                if log_fn:
                    log_fn(bid, "info", f"📧 [Email] {label} - Đang gửi thư tới {final_to}...")

                msg = EmailMessage()
                msg['Subject'] = final_subject
                msg['From'] = mail_user
                msg['To'] = final_to
                if final_cc:
                    msg['Cc'] = final_cc
                
                # Check if body contains HTML tags
                if "<" in final_body and ">" in final_body:
                    msg.set_content(final_body, subtype='html')
                else:
                    msg.set_content(final_body)

                # Attachments
                for att in mail_attachments:
                    att_name = tpl(att)
                    if not att_name: continue
                    # try INPUT_DIR then OUTPUT_DIR
                    att_path = input_dir / att_name
                    if not att_path.exists():
                        att_path = wf_dir / "output" / att_name
                    
                    if att_path.exists() and att_path.is_file():
                        import mimetypes
                        ctype, encoding = mimetypes.guess_type(str(att_path))
                        if ctype is None or encoding is not None:
                            ctype = 'application/octet-stream'
                        maintype, subtype = ctype.split('/', 1)
                        with open(att_path, 'rb') as fp:
                            msg.add_attachment(fp.read(), maintype=maintype, subtype=subtype, filename=att_name)
                    else:
                        if log_fn:
                            log_fn(bid, "warning", f"⚠ [Email] Không tìm thấy file đính kèm: {att_name}")

                try:
                    # Decide SSL or TLS based on port
                    if mail_port == 465:
                        smtp = smtplib.SMTP_SSL(mail_host, mail_port, timeout=15)
                    else:
                        smtp = smtplib.SMTP(mail_host, mail_port, timeout=15)
                        smtp.starttls()
                    
                    smtp.login(mail_user, mail_pass)
                    smtp.send_message(msg)
                    smtp.quit()

                    if log_fn:
                        log_fn(bid, "success", f"✅ [Email] {label} - Đã gửi thư thành công!")
                except Exception as e:
                    if log_fn:
                        log_fn(bid, "error", f"❌ [Email] {label} - Lỗi gửi thư: {str(e)}")
                    final_status = "error"
                    break
            elif btype == "database":
                db_type = bdata.get("dbType", "postgresql")
                db_host = bdata.get("dbHost", "")
                db_port = bdata.get("dbPort", "")
                db_user = bdata.get("dbUser", "")
                db_pass = bdata.get("dbPassword", "")
                db_name = bdata.get("dbName", "")
                
                db_user_enc = urllib.parse.quote_plus(db_user) if db_user else ""
                db_pass_enc = urllib.parse.quote_plus(db_pass) if db_pass else ""

                conn_str = ""
                if db_type == "postgresql":
                    conn_str = f"postgresql://{db_user_enc}:{db_pass_enc}@{db_host}:{db_port}/{db_name}"
                elif db_type == "mysql":
                    conn_str = f"mysql+pymysql://{db_user_enc}:{db_pass_enc}@{db_host}:{db_port}/{db_name}"
                elif db_type == "sqlite":
                    conn_str = f"sqlite:///{db_name}"
                elif db_type == "sqlserver":
                    conn_str = f"mssql+pyodbc://{db_user_enc}:{db_pass_enc}@{db_host}:{db_port}/{db_name}?driver=ODBC+Driver+17+for+SQL+Server"
                    
                current_input = {
                    "db_type": db_type,
                    "host": db_host,
                    "port": db_port,
                    "user": db_user,
                    "password": db_pass,
                    "db_name": db_name,
                    "connection_string": conn_str
                }
                
                packages_to_install = []
                if db_type == "postgresql": packages_to_install.append("psycopg2-binary")
                elif db_type == "mysql": packages_to_install.extend(["pymysql", "cryptography"])
                elif db_type == "sqlserver": packages_to_install.append("pyodbc")
                
                ensure_packages(project_id, packages_to_install, log_fn, bid, label, stop_event)
                
                if log_fn:
                    log_fn(bid, "success", f"✅ [Database] {label} - Đã tạo cấu hình kết nối {db_type.upper()}")
            elif btype == "delete_files":
                import shutil
                delete_input = bdata.get("delete_input", False)
                delete_output = bdata.get("delete_output", False)

                if delete_input:
                    try:
                        if input_dir.exists():
                            for item in input_dir.iterdir():
                                if item.name == "input.json":
                                    continue
                                if item.is_file():
                                    item.unlink()
                                elif item.is_dir():
                                    shutil.rmtree(item)
                        if log_fn:
                            log_fn(bid, "success", f"✅ [Xóa] Đã dọn dẹp thư mục Input.")
                    except Exception as e:
                        if log_fn:
                            log_fn(bid, "error", f"❌ [Xóa] Lỗi xóa Input: {e}")
                
                if delete_output:
                    try:
                        out_dir = wf_dir / "output"
                        if out_dir.exists():
                            for item in out_dir.iterdir():
                                if item.is_file():
                                    item.unlink()
                                elif item.is_dir():
                                    shutil.rmtree(item)
                        if log_fn:
                            log_fn(bid, "success", f"✅ [Xóa] Đã dọn dẹp thư mục Output.")
                    except Exception as e:
                        if log_fn:
                            log_fn(bid, "error", f"❌ [Xóa] Lỗi xóa Output: {e}")
                            
            elif btype == "browser":
                steps = bdata.get("steps", [])
                headless = not bdata.get("debugMode", False)
                if not steps:
                    if log_fn:
                        log_fn(bid, "warning", f"⚠️ Block [{label}] không có bước nào, bỏ qua")
                    continue_branch = False
                else:
                    if log_fn:
                        log_fn(bid, "info", f"🌐 Đang chạy Browser: {label}...")
                    
                    import asyncio
                    from services.browser_executor import run_browser_block
                    
                    # Wrap sync log_fn to async
                    async def async_log_cb(b_id, lvl, msg):
                        if log_fn:
                            log_fn(b_id, lvl, msg)
                            
                    start_b = datetime.now()
                    try:
                        output_dir = wf_dir / "output"
                        output_dir.mkdir(exist_ok=True)
                        # bdata_interpolated ở trên chỉ nội suy field string cấp cao nhất
                        # của block, không đi sâu vào từng step - nên {{key}} trong value
                        # của mỗi step (VD: khối Nhập văn bản) chưa đọc được input.json.
                        # Nội suy lại đây để mọi field string trong step cũng dùng được
                        # biến từ Dữ liệu Workflow, giống các khối khác.
                        steps_interpolated = [
                            {k: (interpolate(v) if isinstance(v, str) else v) for k, v in step.items()}
                            for step in steps
                        ]
                        b_result = asyncio.run(run_browser_block(
                            block_id=bid,
                            workflow_id=workflow_id,
                            steps=steps_interpolated,
                            input_data=current_input,
                            headless=headless,
                            log_callback=async_log_cb,
                            output_dir=str(output_dir).replace('\\', '/'),
                            stop_event=stop_event,
                        ))
                        if not b_result.get("success"):
                            if b_result.get("stopped"):
                                # Không finish_run trực tiếp - để rơi xuống cuối vòng lặp,
                                # nơi đã có sẵn log "⏹ Đã dừng sau Xms" cho final_status=stopped.
                                final_status = "stopped"
                                break
                            if log_fn:
                                log_fn("system", "error", f"❌ Workflow thất bại (Browser lỗi)")
                            _finish_run(run_id, "error", start, error=b_result.get("error"))
                            return
                        else:
                            if b_result.get("output_data") is not None:
                                browser_out = b_result["output_data"]
                                # Merge: giữ lại tất cả biến cũ (chat_id, message_id, sent_message_id...)
                                # rồi cập nhật thêm dữ liệu mới từ Browser vào
                                if isinstance(current_input, dict) and isinstance(browser_out, dict):
                                    merged = dict(current_input)
                                    merged.update(browser_out)
                                    current_input = merged
                                else:
                                    current_input = browser_out
                    except Exception as e:
                        if log_fn:
                            log_fn("system", "error", f"❌ Lỗi ngoại lệ Browser: {e}")
                        _finish_run(run_id, "error", start, error=str(e))
                        return
            elif btype == "python":
                code = bdata.get("code", "").strip()
                if not code:
                    if log_fn:
                        log_fn(bid, "warning", f"⚠️ Block [{label}] không có code")
                    continue_branch = False
                else:
                    if log_fn:
                        log_fn(bid, "info", f"⚡ Đang chạy: {label}...")
                    success, output, error, duration = run_python_block_sync(
                        project_id, bid, workflow_id, code, current_input, 
                        timeout=1800, label=label, log_fn=log_fn, input_dir=str(input_dir),
                        stop_event=stop_event
                    )
                    if not success:
                        if error == "stopped":
                            final_status = "stopped"
                            break
                        _finish_run(run_id, "error", start, error=error)
                        if log_fn:
                            log_fn("system", "error", f"❌ Workflow thất bại sau {int((datetime.now()-start).total_seconds()*1000)}ms")
                        return
                    current_input = output
            elif btype == "sql_to_excel":
                sql_query = bdata.get("sqlQuery", "").strip()
                excel_filename = bdata.get("excelFileName", "export.xlsx").strip()
                if not excel_filename:
                    excel_filename = "export.xlsx"
                
                if not sql_query:
                    if log_fn:
                        log_fn(bid, "warning", f"⚠️ Block [{label}] không có câu lệnh SQL")
                    continue_branch = False
                else:
                    packages_to_install = ["pandas", "sqlalchemy", "openpyxl"]
                    if isinstance(current_input, dict):
                        db_type = current_input.get("db_type")
                        if db_type == "postgresql": packages_to_install.append("psycopg2-binary")
                        elif db_type == "mysql": packages_to_install.extend(["pymysql", "cryptography"])
                        elif db_type == "sqlserver": packages_to_install.append("pyodbc")
                    
                    ensure_packages(project_id, packages_to_install, log_fn, bid, label, stop_event)
                    
                    if log_fn:
                        log_fn(bid, "info", f"⚡ Đang chạy SQL to Excel: {label}...")
                    
                    code = f'''
import pandas as pd
import sqlalchemy
import os

conn_str = input_data.get("connection_string")
if not conn_str:
    raise ValueError("Không tìm thấy connection_string từ khối trước. Hãy đảm bảo nối khối này vào sau khối Database.")

print("Đang kết nối CSDL và thực thi câu lệnh SQL...")
engine = sqlalchemy.create_engine(conn_str)
df = pd.read_sql("""{sql_query}""", engine)

file_name = {excel_filename!r}
out_path = os.path.join(OUTPUT_DIR, file_name)

print(f"Đã tải {{len(df)}} dòng dữ liệu! Đang lưu vào {{out_path}}...")
df.to_excel(out_path, index=False)

output_data = {{"status": "success", "file_path": out_path}}
'''
                    success, output, error, duration = run_python_block_sync(
                        project_id, bid, workflow_id, code, current_input, 
                        timeout=1800, label=label, log_fn=log_fn, input_dir=str(input_dir),
                        stop_event=stop_event
                    )
                    if not success:
                        _finish_run(run_id, "error", start, error=error)
                        if log_fn:
                            log_fn("system", "error", f"❌ Workflow thất bại sau {int((datetime.now()-start).total_seconds()*1000)}ms")
                        return
                    current_input = output
            elif btype == "merge_excel":
                header_rows = int(bdata.get("headerRows", 3))
                excel_filename = bdata.get("excelFileName", "merged.xlsx").strip()
                merge_all_input = bdata.get("mergeAllInput", True)
                selected_files = bdata.get("selectedFiles", [])
                if not excel_filename:
                    excel_filename = "merged.xlsx"
                
                # Nếu bật chọn tất cả Input: tự động quét toàn bộ file trong INPUT_DIR
                if merge_all_input:
                    selected_files = None  # Sẽ tự quét trong code Python
                elif not selected_files:
                    if log_fn:
                        log_fn(bid, "error", f"❌ Merge Excel: Bạn chưa chọn file nào để gộp!")
                    _finish_run(run_id, "error", start, error="No files selected")
                    return
                
                packages_to_install = ["pandas", "openpyxl"]
                ensure_packages(project_id, packages_to_install, log_fn, bid, label, stop_event)
                
                if log_fn:
                    log_fn(bid, "info", f"⚡ Đang chạy Merge Excel: {label}...")
                
                if merge_all_input:
                    file_list_code = """
# T\u1ef1 đ\u1ed9ng qu\u00e9t t\u1ea5t c\u1ea3 file .xlsx/.csv trong INPUT_DIR
file_list = sorted([f for f in os.listdir(INPUT_DIR) if f.endswith('.xlsx') or f.endswith('.csv')])
print(f"T\u1ef1 đ\u1ed9ng ph\u00e1t hi\u1ec7n {len(file_list)} file trong th\u01b0 m\u1ee5c Input.")
"""
                else:
                    _fl = selected_files
                    file_list_code = f"""file_list = {_fl!r}\nprint(f\"\u0110ang gh\u00e9p {{len(file_list)}} file \u0111\u00e3 ch\u1ecdn.\")"""

                code = f'''
import os
import pandas as pd
import openpyxl

{file_list_code}

if not file_list:
    raise ValueError(f"Không tìm thấy file .xlsx nào trong Dữ liệu Workflow (INPUT_DIR)")

print(f"Bắt đầu ghép. Giữ nguyên {{ {header_rows} }} dòng tiêu đề từ file đầu tiên...")

file1_path = os.path.join(INPUT_DIR, file_list[0])
if not os.path.exists(file1_path):
    file1_path = os.path.join(OUTPUT_DIR, file_list[0])
    
if not os.path.exists(file1_path):
    raise FileNotFoundError(f"Không tìm thấy file Gốc: {{file_list[0]}}")

# 1. Dùng openpyxl mở File 1 để giữ trọn vẹn Format tiêu đề
print(f"Đang xử lý định dạng tiêu đề từ File 1: {{file_list[0]}}")
wb = openpyxl.load_workbook(file1_path)
ws = wb.active

# Xóa toàn bộ dữ liệu bên dưới dòng tiêu đề (Để lấy format chuẩn cho phần data sau này)
if ws.max_row > {header_rows}:
    ws.delete_rows({header_rows} + 1, ws.max_row)

# 2. Dùng pandas đọc phần Data của TẤT CẢ các file (Bao gồm cả file 1)
dfs = []
for filename in file_list:
    file_path = os.path.join(INPUT_DIR, filename)
    if not os.path.exists(file_path):
        file_path = os.path.join(OUTPUT_DIR, filename)
        
    print(f"   + Đang đọc dữ liệu: {{filename}}")
    
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Không tìm thấy file: {{filename}}")
        
    # Bỏ qua header_rows, chỉ lấy Data thô
    df = pd.read_excel(file_path, header=None, skiprows={header_rows})
    dfs.append(df)

print("Đang gộp và đắp dữ liệu vào bảng...")
merged_df = pd.concat(dfs, ignore_index=True)

# 3. Ghi dữ liệu vào Workbook đã có sẵn tiêu đề đẹp
# Chuyển DataFrame thành list các dòng để append vào openpyxl siêu nhanh
for row in merged_df.itertuples(index=False, name=None):
    ws.append(row)

out_file = {excel_filename!r}
out_path = os.path.join(OUTPUT_DIR, out_file)

print(f"Đang lưu file kết quả (Gồm {header_rows} dòng tiêu đề + {{len(merged_df)}} dòng dữ liệu) vào {{out_path}}...")
try:
    wb.save(out_path)
except PermissionError:
    raise PermissionError(f"Không thể lưu đè file {{out_file}} do file này đang được mở trong Excel. Vui lòng đóng file Excel và chạy lại.")
output_data = {{"status": "success", "file_path": out_path}}
'''
                success, output, error, duration = run_python_block_sync(
                    project_id, bid, workflow_id, code, current_input, 
                    timeout=1800, label=label, log_fn=log_fn, input_dir=str(input_dir),
                    stop_event=stop_event
                )
                if not success:
                    _finish_run(run_id, "error", start, error=error)
                    if log_fn:
                        log_fn("system", "error", f"❌ Workflow thất bại sau {int((datetime.now()-start).total_seconds()*1000)}ms")
                    return
                current_input = output
            elif btype == "pivot_excel":
                excel_filename = bdata.get("excelFileName", "pivot_result.xlsx").strip()
                selected_files = bdata.get("pivotInputFiles", [])
                pivot_index = bdata.get("pivotIndex", "")
                pivot_columns = bdata.get("pivotColumns", "")
                pivot_values = bdata.get("pivotValues", "")
                pivot_agg = bdata.get("pivotAgg", "sum")
                pivot_fillna = bdata.get("pivotFillNa", True)
                pivot_grand_total = bdata.get("pivotGrandTotal", True)
                pivot_header_row = int(bdata.get("pivotHeaderRow", 1))
                pivot_enable_sort = bdata.get("pivotEnableSort", False)
                pivot_sort_column = bdata.get("pivotSortColumn", "").strip()
                pivot_sort_order = bdata.get("pivotSortOrder", "asc")
                pivot_sort_custom = bdata.get("pivotSortCustom", [])
                
                if not excel_filename:
                    excel_filename = "pivot_result.xlsx"
                
                if not selected_files:
                    if log_fn:
                        log_fn(bid, "error", f"❌ Pivot Excel: Bạn chưa chọn file nào để tổng hợp!")
                    _finish_run(run_id, "error", start, error="No files selected")
                    return
                
                packages_to_install = ["pandas", "openpyxl"]
                ensure_packages(project_id, packages_to_install, log_fn, bid, label, stop_event)
                
                if log_fn:
                    log_fn(bid, "info", f"📊 Đang chạy Pivot Excel: {label}...")
                
                code = f'''
import os
import pandas as pd

print(f"Đang tìm kiếm {{len({selected_files!r})}} file Excel trong thư mục: {{INPUT_DIR}}...")
file_list = {selected_files!r}

if not file_list:
    raise ValueError(f"Không tìm thấy file nào để xử lý.")

dfs = []
for filename in file_list:
    file_path = os.path.join(INPUT_DIR, filename)
    if not os.path.exists(file_path):
        file_path = os.path.join(OUTPUT_DIR, filename)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Không tìm thấy file: {{filename}}")
    
    print(f"Đang đọc dữ liệu: {{filename}} (header dòng {{ {pivot_header_row} }})")
    pd_header_idx = max(0, {pivot_header_row} - 1)
    if filename.endswith(".csv"):
        df = pd.read_csv(file_path, header=pd_header_idx)
    else:
        df = pd.read_excel(file_path, header=pd_header_idx)
    dfs.append(df)

df = pd.concat(dfs, ignore_index=True)

def col2num(col_str):
    num = 0
    for c in str(col_str).upper():
        if 'A' <= c <= 'Z':
            num = num * 26 + (ord(c) - ord('A') + 1)
        else:
            return -1
    return num - 1

# Lọc và dọn dẹp biến đầu vào
def parse_cols(col_data):
    if not col_data: return []
    if isinstance(col_data, str):
        cols = [c.strip() for c in col_data.split(',')]
    elif isinstance(col_data, list):
        cols = [str(c).strip() for c in col_data]
    else:
        return []
        
    parsed = []
    for c in cols:
        if not c: continue
        if c in df.columns:
            parsed.append(c)
        else:
            idx = col2num(c)
            if 0 <= idx < len(df.columns):
                parsed.append(df.columns[idx])
            else:
                print(f"Cảnh báo: Không tìm thấy cột '{{c}}'")
    return parsed

idx_cols = parse_cols({pivot_index!r})
col_cols = parse_cols({pivot_columns!r})
val_cols = parse_cols({pivot_values!r})

if not val_cols:
    print("Cảnh báo: Không có cột Giá trị (Values) nào hợp lệ. Sẽ dùng toàn bộ cột số.")
    val_cols = df.select_dtypes(include='number').columns.tolist()
if not idx_cols and not col_cols:
    raise ValueError("Phải nhập ít nhất 1 trường Dòng (Rows) hoặc Cột (Columns).")

sort_col_parsed = parse_cols({pivot_sort_column!r})
sort_col = sort_col_parsed[0] if sort_col_parsed else None

if {pivot_enable_sort} and sort_col and sort_col in df.columns:
    print(f"Đang phân loại và sắp xếp cột '{{sort_col}}' theo chiều: {{ {pivot_sort_order!r} }}")
    if {pivot_sort_order!r} == 'custom':
        custom_order = {pivot_sort_custom!r}
        # Xử lý Pandas4Warning: bổ sung các giá trị còn thiếu vào cuối danh sách categories
        unique_vals = df[sort_col].dropna().unique().tolist()
        # Ép kiểu custom_order về cùng kiểu với dữ liệu để so sánh chính xác nếu cần
        try:
            custom_order = pd.Series(custom_order).astype(df[sort_col].dtype).tolist()
        except:
            pass
        missing_cats = [x for x in unique_vals if x not in custom_order]
        custom_order.extend(missing_cats)
        df[sort_col] = pd.Categorical(df[sort_col], categories=custom_order, ordered=True)
    elif {pivot_sort_order!r} == 'asc':
        cats = sorted(df[sort_col].dropna().unique().tolist(), key=str)
        df[sort_col] = pd.Categorical(df[sort_col], categories=cats, ordered=True)
    elif {pivot_sort_order!r} == 'desc':
        cats = sorted(df[sort_col].dropna().unique().tolist(), key=str, reverse=True)
        df[sort_col] = pd.Categorical(df[sort_col], categories=cats, ordered=True)

print(f"Đang Pivot với Dòng={{idx_cols}}, Cột={{col_cols}}, Giá trị={{val_cols}}, Hàm={pivot_agg!r}")

pivot_df = pd.pivot_table(
    df, 
    values=val_cols, 
    index=idx_cols if idx_cols else None, 
    columns=col_cols if col_cols else None, 
    aggfunc={pivot_agg!r}, 
    margins={pivot_grand_total},
    margins_name="Tổng Cộng"
)

if {pivot_fillna}:
    pivot_df = pivot_df.fillna(0)

# Làm phẳng cột đa cấp (nếu có)
if isinstance(pivot_df.columns, pd.MultiIndex):
    new_cols = []
    for col in pivot_df.columns.values:
        valid_parts = [str(c) for c in col if str(c) != '']
        if not valid_parts:
            new_cols.append('')
        elif len(valid_parts) > 1 and valid_parts[0] in val_cols:
            new_cols.append('_'.join(valid_parts[1:]))
        else:
            new_cols.append('_'.join(valid_parts))
    pivot_df.columns = new_cols

out_file = {excel_filename!r}
out_path = os.path.join(OUTPUT_DIR, out_file)

# Reset index để lưu ra file excel đẹp hơn
pivot_df.reset_index(inplace=True)

print(f"Đang lưu file Pivot kết quả vào {{out_path}}...")
try:
    pivot_df.to_excel(out_path, index=False)
except PermissionError:
    raise PermissionError(f"Không thể lưu đè file {{out_file}} do file này đang được mở trong Excel.")

output_data = {{"status": "success", "file_path": out_path}}
'''
                success, output, error, duration = run_python_block_sync(
                    project_id, bid, workflow_id, code, current_input, 
                    timeout=1800, label=label, log_fn=log_fn, input_dir=str(input_dir),
                    stop_event=stop_event
                )
                if not success:
                    _finish_run(run_id, "error", start, error=error)
                    if log_fn:
                        log_fn("system", "error", f"❌ Workflow thất bại sau {int((datetime.now()-start).total_seconds()*1000)}ms")
                    return
                current_input = output
            elif btype == "condition":
                logical_op = bdata.get("logicalOperator", "AND").upper()
                conditions = bdata.get("conditions")
                
                # Backward compatibility
                if not conditions:
                    conditions = [{
                        "condVariable": bdata.get("condVariable", "").strip(),
                        "condOperator": bdata.get("condOperator", "=="),
                        "condValue": bdata.get("condValue", "").strip()
                    }]
                
                if not conditions:
                    if log_fn:
                        log_fn(bid, "warning", f"⚠️ Block [{label}] không có điều kiện nào")
                    continue_branch = False
                    continue

                if log_fn:
                    log_fn(bid, "info", f"🤔 Đang kiểm tra {len(conditions)} điều kiện ({logical_op})")
                
                try:
                    results = []
                    for idx, cond in enumerate(conditions):
                        cond_var = cond.get("condVariable", "").strip()
                        cond_op = cond.get("condOperator", "==")
                        cond_val = cond.get("condValue", "").strip()
                        
                        actual_val = None
                        if isinstance(current_input, dict):
                            actual_val = current_input.get(cond_var)
                        
                        result = False
                        cmp_val = cond_val
                        if isinstance(actual_val, int):
                            try: cmp_val = int(cond_val)
                            except: pass
                        elif isinstance(actual_val, float):
                            try: cmp_val = float(cond_val)
                            except: pass
                        elif isinstance(actual_val, bool):
                            cmp_val = str(cond_val).lower() == 'true'
                            
                        if cond_op == "==":
                            result = (actual_val == cmp_val) or (str(actual_val) == str(cmp_val))
                        elif cond_op == "!=":
                            result = (actual_val != cmp_val) and (str(actual_val) != str(cmp_val))
                        elif cond_op == ">":
                            result = float(actual_val) > float(cmp_val)
                        elif cond_op == "<":
                            result = float(actual_val) < float(cmp_val)
                        elif cond_op == ">=":
                            result = float(actual_val) >= float(cmp_val)
                        elif cond_op == "<=":
                            result = float(actual_val) <= float(cmp_val)
                        elif cond_op == "contains":
                            result = str(cmp_val) in str(actual_val)
                            
                        results.append(result)
                        if log_fn:
                            log_fn(bid, "info", f"   [{idx+1}] {cond_var} ({actual_val}) {cond_op} {cmp_val} ➜ {result}")
                            
                    # Calculate final result
                    if logical_op == "OR":
                        final_result = any(results)
                    else: # AND
                        final_result = all(results)
                        
                    cond_branch_taken = "true" if final_result else "false"
                    if log_fn:
                        log_fn(bid, "success", f"✅ Kết quả chung: {final_result}")
                except Exception as e:
                    if log_fn:
                        log_fn(bid, "error", f"❌ Lỗi so sánh: {e}")
                    final_status = "error"
                    break
            elif btype == "loop":
                mode = bdata.get("loopMode", "count")
                delay = float(bdata.get("loopDelay") or 0)
                
                # Check run count
                state = loop_states.setdefault(bid, {"runs": 0})

                state["runs"] += 1
                
                if mode == "count":
                    max_count = int(bdata.get("loopCount", 0))
                    if log_fn:
                        log_fn(bid, "info", f"🔁 [Loop] Lần lặp {state['runs']} / {max_count}")
                    # "< " chứ không phải "<=": ở lần lặp thứ max_count, phải dừng NGAY (không
                    # ra lệnh chạy lại khối trước Loop thêm 1 lần thừa) - cùng lỗi off-by-one
                    # như chế độ điều kiện.
                    cond_branch_taken = "loop" if state["runs"] < max_count else "endloop"
                    if log_fn:
                        log_fn(bid, "success", f"✅ [Loop] Đi nhánh: {cond_branch_taken}")
                else: # condition
                    logical_op = bdata.get("logicalOperator", "AND").upper()
                    conditions = bdata.get("conditions")
                    max_count = int(bdata.get("loopMaxCount") or 0)

                    if not conditions:
                        if log_fn:
                            log_fn(bid, "warning", f"⚠️ Block [{label}] không có điều kiện nào")
                        continue_branch = False
                        continue

                    if log_fn:
                        log_fn(bid, "info", f"🔁 [Loop] Lần lặp {state['runs']}/{max_count or '∞'} - Kiểm tra {len(conditions)} điều kiện ({logical_op})")

                    try:
                        results = []
                        for idx, cond in enumerate(conditions):
                            cond_var = cond.get("condVariable", "").strip()
                            cond_op = cond.get("condOperator", "==")
                            cond_val = cond.get("condValue", "").strip()

                            actual_val = None
                            if isinstance(current_input, dict):
                                actual_val = current_input.get(cond_var)

                            result = False
                            cmp_val = cond_val
                            if isinstance(actual_val, int):
                                try: cmp_val = int(cond_val)
                                except: pass
                            elif isinstance(actual_val, float):
                                try: cmp_val = float(cond_val)
                                except: pass
                            elif isinstance(actual_val, bool):
                                cmp_val = str(cond_val).lower() == 'true'

                            if cond_op == "==":
                                result = (actual_val == cmp_val) or (str(actual_val) == str(cmp_val))
                            elif cond_op == "!=":
                                result = (actual_val != cmp_val) and (str(actual_val) != str(cmp_val))
                            elif cond_op == ">":
                                result = float(actual_val) > float(cmp_val)
                            elif cond_op == "<":
                                result = float(actual_val) < float(cmp_val)
                            elif cond_op == ">=":
                                result = float(actual_val) >= float(cmp_val)
                            elif cond_op == "<=":
                                result = float(actual_val) <= float(cmp_val)
                            elif cond_op == "contains":
                                result = str(cmp_val) in str(actual_val)

                            results.append(result)
                            if log_fn:
                                log_fn(bid, "info", f"   [{idx+1}] {cond_var} ({actual_val}) {cond_op} {cmp_val} ➜ {result}")

                        if logical_op == "OR":
                            final_result = any(results)
                        else: # AND
                            final_result = all(results)

                        if final_result:
                            # Điều kiện ĐÚNG -> true
                            cond_branch_taken = "true"
                        elif max_count and state["runs"] > max_count:
                            # loopMaxCount = số lần được PHÉP quay lại nhánh Loop (retry),
                            # KHÔNG tính lần chạy đầu tiên. VD max=2: lượt 1 và lượt 2 vẫn
                            # được phép "loop" (đúng 2 lần quay lại), chỉ lượt 3 mới bị chặn
                            # -> tổng số lần chạy khối trước Loop = max_count + 1.
                            cond_branch_taken = "endloop"
                            if log_fn:
                                log_fn(bid, "warning", f"⚠️ [Loop] Đã dùng hết {max_count} lần quay lại cho phép - dừng dù điều kiện chưa đúng")
                        else:
                            cond_branch_taken = "loop"

                        if log_fn:
                            log_fn(bid, "success", f"✅ [Loop] Kết quả chung: {final_result} -> {cond_branch_taken}")
                    except Exception as e:
                        if log_fn:
                            log_fn(bid, "error", f"❌ Lỗi so sánh vòng lặp: {e}")
                        final_status = "error"
                        break

            if continue_branch and final_status != "error":
                if btype == "loop" and cond_branch_taken == "loop":
                    delay = float(bdata.get("loopDelay") or 0)
                    if delay > 0:
                        if log_fn:
                            log_fn(bid, "info", f"⏳ [Loop] Nghỉ {delay}s trước khi lặp lại...")
                        time.sleep(delay)

                out_edges = edges_from.get(node_id, [])
                for e in out_edges:
                    target_id = e["target"]
                    source_handle = e.get("sourceHandle")
                    
                    # Xử lý rẽ nhánh điều kiện và vòng lặp
                    if btype in ("condition", "loop"):
                        if source_handle == cond_branch_taken:
                            queue.append((target_id, current_input))
                    else:
                        queue.append((target_id, current_input))

        total_ms = int((datetime.now() - start).total_seconds() * 1000)
        _finish_run(run_id, final_status, start)
        if log_fn:
            if final_status == "success":
                log_fn("system", "success", f"✅ Workflow hoàn thành trong {total_ms}ms")
            elif final_status == "stopped":
                log_fn("system", "warning", f"⏹ Đã dừng sau {total_ms}ms")
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        _finish_run(run_id, "error", start, error=str(e))
        if log_fn:
            log_fn("system", "error", f"❌ Lỗi hệ thống khi chạy workflow: {str(e)}")
        print(f"CRITICAL ERROR IN WORKFLOW THREAD: {err_msg}")


def _finish_run(run_id, status, start, error=None):
    finished = datetime.now()
    duration = int((finished - start).total_seconds() * 1000)
    with sqlite3.connect(str(WORKFLOW_DB)) as conn:
        conn.execute(
            "UPDATE workflow_run SET status=?, finished_at=?, duration_ms=?, error_message=? WHERE id=?",
            (status, finished.isoformat(), duration, error, run_id)
        )
    _active_runs.pop(run_id, None)
    _active_procs.pop(run_id, None)
    # Xóa run_id khỏi workflow mapping
    for wf_id, run_set in list(_workflow_run_ids.items()):
        run_set.discard(run_id)
        if not run_set:
            _workflow_run_ids.pop(wf_id, None)

