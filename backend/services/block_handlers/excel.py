"""Khối Excel: Ghép file (merge), Pivot, Xử lý Excel (excel_edit).

Merge/Pivot chạy script cố định trong ``services/block_scripts/`` (xem sql.py).
"""
from services import executor_blocks as eb
from services.excel_edit import (
    ExcelEditError, apply_steps as excel_edit_apply_steps, normalize_output_name,
    read_grid, resolve_steps as excel_edit_resolve_steps, write_grid,
)

from .common import ensure_block_packages, finish_script, run_script, script_code


def handle_merge_excel(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    header_rows = int(bdata.get("headerRows", 3))
    excel_filename = eb.safe_filename(bdata.get("excelFileName", ""), "merged_excel.xlsx") or "merged_excel.xlsx"
    merge_mode = bdata.get("mergeMode") or ("all_input" if bdata.get("mergeAllInput", True) else "custom")
    merge_all = merge_mode in ("all_input", "all_output")
    selected_files = bdata.get("selectedFiles", [])

    if not merge_all and not selected_files:
        ctx.log(bid, "error", "merge_excel_no_files")
        return ctx.fail(step, "No files selected")

    ensure_block_packages(ctx, step)
    ctx.log(bid, "info", "merge_excel_running", label=label)

    code = script_code("merge_excel", {
        "header_rows": header_rows, "merge_mode": merge_mode,
        "selected_files": selected_files, "excel_filename": excel_filename,
    })
    return finish_script(ctx, step, run_script(ctx, step, code))


def handle_pivot_excel(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    excel_filename = eb.safe_filename(bdata.get("excelFileName", ""), "pivot.xlsx") or "pivot.xlsx"
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

    if not selected_files:
        ctx.log(bid, "error", "pivot_excel_no_files")
        return ctx.fail(step, "No files selected")

    ensure_block_packages(ctx, step)
    ctx.log(bid, "info", "pivot_excel_running", label=label)

    code = script_code("pivot_excel", {
        "selected_files": selected_files, "excel_filename": excel_filename,
        "index": pivot_index, "columns": pivot_columns, "values": pivot_values,
        "agg": pivot_agg, "fillna": bool(pivot_fillna), "grand_total": bool(pivot_grand_total),
        "header_row": pivot_header_row, "enable_sort": bool(pivot_enable_sort),
        "sort_column": pivot_sort_column, "sort_order": pivot_sort_order,
        "sort_custom": pivot_sort_custom,
    })
    return finish_script(ctx, step, run_script(ctx, step, code))


def handle_excel_edit(ctx, step):
    """Chạy INLINE trong backend (pandas) như excel_read, không sinh script con."""
    bdata, bid, label = step.bdata, step.bid, step.label
    language = ctx.language
    try:
        src_name = eb.safe_filename(bdata.get("excelEditSourceFile", ""), "")
        if not src_name:
            raise ExcelEditError("no_source")
        raw_steps = bdata.get("excelEditSteps") or []
        if not raw_steps:
            raise ExcelEditError("no_steps")

        src_path = ctx.input_dir / src_name
        if not src_path.exists():
            src_path = ctx.output_dir / src_name
        if not src_path.exists():
            raise ExcelEditError("file_not_found", file=src_name)

        steps = excel_edit_resolve_steps(raw_steps, step.merged_vars())
        _hdr = bdata.get("excelEditKeepHeaderRows")
        keep_header = 1 if _hdr in (None, "") else max(0, int(_hdr))

        ctx.output_dir.mkdir(parents=True, exist_ok=True)
        out_name = normalize_output_name(eb.safe_filename(bdata.get("excelFileName", ""), "edited.xlsx"))
        sheet = str(bdata.get("excelEditSheetName") or "").strip()

        ctx.log(bid, "info", "excel_edit_running", label=label, file=src_name)

        def _desc(s):
            op = s.get("op")
            if op == "delete_rows":
                return eb.tr(language, "excel_edit_desc_delete_rows", spec=s.get("rows", ""))
            if op == "delete_cols":
                return eb.tr(language, "excel_edit_desc_delete_cols", spec=s.get("cols", ""))
            key = "excel_edit_desc_filter_remove" if s.get("mode") == "remove" else "excel_edit_desc_filter_keep"
            return eb.tr(language, key, col=str(s.get("column", "")).upper(), text=s.get("text", ""))

        def _log_step(i, s, d):
            ctx.log(bid, "info", "excel_edit_step", i=i + 1, n=len(steps), desc=_desc(s),
                    rows=len(d), cols=d.shape[1])

        df = read_grid(src_path, sheet)
        df = excel_edit_apply_steps(df, steps, keep_header, _log_step)
        try:
            write_grid(df, ctx.output_dir / out_name, sheet)
        except PermissionError:
            raise ExcelEditError("file_locked", file=out_name)

        # Giống pivot/merge: output của khối thay hẳn current_input; workflow_env và
        # dòng log "Biến trả về" do vòng lặp chính lo.
        step.current_input = eb.rename_output_keys(step.btype, bdata, {"file_name": out_name})
        ctx.log(bid, "success", "excel_edit_success", src=src_name, out=out_name,
                rows=len(df), cols=df.shape[1])
    except Exception as e:
        err_text = (eb.tr(language, f"excel_edit_err_{e.code}", **e.params)
                    if isinstance(e, ExcelEditError) else str(e))
        ctx.log(bid, "error", "excel_edit_error", label=label, error=err_text)
        return ctx.fail(step, err_text)


HANDLERS = {
    "merge_excel": handle_merge_excel,
    "pivot_excel": handle_pivot_excel,
    "excel_edit": handle_excel_edit,
}
