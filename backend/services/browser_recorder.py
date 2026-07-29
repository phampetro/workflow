"""
Browser Recorder — Ghi lại thao tác của người dùng trên trình duyệt và tự sinh
ra danh sách "step" đúng schema của khối Browser.

Cách hoạt động (kiểu RPA thương mại):
  1. Mở một trình duyệt headed (persistent context, tái dùng phiên đăng nhập).
  2. Tiêm `RECORDER_JS` vào MỌI trang qua `add_init_script` — script này:
       - Vẽ viền đỏ highlight phần tử đang rê chuột.
       - Bắt click / nhập liệu / chọn dropdown / tick checkbox.
       - Tự sinh selector "semantic-first" + fallback chain (chống React/Angular
         re-render đổi class/id).
       - Bắn step về Python qua binding `window.__pyflowRecordStep(...)`.
  3. Python gom step, phát realtime cho Frontend qua SSE.

Chạy trên 1 thread riêng (daemon) với sync_playwright — KHÔNG dùng
_WORKFLOW_EXECUTOR (đó là pool cho block chạy workflow thật).
"""
import os
import threading
import time
import traceback

# ─── JS tiêm vào trang (selector engine + UI ghi hình) ───────────────────────
# Dùng raw-string để giữ nguyên regex/backslash cho JavaScript.
RECORDER_JS = r'''
(() => {
  if (window.__pyflowRec) return;
  window.__pyflowRec = true;

  // ── Trạng thái ghi (giữ qua các lần điều hướng cùng tab) ──
  let paused = false;
  const readCnt = () => { try { return parseInt(sessionStorage.getItem('__pyflow_rec_cnt') || '0', 10) || 0; } catch (e) { return 0; } };
  const writeCnt = (n) => { try { sessionStorage.setItem('__pyflow_rec_cnt', String(n)); } catch (e) {} };

  // ── Helper selector ──
  const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&');
  const cssAttr = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const isUnique = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };

  const looksHashed = (s) => {
    if (!s) return false;
    if (/\d{4,}/.test(s)) return true;                 // chuỗi số dài
    if (/[0-9a-f]{7,}/i.test(s) && /\d/.test(s)) return true; // hash hex
    return false;
  };
  const isBadId = (id) => {
    if (!id) return true;
    if (id.length > 50) return true;
    if (/[:.\s#]/.test(id)) return true;               // React useId ":r0:", ký tự lạ
    if (/^\d/.test(id)) return true;                   // #id không được bắt đầu bằng số
    if (/^(ember\d|ext-gen|yui_|radix-|headlessui-|:r)/i.test(id)) return true;
    if (/^[a-f0-9]{8,}$/i.test(id)) return true;       // hash hex thuần
    if (/\d{6,}/.test(id)) return true;                // dãy số rất dài (timestamp...)
    return false;                                      // GIỮ id kiểu "child_1307", "user_name"
  };
  const goodClasses = (el) => Array.from(el.classList || []).filter((c) => {
    if (!c || c.length > 30) return false;
    if (/^(css-|sc-|jsx-|makeStyles-|emotion-|_)/.test(c)) return false; // styled/emotion/CSS-modules
    if (looksHashed(c)) return false;
    return true;
  });

  const cssPath = (el) => {
    if (el.id && !isBadId(el.id)) { const s = '#' + cssEsc(el.id); if (isUnique(s)) return s; }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const gc = goodClasses(node);
      if (gc.length) part += '.' + gc.slice(0, 2).map(cssEsc).join('.');
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      if (node.id && !isBadId(node.id)) { parts[0] = '#' + cssEsc(node.id); break; }
      node = parent;
    }
    return parts.join(' > ');
  };

  const CLICKABLE_ROLES = ['button', 'link', 'menuitem', 'tab', 'option'];
  const countText = (txt) => {
    let n = 0;
    document.querySelectorAll('a,button,[role=button],summary,label,[role=link],[role=menuitem],[role=tab]').forEach((e) => {
      if ((e.innerText || '').trim() === txt) n++;
    });
    return n;
  };

  // Sinh danh sách selector, tốt nhất trước; luôn kèm 1 CSS-path đảm bảo unique cuối cùng.
  const buildCandidates = (el) => {
    const out = [];
    const push = (s) => { if (s && out.indexOf(s) === -1) out.push(s); };
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const role = (el.getAttribute('role') || '');
    const isField = (tag === 'input' && !['button', 'submit', 'reset'].includes(type)) || tag === 'textarea' || tag === 'select';

    // 1. data-* test id (dev cố ý đặt — bền nhất)
    ['data-testid', 'data-test', 'data-test-id', 'data-cy', 'data-qa', 'data-automation-id', 'data-tid', 'data-id'].forEach((a) => {
      const v = el.getAttribute(a);
      if (v) { const s = '[' + a + '="' + cssAttr(v) + '"]'; if (isUnique(s)) push(s); }
    });
    // 2. id ổn định
    if (el.id && !isBadId(el.id)) { const s = '#' + cssEsc(el.id); if (isUnique(s)) push(s); }
    // 3. Form field: label= / name / placeholder
    if (isField) {
      try { const labs = el.labels; if (labs && labs.length) { const t = (labs[0].innerText || '').trim(); if (t && t.length <= 60) push('label=' + t); } } catch (e) {}
      const nm = el.getAttribute('name');
      if (nm) { const s = tag + '[name="' + cssAttr(nm) + '"]'; if (isUnique(s)) push(s); else { const s2 = '[name="' + cssAttr(nm) + '"]'; if (isUnique(s2)) push(s2); } }
      const ph = el.getAttribute('placeholder');
      if (ph) { try { if (document.querySelectorAll('[placeholder="' + cssAttr(ph) + '"]').length === 1) push('placeholder=' + ph); } catch (e) {} }
    }
    // 4. aria-label
    const al = el.getAttribute('aria-label');
    if (al) { const s = '[aria-label="' + cssAttr(al) + '"]'; if (isUnique(s)) push(s); }
    // 5. text= (KHỚP CHÍNH XÁC) cho phần tử bấm được — dùng dấu ngoặc kép để
    //    Playwright khớp đúng chữ, tránh dính nhầm phần tử "chứa" chuỗi con.
    const txt = (el.innerText || el.textContent || '').trim();
    if (txt && txt.length <= 50 && txt.indexOf('\n') === -1) {
      if (['a', 'button', 'summary', 'label'].includes(tag) || CLICKABLE_ROLES.includes(role)) {
        if (countText(txt) === 1) push('text="' + txt.replace(/"/g, '\\"') + '"');
      }
    }
    // 6. name cho button
    if (!isField) { const nm = el.getAttribute('name'); if (nm) { const s = tag + '[name="' + cssAttr(nm) + '"]'; if (isUnique(s)) push(s); } }
    // 7. Fallback CSS-path (luôn có)
    push(cssPath(el));
    return out;
  };

  const safeName = (el) => {
    let n = '';
    try {
      n = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
      if (!n && el.labels && el.labels[0]) n = el.labels[0].innerText || '';
      if (!n) n = (el.innerText || '').trim();
      if (!n) n = el.getAttribute('name') || el.tagName.toLowerCase();
    } catch (e) { n = el.tagName ? el.tagName.toLowerCase() : 'phần tử'; }
    return String(n).replace(/\s+/g, ' ').trim().slice(0, 40);
  };
  const describe = (el, action, extra) => {
    const name = safeName(el);
    if (action === 'click') return 'Click "' + name + '"';
    if (action === 'fill') return (extra && extra.password) ? 'Nhập mật khẩu (nhập lại thủ công)' : 'Nhập vào "' + name + '"';
    if (action === 'select_option') return 'Chọn "' + ((extra && extra.value) || '') + '" ở "' + name + '"';
    if (action === 'check') return 'Tick "' + name + '"';
    if (action === 'uncheck') return 'Bỏ tick "' + name + '"';
    return action + ' "' + name + '"';
  };

  const send = (payload) => { try { window.__pyflowRecordStep(payload); } catch (e) {} };

  const emit = (el, action, extra) => {
    extra = extra || {};
    const cands = buildCandidates(el);
    const payload = {
      action: action,
      selector: cands[0] || '',
      selectors: cands,
      value: (extra.value !== undefined && extra.value !== null) ? extra.value : '',
      note: describe(el, action, extra),
    };
    if (extra.password) payload.is_password = true;
    const n = readCnt() + 1; writeCnt(n); updateBadge(n);
    send(payload);
  };

  // ── UI: khung highlight + thanh công cụ ──
  const UI_ID = '__pyflow_rec_ui';
  const BOX_ID = '__pyflow_rec_box';
  const isOurUI = (el) => { try { return !!(el && el.closest && (el.closest('#' + UI_ID) || el.closest('#' + BOX_ID))); } catch (e) { return false; } };

  let box, bar, badge, pauseBtn;
  const buildUI = () => {
    if (document.getElementById(UI_ID)) return;
    box = document.createElement('div');
    box.id = BOX_ID;
    box.style.cssText = 'position:fixed;z-index:2147483646;border:2px solid #ef4444;background:rgba(239,68,68,0.10);border-radius:3px;pointer-events:none;display:none;transition:all .04s linear;box-shadow:0 0 0 1px rgba(255,255,255,.4)';
    document.documentElement.appendChild(box);

    bar = document.createElement('div');
    bar.id = UI_ID;
    bar.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:12px;padding:8px 14px;background:#111827;color:#fff;border-radius:999px;font:600 13px system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#ef4444';
    dot.className = '__pyflow_pulse';
    badge = document.createElement('span');
    badge.textContent = 'Đang ghi · ' + readCnt() + ' bước';
    pauseBtn = document.createElement('button');
    pauseBtn.textContent = '⏸ Tạm dừng';
    pauseBtn.style.cssText = 'border:none;background:#374151;color:#fff;padding:5px 10px;border-radius:999px;font:inherit;cursor:pointer';
    pauseBtn.onclick = () => {
      paused = !paused;
      pauseBtn.textContent = paused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
      dot.style.background = paused ? '#9ca3af' : '#ef4444';
      badge.textContent = paused ? 'Tạm dừng · ' + readCnt() + ' bước' : 'Đang ghi · ' + readCnt() + ' bước';
    };
    const doneBtn = document.createElement('button');
    doneBtn.textContent = '✓ Xong';
    doneBtn.style.cssText = 'border:none;background:#10b981;color:#fff;padding:5px 12px;border-radius:999px;font:inherit;cursor:pointer';
    doneBtn.onclick = () => { send({ __control: 'stop' }); };
    bar.appendChild(dot); bar.appendChild(badge); bar.appendChild(pauseBtn); bar.appendChild(doneBtn);
    document.documentElement.appendChild(bar);

    const style = document.createElement('style');
    style.textContent = '@media (prefers-reduced-motion: no-preference){@keyframes __pyflow_p{0%,100%{opacity:1}50%{opacity:.3}}.__pyflow_pulse{animation:__pyflow_p 1.1s ease-in-out infinite}}';
    document.documentElement.appendChild(style);
  };
  const updateBadge = (n) => { if (badge) badge.textContent = (paused ? 'Tạm dừng · ' : 'Đang ghi · ') + n + ' bước'; };

  const onMove = (e) => {
    if (!box) return;
    const el = e.target;
    if (!el || isOurUI(el) || el === document.documentElement || el === document.body) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
  };

  const meaningful = (raw) => raw.closest('a,button,[role=button],[role=link],[role=menuitem],[role=tab],input,select,textarea,label,summary,[onclick]') || raw;

  const onClick = (e) => {
    if (paused) return;
    const raw = e.target;
    if (isOurUI(raw)) return;
    const el = meaningful(raw);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      setTimeout(() => emit(el, el.checked ? 'check' : 'uncheck'), 0);
      return;
    }
    if (tag === 'select') return;                 // dùng change
    if (tag === 'textarea') return;               // dùng change (fill)
    if (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type)) return; // ô nhập text: dùng change
    emit(el, 'click');
  };

  const onChange = (e) => {
    if (paused) return;
    const el = e.target;
    if (isOurUI(el)) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'select') {
      const opt = el.options[el.selectedIndex];
      emit(el, 'select_option', { value: opt ? (opt.label || opt.text || opt.value || '') : '' });
      return;
    }
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) { emit(el, el.checked ? 'check' : 'uncheck'); return; }
    if (tag === 'input' && type === 'file') return;
    if (tag === 'textarea' || tag === 'input') {
      if (type === 'password') { emit(el, 'fill', { value: '', password: true }); return; }
      emit(el, 'fill', { value: el.value || '' });
      return;
    }
    if (el.isContentEditable) emit(el, 'fill', { value: (el.innerText || '') });
  };

  const boot = () => {
    buildUI();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    window.addEventListener('scroll', () => { if (box) box.style.display = 'none'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
'''


