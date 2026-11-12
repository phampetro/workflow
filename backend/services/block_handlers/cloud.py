"""Khối "Tải lên đám mây" (cloud_upload): đẩy 1 hoặc nhiều file input/output lên
Google Drive hoặc OneDrive qua kết nối đã đăng nhập (bảng cloud_connection).

Output (đổi tên được trên UI, khai ở BLOCK_OUTPUT_VARS):
- cloud_link : 1 file → link của file; nhiều file → mỗi dòng "tên: link". Dùng thẳng
               trong {{cloud_link}} của khối Telegram/Email phía sau.
- cloud_count: số file đã tải lên.
"""
from services import cloud_storage
from services import executor_blocks as eb

from .context import BREAK


def _load_connection(conn_id):
    with eb.connect_sqlite() as conn:
        row = conn.execute(
            "SELECT provider, account, refresh_token FROM cloud_connection WHERE id=?", (conn_id,)).fetchone()
    return {"provider": row[0], "account": row[1] or "", "refresh_token": row[2] or ""} if row else None


def _save_rotated_token(conn_id, token):
    # Microsoft xoay refresh token mỗi lần làm mới — không lưu là kết nối tự hỏng dần.
    with eb.connect_sqlite() as conn:
        conn.execute("UPDATE cloud_connection SET refresh_token=? WHERE id=?", (token, conn_id))


def _resolve_files(ctx, step, names):
    resolved = []
    for raw in names or []:
        # Tên file thuần: ô này đi qua nội suy {{var}}, "../../pyflow.db" sẽ đẩy cả DB lên mạng.
        name = eb.safe_filename(raw, "")
        if not name:
            continue
        path = ctx.input_dir / name               # input trước, rồi output (giống khối Email)
        if not path.is_file():
            path = ctx.output_dir / name
        if path.is_file():
            resolved.append((name, path))
        else:
            ctx.log(step.bid, "warning", "cloud_file_not_found", name=name)
    return resolved


def _err_text(ctx, e):
    return eb.tr(ctx.language, f"cloud_err_{e.code}", **e.params)


def handle_cloud_upload(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    conn_id = str(bdata.get("cloudConnectionId") or "").strip()
    conn = _load_connection(conn_id) if conn_id else None
    if not conn:
        ctx.log(bid, "error", "cloud_err_no_connection", label=label)
        return ctx.fail(step, "Chưa chọn kết nối lưu trữ cho khối Tải lên đám mây")

    files = _resolve_files(ctx, step, bdata.get("cloudFiles"))
    if not files:
        ctx.log(bid, "error", "cloud_no_files", label=label)
        return ctx.fail(step, "Không có file nào để tải lên")

    folder = str(bdata.get("cloudFolder") or "")
    conflict = bdata.get("cloudConflict") or "rename"
    share = bdata.get("cloudShare") or "none"
    provider = conn["provider"]

    try:
        token, rotated = cloud_storage.refresh_access_token(provider, conn["refresh_token"])
        if rotated:
            _save_rotated_token(conn_id, rotated)

        results = []
        for name, path in files:
            ctx.log(bid, "info", "cloud_uploading", label=label, name=name,
                    provider=eb.tr(ctx.language, f"cloud_provider_{provider}"))
            info = cloud_storage.upload_file(provider, token, str(path), folder, name, conflict=conflict,
                                             share=share, account=conn["account"], should_stop=ctx.stopped)
            results.append(info)
            ctx.log(bid, "success", "cloud_uploaded", name=info["name"], url=info["url"])
    except cloud_storage.CloudStopped:
        ctx.log(bid, "warning", "cloud_stopped")
        ctx.final_status = "stopped"
        return BREAK
    except cloud_storage.CloudError as e:
        err = _err_text(ctx, e)
        ctx.log(bid, "error", "cloud_failed", label=label, error=err)
        return ctx.fail(step, err)
    except Exception as e:   # mạng rớt, file bị khoá...
        ctx.log(bid, "error", "cloud_failed", label=label, error=str(e))
        return ctx.fail(step, f"Tải lên đám mây thất bại: {e}")

    link = results[0]["url"] if len(results) == 1 else "\n".join(f"{r['name']}: {r['url']}" for r in results)
    out = eb.rename_output_keys(step.btype, bdata, {"cloud_link": link, "cloud_count": len(results)})
    if not isinstance(step.current_input, dict):
        step.current_input = {}
    step.current_input.update(out)   # giữ biến của khối trước (chat_id...), thêm biến mới


HANDLERS = {"cloud_upload": handle_cloud_upload}
