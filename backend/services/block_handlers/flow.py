"""Khối rẽ nhánh: Điều kiện (condition) và Vòng lặp (loop).

Hai khối đặt ``step.branch`` = sourceHandle của nhánh được đi; vòng lặp chính chỉ
đẩy sang các cạnh có đúng handle đó.

⚠ So sánh của Condition và của Loop (chế độ điều kiện) KHÁC NHAU có chủ đích lịch
sử: Condition so chuỗi / ``float(x or 0)``; Loop ép kiểu theo giá trị thật. Gộp
làm một sẽ đổi kết quả rẽ nhánh của workflow đang chạy — đừng "dọn" thành chung.
Condition chỉ đọc ``current_input`` (không đọc workflow_env) — cũng cố ý, xem CLAUDE.md.
"""
import ast

from .context import SKIP


def _legacy_conditions(bdata):
    conditions = bdata.get("conditions")
    # Backward compatibility: workflow cũ lưu 1 điều kiện phẳng
    if not conditions and "condVariable" in bdata:
        conditions = [{
            "condVariable": bdata.get("condVariable"),
            "condOperator": bdata.get("condOperator", "=="),
            "condValue": bdata.get("condValue", ""),
        }]
    return conditions


def _compare_condition(actual_val, cond_op, cond_val):
    if cond_op == "==":
        return str(actual_val) == str(cond_val)
    if cond_op == "!=":
        return str(actual_val) != str(cond_val)
    if cond_op == ">":
        return float(actual_val or 0) > float(cond_val or 0)
    if cond_op == "<":
        return float(actual_val or 0) < float(cond_val or 0)
    if cond_op == ">=":
        return float(actual_val or 0) >= float(cond_val or 0)
    if cond_op == "<=":
        return float(actual_val or 0) <= float(cond_val or 0)
    if cond_op == "contains":
        return str(cond_val) in str(actual_val)
    return False


def _coerce_like(actual_val, cond_val):
    """Loop: ép giá trị so sánh về cùng kiểu với giá trị thật.

    Giữ nguyên thứ tự kiểm như bản cũ: bool là lớp con của int nên True/False rơi
    vào nhánh int (int("true") lỗi → so như chuỗi); nhánh bool bên dưới không bao
    giờ chạy tới. Đổi thứ tự = đổi kết quả rẽ nhánh của workflow đang chạy.
    """
    if isinstance(actual_val, int):
        try:
            return int(cond_val)
        except (TypeError, ValueError):
            return cond_val
    if isinstance(actual_val, float):
        try:
            return float(cond_val)
        except (TypeError, ValueError):
            return cond_val
    if isinstance(actual_val, bool):
        return str(cond_val).lower() == "true"
    return cond_val


def _compare_loop(actual_val, cond_op, cmp_val):
    if cond_op == "==":
        return (actual_val == cmp_val) or (str(actual_val) == str(cmp_val))
    if cond_op == "!=":
        return (actual_val != cmp_val) and (str(actual_val) != str(cmp_val))
    if cond_op == ">":
        return float(actual_val) > float(cmp_val)
    if cond_op == "<":
        return float(actual_val) < float(cmp_val)
    if cond_op == ">=":
        return float(actual_val) >= float(cmp_val)
    if cond_op == "<=":
        return float(actual_val) <= float(cmp_val)
    if cond_op == "contains":
        return str(cmp_val) in str(actual_val)
    return False


def _evaluate(ctx, step, conditions, logical_op, loop_semantics):
    results = []
    for idx, cond in enumerate(conditions):
        cond_var = cond.get("condVariable", "").strip()
        cond_op = cond.get("condOperator", "==")
        cond_val = cond.get("condValue", "").strip()
        actual_val = step.current_input.get(cond_var) if isinstance(step.current_input, dict) else None
        if loop_semantics:
            cmp_val = _coerce_like(actual_val, cond_val)
            result = _compare_loop(actual_val, cond_op, cmp_val)
        else:
            cmp_val = cond_val
            result = _compare_condition(actual_val, cond_op, cond_val)
        results.append(result)
        ctx.log(step.bid, "info", "condition_detail_line", idx=idx + 1, var=cond_var,
                actual=actual_val, op=cond_op, cmp=cmp_val, result=result)
    return any(results) if logical_op == "OR" else all(results)


def handle_condition(ctx, step):
    logical_op = step.bdata.get("logicalOperator", "AND").upper()
    conditions = _legacy_conditions(step.bdata)
    if not conditions:
        ctx.log(step.bid, "warning", "condition_no_conditions", label=step.label)
        return SKIP

    ctx.log(step.bid, "info", "condition_checking", count=len(conditions), op=logical_op)
    try:
        final_result = _evaluate(ctx, step, conditions, logical_op, loop_semantics=False)
    except Exception as e:
        ctx.log(step.bid, "error", "condition_compare_error", error=e)
        return ctx.fail(step, f"Lỗi so sánh điều kiện: {e}")
    step.branch = "true" if final_result else "false"
    ctx.log(step.bid, "success", "condition_final_result", result=final_result)