# ─── Quản lý phiên ghi ───────────────────────────────────────────────────────
_sessions = {}        # workflow_id -> session dict
_lock = threading.Lock()


def get_session(workflow_id):
    return _sessions.get(workflow_id)


def snapshot_events(workflow_id):
    s = _sessions.get(workflow_id)
    return list(s["events"]) if s else []


def subscribe(workflow_id, queue):
    s = _sessions.get(workflow_id)
    if s:
        s["subscribers"].add(queue)


def unsubscribe(workflow_id, queue):
    s = _sessions.get(workflow_id)
    if s:
        s["subscribers"].discard(queue)


def _broadcast(session, payload):
    session["events"].append(payload)
    loop = session["loop"]
    for q in list(session["subscribers"]):
        try:
            loop.call_soon_threadsafe(q.put_nowait, payload)
        except Exception:
            pass


def start(workflow_id, profile_dir, start_url, loop):
    """Bắt đầu phiên ghi. Trả về {'ok': bool, 'reason'?}."""
    with _lock:
        existing = _sessions.get(workflow_id)
        if existing and not existing["stop_event"].is_set() and existing["thread"] and existing["thread"].is_alive():
            return {"ok": False, "reason": "Đang có phiên ghi cho workflow này. Hãy Dừng ghi trước."}

        session = {
            "workflow_id": workflow_id,
            "profile_dir": profile_dir,
            "start_url": start_url or "",
            "loop": loop,
            "stop_event": threading.Event(),
            "steps": [],
            "events": [],
            "subscribers": set(),
            "last_action_ts": 0.0,
            "last_nav_url": None,
            "thread": None,
            "error": None,
        }
        t = threading.Thread(target=_run_session, args=(session,), daemon=True)
        session["thread"] = t
        _sessions[workflow_id] = session
        t.start()
        return {"ok": True}


