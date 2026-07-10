"""
Execution Engine — Chạy tuần tự các block Python trong workflow.

Luồng thực thi:
1. Parse graph JSON → sắp xếp blocks theo thứ tự topology
2. Với mỗi block Python: chạy code qua subprocess với venv của project
3. Truyền `output_data` từ block này làm `input_data` cho block tiếp theo
4. Stream log qua WebSocket real-time
5. Lưu kết quả vào WorkflowRun

Cơ chế sandbox:
- Mỗi block chạy trong subprocess riêng → cô lập hoàn toàn
- Timeout mặc định 60 giây/block
- input_data inject qua stdin dạng JSON
- output_data đọc từ stdout dạng JSON
"""
import json
import asyncio
import subprocess
import sys
import os
from datetime import datetime
from typing import Optional, Callable, AsyncGenerator
from pathlib import Path

from services.venv_manager import get_python_path, venv_exists, create_venv

# Template wrapper để chạy code của user an toàn
RUNNER_TEMPLATE = """
import sys
import json
import traceback

# Inject input_data từ stdin
_raw = sys.stdin.read()
input_data = json.loads(_raw) if _raw.strip() else None
workflow_id = {workflow_id!r}
block_id = {block_id!r}

output_data = None

try:
{user_code}
except Exception as _e:
    print(f"[ERROR] " + traceback.format_exc(), file=sys.stderr)
    sys.exit(1)

# Ghi output_data ra stdout dạng JSON
try:
    _out = json.dumps(output_data, ensure_ascii=False, default=str)
except Exception:
    _out = json.dumps(str(output_data))
print("__OUTPUT__:" + _out)
"""


def indent_code(code: str, spaces: int = 4) -> str:
    """Indent code để nhúng vào template"""
    return "\n".join(" " * spaces + line for line in code.splitlines())


def topological_sort(nodes: list, edges: list) -> list:
    """
    Sắp xếp nodes theo thứ tự topo từ start → end
    dựa vào danh sách edges (source → target)
    """
    adj = {n["id"]: [] for n in nodes}
    in_deg = {n["id"]: 0 for n in nodes}

    for edge in edges:
        src = edge.get("source")
        tgt = edge.get("target")
        if src in adj and tgt in adj:
            adj[src].append(tgt)
            in_deg[tgt] = in_deg.get(tgt, 0) + 1

    # Kahn's algorithm
    queue = [nid for nid, deg in in_deg.items() if deg == 0]
    ordered_ids = []
    while queue:
        nid = queue.pop(0)
        ordered_ids.append(nid)
        for nxt in adj.get(nid, []):
            in_deg[nxt] -= 1
            if in_deg[nxt] == 0:
                queue.append(nxt)

    node_map = {n["id"]: n for n in nodes}
    return [node_map[nid] for nid in ordered_ids if nid in node_map]


class BlockExecutionResult:
    def __init__(self, block_id: str, success: bool, output=None, error: str = None, duration_ms: int = 0):
        self.block_id = block_id
        self.success = success
        self.output = output
        self.error = error
        self.duration_ms = duration_ms


async def run_python_block(
    project_id: str,
    block_id: str,
    workflow_id: str,
    code: str,
    input_data,
    timeout: int = 60,
    log_callback: Optional[Callable] = None,
) -> BlockExecutionResult:
    """
    Chạy 1 block Python trong subprocess với venv của project.
    Returns: BlockExecutionResult
    """
    if not venv_exists(project_id):
        await create_venv(project_id)

    python_exe = get_python_path(project_id)
    wrapped = RUNNER_TEMPLATE.format(
        workflow_id=workflow_id,
        block_id=block_id,
        user_code=indent_code(code),
    )
    input_json = json.dumps(input_data, ensure_ascii=False, default=str)

    start_time = datetime.utcnow()

    if log_callback:
        await log_callback(block_id, "info", f"▶  Bắt đầu chạy block [{block_id}]")

    try:
        proc = await asyncio.create_subprocess_exec(
            python_exe, "-c", wrapped,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=input_json.encode("utf-8")),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            duration = int((datetime.utcnow() - start_time).total_seconds() * 1000)
            msg = f"⏰ Block [{block_id}] timeout sau {timeout}s"
            if log_callback:
                await log_callback(block_id, "error", msg)
            return BlockExecutionResult(block_id, False, error=msg, duration_ms=duration)

        duration = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        stdout_text = stdout.decode("utf-8", errors="replace")
        stderr_text = stderr.decode("utf-8", errors="replace")

        # Stream stdout lines (trừ dòng __OUTPUT__)
        output_data = None
        for line in stdout_text.splitlines():
            if line.startswith("__OUTPUT__:"):
                try:
                    output_data = json.loads(line[len("__OUTPUT__:"):])
                except Exception:
                    output_data = line[len("__OUTPUT__:"):]
            else:
                if line.strip() and log_callback:
                    await log_callback(block_id, "info", f"   {line}")

        # Stream stderr
        if stderr_text.strip():
            for line in stderr_text.splitlines():
                if line.strip() and log_callback:
                    await log_callback(block_id, "error", f"   ⚠ {line}")

        if proc.returncode != 0:
            err = stderr_text.strip() or "Unknown error"
            if log_callback:
                await log_callback(block_id, "error", f"✗ Block [{block_id}] thất bại ({duration}ms)")
            return BlockExecutionResult(block_id, False, error=err, duration_ms=duration)

        if log_callback:
            await log_callback(block_id, "success", f"✓ Block [{block_id}] hoàn thành ({duration}ms)")
        return BlockExecutionResult(block_id, True, output=output_data, duration_ms=duration)

    except Exception as e:
        duration = int((datetime.utcnow() - start_time).total_seconds() * 1000)
        if log_callback:
            await log_callback(block_id, "error", f"✗ Lỗi nội bộ: {e}")
        return BlockExecutionResult(block_id, False, error=str(e), duration_ms=duration)


