"""Khối Gửi Email (SMTP)."""
import mimetypes
import smtplib
from email.message import EmailMessage

from services import executor_blocks as eb


def _build_message(ctx, step, bdata, mail_user):
    msg = EmailMessage()
    msg["Subject"] = bdata.get("mailSubject", "").strip()
    msg["From"] = mail_user
    msg["To"] = bdata.get("mailTo", "").strip()
    mail_cc = bdata.get("mailCc", "").strip()
    if mail_cc:
        msg["Cc"] = mail_cc

    body = bdata.get("mailBody", "")
    # Có thẻ HTML thì gửi dạng html
    if "<" in body and ">" in body:
        msg.set_content(body, subtype="html")
    else:
        msg.set_content(body)

    for att in bdata.get("mailAttachments", []):
        # Chỉ nhận tên file thuần — cùng lý do với đính kèm Telegram: ô này đi qua nội
        # suy {{var}} nên "../../pyflow.db" sẽ gửi cả database ra ngoài qua email.
        att_name = eb.safe_filename(att, "")
        if not att_name:
            continue
        att_path = ctx.input_dir / att_name          # input trước, rồi output
        if not att_path.exists():
            att_path = ctx.output_dir / att_name
        if att_path.exists() and att_path.is_file():
            ctype, encoding = mimetypes.guess_type(str(att_path))
            if ctype is None or encoding is not None:
                ctype = "application/octet-stream"
            maintype, subtype = ctype.split("/", 1)
            with open(att_path, "rb") as fp:
                msg.add_attachment(fp.read(), maintype=maintype, subtype=subtype, filename=att_name)
        else:
            ctx.log(step.bid, "warning", "email_attachment_not_found", name=att_name)
    return msg


def handle_email(ctx, step):
    bdata, bid, label = step.bdata, step.bid, step.label
    mail_host = bdata.get("mailHost", "").strip()
    mail_port = int(bdata.get("mailPort", 465) or 465)
    mail_user = bdata.get("mailUser", "").strip()
    mail_pass = bdata.get("mailPass", "").replace(" ", "")

    ctx.log(bid, "info", "email_sending", label=label, to=bdata.get("mailTo", "").strip())
    msg = _build_message(ctx, step, bdata, mail_user)

    smtp = None
    try:
        # Cổng 465 = SSL; còn lại STARTTLS
        if mail_port == 465:
            smtp = smtplib.SMTP_SSL(mail_host, mail_port, timeout=15)
        else:
            smtp = smtplib.SMTP(mail_host, mail_port, timeout=15)
            smtp.starttls()
        smtp.login(mail_user, mail_pass)
        smtp.send_message(msg)
        ctx.log(bid, "success", "email_success", label=label)
    except Exception as e:
        ctx.log(bid, "error", "email_error", label=label, error=str(e))
        return ctx.fail(step, f"Gửi email thất bại: {e}")
    finally:
        # PHẢI đóng trong finally: sai mật khẩu SMTP trong một Loop 200 vòng từng để
        # lại 200 socket TLS treo — máy chủ mail có thể chặn IP vì "too many connections".
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:
                pass  # đã lỗi/đóng sẵn — không còn gì để dọn


HANDLERS = {"email": handle_email}