def stop(workflow_id):
    s = _sessions.get(workflow_id)
    if s:
        s["stop_event"].set()
    return {"ok": True}


def is_recording(workflow_id):
    s = _sessions.get(workflow_id)
    return bool(s and not s["stop_event"].is_set() and s["thread"] and s["thread"].is_alive())


def _run_session(session):
    stop_event = session["stop_event"]

    def record_step(step):
        step.setdefault("key_name", "result")
        step.setdefault("continue_on_error", False)
        session["last_action_ts"] = time.time()
        steps = session["steps"]
        # Gộp các lần nhập liên tiếp vào cùng 1 ô thành 1 step (giữ giá trị cuối)
        if (step.get("action") == "fill" and steps and steps[-1].get("action") == "fill"
                and step.get("selector") and steps[-1].get("selector") == step.get("selector")):
            steps[-1] = step
            _broadcast(session, {"type": "replace_last", "step": step, "total": len(steps)})
        else:
            steps.append(step)
            _broadcast(session, {"type": "step", "step": step, "index": len(steps) - 1, "total": len(steps)})

    def on_binding(source, arg):
        try:
            if not isinstance(arg, dict):
                return
            if arg.get("__control") == "stop":
                stop_event.set()
                return
            action = arg.get("action")
            if not action:
                return
            step = {
                "action": action,
                "selector": arg.get("selector", "") or "",
                "selectors": [s for s in (arg.get("selectors") or []) if s],
                "value": arg.get("value", "") if arg.get("value") is not None else "",
                "note": arg.get("note", "") or "",
            }
            if arg.get("attribute"):
                step["attribute"] = arg["attribute"]
            if arg.get("is_password"):
                step["is_password"] = True
            record_step(step)
        except Exception:
            pass

    pw = None
    context = None
    try:
        from playwright.sync_api import sync_playwright
        from services.browser_executor import (
            _find_system_browser, QUIET_BROWSER_ARGS, harden_profile_prefs,
        )

        pw = sync_playwright().start()
        browser_exe = _find_system_browser()
        os.makedirs(session["profile_dir"], exist_ok=True)
        # Không để Chrome hỏi "Lưu mật khẩu?" khi người dùng đăng nhập lúc ghi
        harden_profile_prefs(session["profile_dir"])

        context = pw.chromium.launch_persistent_context(
            user_data_dir=session["profile_dir"],
            executable_path=browser_exe,
            headless=False,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--start-maximized"] + QUIET_BROWSER_ARGS,
            no_viewport=True,
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        # Tiêm recorder vào mọi trang/iframe + đăng ký binding trước khi điều hướng
        context.add_init_script(RECORDER_JS)
        context.expose_binding("__pyflowRecordStep", on_binding)
        context.on("close", lambda: stop_event.set())

        page = context.pages[0] if context.pages else context.new_page()
        page.on("close", lambda: stop_event.set())

        start_url = session["start_url"]
        if start_url:
            session["last_nav_url"] = start_url
            session["last_action_ts"] = time.time()
            record_step({"action": "navigate", "value": start_url, "note": f"Mở trang {start_url}"})

        def on_nav(frame):
            # Chỉ ghi navigate KHI người dùng tự gõ URL (không phải do click gây ra),
            # tránh trùng bước với click. Dùng "click-guard" theo thời gian.
            try:
                if frame != page.main_frame:
                    return
                url = frame.url
                if not url or url == "about:blank":
                    return
                if session.get("last_nav_url") == url:
                    return
                session["last_nav_url"] = url
                if time.time() - session.get("last_action_ts", 0) < 1.6:
                    return
                record_step({"action": "navigate", "value": url, "note": f"Mở trang {url}"})
            except Exception:
                pass
        page.on("framenavigated", on_nav)

        if start_url:
            try:
                page.goto(start_url, wait_until="domcontentloaded", timeout=60000)
            except Exception:
                pass

        # Vòng lặp giữ phiên sống — wait_for_timeout để Playwright dispatch binding/event
        while not stop_event.is_set():
            try:
                if page.is_closed():
                    break
                page.wait_for_timeout(150)
            except Exception:
                if page.is_closed():
                    break
                time.sleep(0.15)

    except Exception as e:
        session["error"] = str(e)
        _broadcast(session, {"type": "error", "message": str(e)})
        traceback.print_exc()
    finally:
        try:
            if context:
                context.close()
        except Exception:
            pass
        try:
            if pw:
                pw.stop()
        except Exception:
            pass
        _broadcast(session, {"type": "done", "steps": session["steps"]})
