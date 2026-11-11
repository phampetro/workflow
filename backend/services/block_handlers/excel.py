"""Khối Excel: Ghép file (merge), Pivot, Xử lý Excel (excel_edit)."""
from services import executor_blocks as eb
from services.excel_edit import (
    ExcelEditError, apply_steps as excel_edit_apply_steps, normalize_output_name,
    read_grid, resolve_steps as excel_edit_resolve_steps, write_grid,
)

from .common import ensure_block_packages, finish_script, run_script


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

    if merge_all:
        # Tự quét toàn bộ file trong INPUT_DIR (hoặc OUTPUT_DIR) ở phía script con
        file_list_code = """
# Tự động quét tất cả file .xlsx/.csv trong INPUT_DIR
file_list = sorted([f for f in os.listdir(INPUT_DIR) if f.endswith('.xlsx') or f.endswith('.csv')])
print(f"Tự động phát hiện {len(file_list)} file trong thư mục Input.")
"""
    else:
        file_list_code = f"""file_list = {selected_files!r}\nprint(f\"Đang ghép {{len(file_list)}} file đã chọn.\")"""
    if merge_mode == "all_output":
        file_list_code = file_list_code.replace("INPUT_DIR", "OUTPUT_DIR").replace("Input.", "Output.")

    code = f'''
import os
import warnings
import pandas as pd
import openpyxl

# Tắt cảnh báo openpyxl "Workbook contains no default style" (vô hại, chỉ gây nhiễu log)
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

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
output_data = {{"file_name": out_file}}
'''
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

    code = f'''
import os
import warnings
import pandas as pd

# Tắt cảnh báo openpyxl "Workbook contains no default style" (vô hại, chỉ gây nhiễu log)
warnings.filterwarnings('ignore', category=UserWarning, module='openpyxl')

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

output_data = {{"file_name": out_file}}
'''
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