def _loop_array_data(ctx, step, raw_var):
    """Loop đọc ``loopArrayVar`` — chấp cả ``{{ten}}`` lẫn tên trần (CLAUDE.md mục 9)."""
    name = str(raw_var).strip()
    if name.startswith("{{") and name.endswith("}}"):
        name = name[2:-2].strip()

    data = None
    if isinstance(step.current_input, dict) and name in step.current_input:
        data = step.current_input[name]
    elif name in ctx.workflow_env:
        data = ctx.workflow_env[name]

    if data is None:
        val = step.interpolate(str(raw_var))
        if isinstance(val, list):
            data = val
        elif isinstance(val, str) and val.startswith("["):
            try:
                data = ast.literal_eval(val)
            except Exception:  # literal_eval có thể ném nhiều loại; chuỗi rác = mảng rỗng
                pass
    return name, (data if isinstance(data, list) else [])


def handle_loop(ctx, step):
    bid, bdata = step.bid, step.bdata
    mode = bdata.get("loopMode", "count")
    state = ctx.loop_states.setdefault(bid, {"runs": 0})
    state["runs"] += 1

    if not isinstance(step.current_input, dict):
        step.current_input = {"previous_input": step.current_input}
    step.current_input["loop_iteration"] = state["runs"]

    if mode == "count":
        max_count = int(bdata.get("loopCount", 0))
        ctx.log(bid, "info", "loop_iteration_count", runs=state["runs"], max_count=max_count)
        # "<" chứ không phải "<=": ở lần lặp thứ max_count phải dừng NGAY (không chạy
        # lại khối trước Loop thêm 1 lần thừa).
        step.branch = "loop" if state["runs"] < max_count else "endloop"
        ctx.log(bid, "success", "loop_branch_taken", branch=step.branch)
        return None

    if mode == "array":
        array_var_name, array_data = _loop_array_data(ctx, step, bdata.get("loopArrayVar", "sheets_data"))
        total = len(array_data)
        ctx.log(bid, "info", "loop_iteration_array", runs=state["runs"], total=total, array_var=array_var_name)

        if 0 < state["runs"] <= total:
            current_item = array_data[state["runs"] - 1]
            if isinstance(current_item, dict):
                for k, v in current_item.items():
                    step.current_input[k] = v
                    ctx.workflow_env[k] = v
            else:
                # Tôn trọng ô "Tên biến phần tử" (loopItemVar). Trước đây key bị hardcode
                # "item" → ai đặt tên khác thấy {{ten}} LUÔN RỖNG. Mặc định FE là 'item'.
                item_var = (bdata.get("loopItemVar") or "item").strip() or "item"
                step.current_input[item_var] = current_item
                ctx.workflow_env[item_var] = current_item
            step.branch = "loop"
            ctx.log(bid, "success", "loop_branch_continue_array", runs=state["runs"], total=total)
        else:
            step.branch = "endloop"
            ctx.log(bid, "success", "loop_array_done", total=total)
        return None

    # mode == "condition"
    logical_op = bdata.get("logicalOperator", "AND").upper()
    conditions = bdata.get("conditions")
    max_count = int(bdata.get("loopMaxCount") or 0)
    if not conditions:
        ctx.log(bid, "warning", "condition_no_conditions", label=step.label)
        return SKIP

    ctx.log(bid, "info", "loop_condition_iteration", runs=state["runs"], max_count=max_count or "∞",
            count=len(conditions), op=logical_op)
    try:
        final_result = _evaluate(ctx, step, conditions, logical_op, loop_semantics=True)
    except Exception as e:
        ctx.log(bid, "error", "loop_compare_error", error=e)
        return ctx.fail(step, f"Lỗi so sánh vòng lặp: {e}")

    if final_result:
        step.branch = "true"
    elif max_count and state["runs"] > max_count:
        # loopMaxCount = số lần được PHÉP quay lại nhánh Loop (retry), KHÔNG tính lần
        # chạy đầu. VD max=2: tổng số lần chạy khối trước Loop = max_count + 1.
        step.branch = "endloop"
        ctx.log(bid, "warning", "loop_max_reached", max_count=max_count)
    else:
        step.branch = "loop"
    ctx.log(bid, "success", "loop_condition_result", result=final_result, branch=step.branch)


HANDLERS = {
    "condition": handle_condition,
    "loop": handle_loop,
}
