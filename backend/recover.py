                                    if not res.get("ok"):
                                        if log_fn:
                                            log_fn(bid, "error", f"Γ¥î [Telegram] {label} - Lß╗ùi gß╗¡i file {fname}: {res.get('description')}")
                                        telegram_error = True
                                        break
                                    if not last_message_id:
                                        last_message_id = res.get("result", {}).get("message_id")
                    
                    if telegram_error:
                        final_status = "error"
                        break
                    else:
                        if log_fn:
                            log_fn(bid, "success", f"Γ£à [Telegram] {label} - ─É├ú gß╗¡i th├ánh c├┤ng! (message_id={last_message_id})")
                        if isinstance(current_input, dict):
                            # Giß╗» lß║íi message_id c┼⌐ (tin nhß║»n ng╞░ß╗¥i d├╣ng), th├¬m sent_message_id (tin vß╗½a gß╗¡i ra)
                            current_input["sent_message_id"] = last_message_id
                            current_input["chat_id"] = chat_id
                        else:
                            current_input = {"sent_message_id": last_message_id, "message_id": last_message_id, "chat_id": chat_id, "previous_input": current_input}
                except Exception as e:
                    if log_fn:
                        log_fn(bid, "error", f"Γ¥î [Telegram] {label} - Gß╗¡i thß║Ñt bß║íi: {str(e)}")
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
                    log_fn(bid, "info", f"≡ƒôº [Email] {label} - ─Éang gß╗¡i th╞░ tß╗¢i {final_to}...")

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
                            log_fn(bid, "warning", f"ΓÜá [Email] Kh├┤ng t├¼m thß║Ñy file ─æ├¡nh k├¿m: {att_name}")

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
                        log_fn(bid, "success", f"Γ£à [Email] {label} - ─É├ú gß╗¡i th╞░ th├ánh c├┤ng!")
                except Exception as e:
                    if log_fn:
                        log_fn(bid, "error", f"Γ¥î [Email] {label} - Lß╗ùi gß╗¡i th╞░: {str(e)}")
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