async def execute_workflow(
    project_id: str,
    workflow_id: str,
    run_id: str,
    graph_json: str,
    log_callback: Optional[Callable] = None,
    stop_flag: Optional[asyncio.Event] = None,
) -> dict:
    """
    Thực thi toàn bộ workflow theo thứ tự topology.

    Returns:
        {
            "status": "success" | "error" | "stopped",
            "block_results": [...],
            "final_output": ...,
            "total_duration_ms": int,
        }
    """
    start_time = datetime.utcnow()

    try:
        graph = json.loads(graph_json)
    except Exception as e:
        return {"status": "error", "error": f"Graph JSON không hợp lệ: {e}"}

    nodes = graph.get("nodes", [])
    edges = graph.get("edges", [])

    if log_callback:
        await log_callback("system", "info", f"🚀 Bắt đầu workflow [{workflow_id}] với {len(nodes)} blocks")

    # Sắp xếp theo topology
    ordered = topological_sort(nodes, edges)

    current_input = None
    block_results = []
    final_status = "success"

    for node in ordered:
        # Kiểm tra stop flag
        if stop_flag and stop_flag.is_set():
            if log_callback:
                await log_callback("system", "warning", "⏹ Workflow bị dừng bởi người dùng")
            final_status = "stopped"
            break

        block_type = node.get("data", {}).get("type", "python")
        block_id = node["id"]
        block_data = node.get("data", {})
        label = block_data.get("label", block_id)

        if block_type == "start":
            if log_callback:
                await log_callback(block_id, "info", f"▶  [Start] {label}")
            continue

        if block_type == "end":
            if log_callback:
                await log_callback(block_id, "info", f"🏁 [End] {label} — Workflow hoàn thành")
            continue

        if block_type == "python":
            code = block_data.get("code", "")
            if not code.strip():
                if log_callback:
                    await log_callback(block_id, "warning", f"⚠ Block [{label}] không có code, bỏ qua")
                continue

            result = await run_python_block(
                project_id=project_id,
                block_id=block_id,
                workflow_id=workflow_id,
                code=code,
                input_data=current_input,
                log_callback=log_callback,
            )
            block_results.append({
                "block_id": block_id,
                "label": label,
                "success": result.success,
                "error": result.error,
                "duration_ms": result.duration_ms,
            })

            if not result.success:
                final_status = "error"
                break

            current_input = result.output

        elif block_type == "condition":
            condition = block_data.get("condition", "True")
            if log_callback:
                await log_callback(block_id, "info", f"🔀 [Condition] Kiểm tra: {condition}")

            try:
                cond_result = bool(eval(condition, {"input_data": current_input, "__builtins__": {}}))
                if log_callback:
                    await log_callback(block_id, "info", f"   → Kết quả: {cond_result}")
            except Exception as e:
                if log_callback:
                    await log_callback(block_id, "error", f"✗ Lỗi điều kiện: {e}")
                final_status = "error"
                break

    total_ms = int((datetime.utcnow() - start_time).total_seconds() * 1000)

    if log_callback:
        if final_status == "success":
            await log_callback("system", "success", f"✅ Workflow hoàn thành trong {total_ms}ms")
        elif final_status == "error":
            await log_callback("system", "error", f"❌ Workflow thất bại sau {total_ms}ms")

    return {
        "status": final_status,
        "block_results": block_results,
        "final_output": current_input,
        "total_duration_ms": total_ms,
    }
