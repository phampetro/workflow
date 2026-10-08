"""Logic cho khối "Xử lý Excel" (`excel_edit`): xóa dòng, lọc theo cột, xóa cột.

File Excel được đọc thành LƯỚI THÔ (header=None) để số dòng / chữ cái cột khớp
đúng với những gì người dùng thấy trong Excel (dòng 1 = dòng đầu tiên kể cả dòng
tiêu đề, cột A = cột đầu). Các bước chạy lần lượt từ trên xuống nên số dòng/cột ở
bước sau tính theo kết quả của bước trước.

Module không biết gì về log/ngôn ngữ: lỗi người dùng được ném dưới dạng
`ExcelEditError(code, **params)`, executor dịch qua `tr("excel_edit_err_<code>")`.
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd


class ExcelEditError(Exception):
    def __init__(self, code: str, **params):
        super().__init__(code)
        self.code = code
        self.params = params


OPS = ("delete_rows", "filter", "delete_cols")

_SPLIT = re.compile(r"[,\s;]+")
_NUM_TOKEN = re.compile(r"^(\d+)(?:-(\d+))?$")
_COL_TOKEN = re.compile(r"^([A-Za-z]{1,3})(?:-([A-Za-z]{1,3}))?$")


def col_to_index(letters: str) -> int:
    """'A' -> 0, 'Z' -> 25, 'AA' -> 26."""
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _tokens(spec: str) -> list:
    # "1 - 10" -> "1-10" để khoảng trắng quanh dấu gạch không bị tách thành 3 token
    spec = re.sub(r"\s*-\s*", "-", str(spec or "").strip())
    return [t for t in _SPLIT.split(spec) if t]


def parse_row_spec(spec: str) -> list:
    """'1,2' / '1-10' / '1,3,5-8' -> [(1,1), (3,3), (5,8)] (số dòng 1-based)."""
    toks = _tokens(spec)
    if not toks:
        raise ExcelEditError("bad_rows", spec=spec)
    out = []
    for t in toks:
        m = _NUM_TOKEN.match(t)
        if not m:
            raise ExcelEditError("bad_rows", spec=spec)
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        if min(a, b) < 1:
            raise ExcelEditError("bad_rows", spec=spec)
        out.append((min(a, b), max(a, b)))
    return out


def parse_col_spec(spec: str) -> list:
    """'A B C' / 'A,C' / 'A-C' -> [(0,0), (1,1), ...] (chỉ số cột 0-based)."""
    toks = _tokens(spec)
    if not toks:
        raise ExcelEditError("bad_cols", spec=spec)
    out = []
    for t in toks:
        m = _COL_TOKEN.match(t)
        if not m:
            raise ExcelEditError("bad_cols", spec=spec)
        a = col_to_index(m.group(1))
        b = col_to_index(m.group(2)) if m.group(2) else a
        out.append((min(a, b), max(a, b)))
    return out


def _cell_text(v) -> str:
    if v is None or pd.isna(v):
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))  # 123.0 -> "123" để lọc "123" khớp ô số
    return str(v)


def _delete_rows(df: pd.DataFrame, spec: str) -> pd.DataFrame:
    n = len(df)
    keep = np.ones(n, dtype=bool)
    for a, b in parse_row_spec(spec):
        lo, hi = a - 1, min(b, n)  # dòng vượt quá số dòng hiện có thì bỏ qua
        if lo < hi:
            keep[lo:hi] = False
    return df[keep].reset_index(drop=True)


def _delete_cols(df: pd.DataFrame, spec: str) -> pd.DataFrame:
    n = df.shape[1]
    keep = np.ones(n, dtype=bool)
    for a, b in parse_col_spec(spec):
        lo, hi = a, min(b + 1, n)  # cột vượt quá số cột hiện có thì bỏ qua
        if lo < hi:
            keep[lo:hi] = False
    out = df.iloc[:, np.flatnonzero(keep)].copy()
    out.columns = range(out.shape[1])
    return out


def _filter_rows(df: pd.DataFrame, column: str, mode: str, text: str,
                 case_sensitive: bool, keep_header_rows: int) -> pd.DataFrame:
    toks = _tokens(column)
    m = _COL_TOKEN.match(toks[0]) if len(toks) == 1 else None
    if not m or m.group(2):
        raise ExcelEditError("bad_cols", spec=column)
    idx = col_to_index(m.group(1))
    if idx >= df.shape[1]:
        raise ExcelEditError("col_out_of_range", col=m.group(1).upper(), max=df.shape[1])
    if text == "":
        raise ExcelEditError("empty_filter_text", col=m.group(1).upper())
    if len(df) == 0:
        return df

    cells = df.iloc[:, idx].map(_cell_text)
    if not case_sensitive:
        cells, text = cells.str.lower(), text.lower()
    hit = cells.str.contains(text, regex=False).to_numpy(dtype=bool)
    keep = hit if mode == "keep" else ~hit
    keep = keep.copy()
    keep[:max(0, keep_header_rows)] = True  # dòng tiêu đề luôn được giữ lại
    return df[keep].reset_index(drop=True)


def apply_step(df: pd.DataFrame, step: dict, keep_header_rows: int) -> pd.DataFrame:
    op = step.get("op")
    if op == "delete_rows":
        return _delete_rows(df, step.get("rows", ""))
    if op == "delete_cols":
        return _delete_cols(df, step.get("cols", ""))
    if op == "filter":
        mode = "remove" if step.get("mode") == "remove" else "keep"
        return _filter_rows(df, step.get("column", ""), mode, str(step.get("text", "")),
                            bool(step.get("caseSensitive")), keep_header_rows)
    raise ExcelEditError("unknown_op", op=op)


def apply_steps(df: pd.DataFrame, steps: list, keep_header_rows: int, on_step=None) -> pd.DataFrame:
    for i, step in enumerate(steps):
        df = apply_step(df, step, keep_header_rows)
        if on_step:
            on_step(i, step, df)
    return df


def resolve_steps(steps: list, ctx: dict) -> list:
    """Thay {{biến}} trong các ô của từng bước, đúng 1 lượt re.sub.

    KHÔNG dùng `interpolate()` của executor cho danh sách bước: nó có nhánh "gõ tên
    trần" (giá trị trùng tên biến thì bị thay bằng giá trị biến) nên cột "A" hay chữ
    "CV" sẽ bị đổi nếu workflow tình cờ có biến tên `A`/`CV`.
    """
    def sub(text):
        return re.sub(r"\{\{(\w+)\}\}", lambda m: str(ctx[m.group(1)]) if m.group(1) in ctx else m.group(0), text)

    out = []
    for step in steps or []:
        if not isinstance(step, dict):
            continue
        out.append({k: (sub(v) if isinstance(v, str) else v) for k, v in step.items()})
    return out


def normalize_output_name(name: str) -> str:
    """Đảm bảo đuôi .xlsx (df.to_excel ghi .csv/.xls sẽ lỗi hoặc ra file sai định dạng)."""
    p = Path(name)
    if p.suffix.lower() == ".xlsx":
        return name
    if p.suffix.lower() in (".xls", ".csv", ".xlsm"):
        return p.stem + ".xlsx"
    return name + ".xlsx"


def read_grid(path: Path, sheet_name: str = "") -> pd.DataFrame:
    """Đọc file thành lưới thô, giữ nguyên kiểu từng ô (số vẫn là số)."""
    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path, header=None, dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(path, sheet_name=sheet_name or 0, header=None, dtype=object)
    df.columns = range(df.shape[1])
    return df


def write_grid(df: pd.DataFrame, out_path: Path, sheet_name: str = "") -> None:
    df.to_excel(out_path, index=False, header=False, sheet_name=sheet_name or "Sheet1")
