"""
Tạo assets/pyflow.ico từ frontend/public/favicon.svg — icon dùng cho pyflow-backend.exe
khi đóng gói (tools/build_release.py) và cho shortcut "Mở PyFlow Studio.lnk".

Không cần cài thêm thư viện: dùng thẳng Chromium có sẵn của Playwright (đã là
dependency bắt buộc của dự án) để render SVG ra PNG nhiều kích thước, rồi tự đóng
gói thành .ico (mỗi entry là 1 PNG — định dạng này Windows Vista+ đều đọc được,
không cần encode BMP tay).

Chạy lại file này (từ backend/.venv) mỗi khi đổi logo:
    backend\\.venv\\Scripts\\python.exe tools\\generate_icon.py
"""
import base64
import struct
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SVG_PATH = ROOT / "frontend" / "public" / "favicon.svg"
OUT_ICO = ROOT / "assets" / "pyflow.ico"
SIZES = [16, 24, 32, 48, 64, 128, 256]

HTML_TEMPLATE = """<!doctype html><html><head><style>
html,body{{margin:0;padding:0;background:transparent;}}
img{{display:block;width:{size}px;height:{size}px;}}
</style></head><body><img src="data:image/svg+xml;base64,{b64}" /></body></html>"""


def render_pngs(svg_text: str) -> dict:
    svg_b64 = base64.b64encode(svg_text.encode("utf-8")).decode("ascii")
    png_bytes_by_size = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 300, "height": 300})
            for size in SIZES:
                page.set_viewport_size({"width": size, "height": size})
                page.set_content(HTML_TEMPLATE.format(size=size, b64=svg_b64))
                img_el = page.query_selector("img")
                png_bytes_by_size[size] = img_el.screenshot(type="png", omit_background=True)
            page.close()
        finally:
            browser.close()
    return png_bytes_by_size


def pack_ico(png_bytes_by_size: dict, out_path: Path) -> None:
    """Đóng gói ICONDIR + N x ICONDIRENTRY + dữ liệu PNG theo đúng định dạng .ico."""
    entries = sorted(png_bytes_by_size.items())
    num_images = len(entries)

    icondir = struct.pack("<HHH", 0, 1, num_images)  # reserved, type=1 (icon), count
    headers = b""
    data = b""
    offset = 6 + 16 * num_images  # sizeof(ICONDIR) + N * sizeof(ICONDIRENTRY)

    for size, png in entries:
        w = size if size < 256 else 0  # 256 -> 0 theo quy ước định dạng .ico
        h = size if size < 256 else 0
        headers += struct.pack(
            "<BBBBHHII",
            w, h,
            0,      # color palette
            0,      # reserved
            1,      # color planes
            32,     # bits per pixel
            len(png),
            offset,
        )
        data += png
        offset += len(png)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(icondir)
        f.write(headers)
        f.write(data)


def main():
    # In khong dau (ASCII) - console Windows mac dinh dung codepage cp1252, in
    # thang tieng Viet co dau se crash UnicodeEncodeError (cung ly do moi print
    # trong build_release.py deu khong dau).
    if not SVG_PATH.exists():
        raise SystemExit(f"Khong tim thay {SVG_PATH}")
    svg_text = SVG_PATH.read_text(encoding="utf-8")
    print(f"Dang render {SVG_PATH.name} o {len(SIZES)} kich thuoc bang Chromium (Playwright)...")
    pngs = render_pngs(svg_text)
    pack_ico(pngs, OUT_ICO)
    print(f"Da tao {OUT_ICO} ({OUT_ICO.stat().st_size} bytes, kich thuoc: {sorted(pngs.keys())})")


if __name__ == "__main__":
    main()
