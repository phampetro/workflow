import os
import shutil
import subprocess
import sys
import json
import urllib.request
import urllib.error

def _version_tuple(v):
    try:
        return tuple(int(x) for x in str(v).split("."))
    except ValueError:
        return (0,)


def compute_version(root_dir, backend_src):
    """Tính version từ số commit. Lỗi là DỪNG HẲN — không được đoán.

    Trước đây git lỗi thì âm thầm rơi về "1.0.0" rồi vẫn build + upload: đổi user
    Windows làm git báo "dubious ownership" là phát hành ra bản v1.0.0 trong khi khách
    đang ở v2.2.x. Kèm `-c safe.directory` cho đúng repo này để lỗi đó không chặn build.
    """
    git = ["git", "-c", f"safe.directory={root_dir.replace(os.sep, '/')}"]
    try:
        count = int(subprocess.check_output(git + ["rev-list", "--count", "HEAD"], text=True, cwd=root_dir).strip())
        date_out = subprocess.check_output(
            git + ["log", "-1", "--format=%cd", "--date=format:%d/%m/%Y %H:%M:%S"], text=True, cwd=root_dir).strip()
    except Exception as e:
        sys.exit(f"[LOI] Khong doc duoc lich su git de tinh version: {e}\n"
                 f"      Kiem tra: git -C \"{root_dir}\" rev-list --count HEAD")

    base_count = 24
    increment = max(0, count - base_count) // 10
    version = f"{1 + increment // 10}.{increment % 10}.{count}"

    # Không bao giờ phát hành bản có số NHỎ HƠN bản đang commit trong repo: client so
    # version khác nhau là coi như "có bản mới", nên bản lùi số vẫn bị cài như nâng cấp.
    version_file = os.path.join(backend_src, "release_version.json")
    if os.path.exists(version_file):
        with open(version_file, "r", encoding="utf-8") as f:
            prev = json.load(f).get("version", "0")
        if _version_tuple(version) < _version_tuple(prev):
            sys.exit(f"[LOI] Version moi {version} NHO HON ban truoc {prev} — dung build.")
    return version, date_out, count


MANIFEST_NAME = "release_files.txt"


def write_release_manifest(backend_dest, version):
    """Ghi danh sách MỌI file trong backend\\_internal của bản này.

    Cập nhật = giải nén update.zip ĐÈ lên thư mục cũ (trình cập nhật nằm trong code
    của BẢN CŨ đang chạy trên máy khách — không sửa từ xa được). File của bản cũ mà
    bản mới không còn thì nằm lại; v2.3.155 (build Python 3.13 đè lên bản 3.14) chính
    vì thế mà treo hẳn trên máy khách, cài sạch giữ `data` là chạy. start.vbs MỚI (được
    giải nén ra trước khi chạy) đọc file này để xoá file lạc loài, chừa thư mục data.

    UTF-16 (start.vbs mở dạng Unicode): đọc ANSI thì tên file có ký tự ngoài bảng mã
    sẽ không khớp và bị XOÁ NHẦM.
    """
    internal = os.path.join(backend_dest, "_internal")
    files = []
    for dirpath, dirnames, filenames in os.walk(internal):
        rel_dir = os.path.relpath(dirpath, internal)
        if rel_dir == "data" or rel_dir.startswith("data" + os.sep):
            continue
        for name in filenames:
            files.append(os.path.normpath(os.path.join(rel_dir, name)))
    with open(os.path.join(backend_dest, MANIFEST_NAME), "w", encoding="utf-16") as f:
        f.write(f"#version={version}\n")
        f.write("\n".join(sorted(files)) + "\n")
    print(f"Da ghi {MANIFEST_NAME}: {len(files)} file")


def main():
    root_dir =os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    os.chdir(root_dir)
    backend_src = os.path.join(root_dir, "backend")

    # Tính version TRƯỚC khi xoá/build gì: sai thì dừng ngay, không phí 10 phút build.
    version, date_out, count = compute_version(root_dir, backend_src)
    print(f"Version se phat hanh: v{version} ({count} commit)")

    release_dir = os.path.join(root_dir, "Releases", "pyflow-studio")
    
    print("Don dep thu muc release cu...")
    if os.path.exists(release_dir):
        shutil.rmtree(release_dir)
    os.makedirs(release_dir)
    
    print("Build Frontend...")
    frontend_dir = os.path.join(root_dir, "frontend")
    subprocess.run(["npm", "run", "build"], cwd=frontend_dir, shell=True, check=True)
    
    print("Build Backend (EXE) bang PyInstaller...")
    python_exe = os.path.join(backend_src, ".venv", "Scripts", "python.exe")
    if not os.path.exists(python_exe):
        sys.exit(f"[LOI] Khong tim thay {python_exe} — chay setup.bat truoc.")

    print("Tao file release_version.json...")
    version_file = os.path.join(backend_src, "release_version.json")
    with open(version_file, "w") as f:
        json.dump({"version": version, "updatedAt": date_out, "commitCount": count}, f)
        
    # GHIM phiên bản: trước đây cài "pyinstaller" mới nhất mỗi lần build nên bootloader
    # / cấu trúc _internal đổi ngầm giữa các bản — một nguyên nhân khiến giải nén đè lên
    # bản cũ để lại file lạc loài (xem release_files.txt + CleanStaleFiles trong start.vbs).
    subprocess.run([python_exe, "-m", "pip", "install", "pyinstaller==6.22.3"], cwd=backend_src, check=True)
    
    # Icon .exe hiện trong Task Manager/taskbar — generate qua
    # tools/generate_icon.py (render frontend/public/favicon.svg bằng Chromium
    # của Playwright rồi đóng gói .ico đa kích thước, không cần cài thêm thư viện).
    icon_path = os.path.join(root_dir, "assets", "pyflow.ico")
    if not os.path.exists(icon_path):
        print(f"!! Không tìm thấy {icon_path} — chạy `python tools/generate_icon.py` trước, hoặc bỏ qua (exe dùng icon PyInstaller mặc định).")

    pyinstaller_cmd = [
        python_exe, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name", "pyflow-backend",
    ] + (["--icon", icon_path] if os.path.exists(icon_path) else []) + [
        "--add-data", "release_version.json;.",
        "--hidden-import=uvicorn.logging",
        "--hidden-import=uvicorn.loops",
        "--hidden-import=uvicorn.loops.auto",
        "--hidden-import=uvicorn.protocols",
        "--hidden-import=uvicorn.protocols.http",
        "--hidden-import=uvicorn.protocols.http.auto",
        "--hidden-import=uvicorn.protocols.websockets",
        "--hidden-import=uvicorn.protocols.websockets.auto",
        "--hidden-import=uvicorn.lifespan",
        "--hidden-import=uvicorn.lifespan.on",
        "--hidden-import=aiosqlite",
        "--hidden-import=greenlet",
        "--hidden-import=playwright",
        "main.py"
    ]
    subprocess.run(pyinstaller_cmd, cwd=backend_src, check=True)
    
    print("Copy Backend...")
    backend_dist_src = os.path.join(backend_src, "dist", "pyflow-backend")
    backend_dest = os.path.join(release_dir, "backend")
    shutil.copytree(backend_dist_src, backend_dest)
    
    print("Copy Frontend...")
    frontend_dest = os.path.join(release_dir, "frontend")
    os.makedirs(frontend_dest)
    shutil.copytree(os.path.join(frontend_dir, "dist"), os.path.join(frontend_dest, "dist"))

    # Icon nam TRONG backend/ (an voi nguoi dung) — start.vbs cung chuyen vao day
    # (xem bên dưới), chỉ để lộ 1 shortcut .lnk có icon riêng ở thư mục gốc release
    # cho gọn/chuyên nghiệp, thay vì bày cả start.vbs + pyflow.ico ra ngoài.
    if os.path.exists(icon_path):
        shutil.copy2(icon_path, os.path.join(backend_dest, "pyflow.ico"))

    write_release_manifest(backend_dest, version)

    print("Tao start.vbs (Windows)...")
    start_vbs_path = os.path.join(backend_dest, "start.vbs")
    with open(start_vbs_path, "w", encoding="utf-8") as f:
        f.write('''\' PyFlow Studio - Khoi dong (Release)
\' File nay nam TRONG thu muc backend (an voi nguoi dung, xem shortcut duoi day) —
\' scriptDir la chinh thu muc backend, parentDir moi la goc thu muc release.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
parentDir = fso.GetParentFolderName(scriptDir)

Set ws = CreateObject("WScript.Shell")

\' ── Tao shortcut icon PyFlow o thu muc goc release (chi lan chay dau) ───────
\' File .vbs KHONG THE tu doi icon rieng (Windows luon hien icon VBScript chung
\' cho moi file .vbs) — gioi han cua he dieu hanh, khong phai bug.
\' ĐÃ THU THAT: tao san shortcut nay luc BUILD (tren may dev) khong dung duoc —
\' .lnk luu duong dan TUYET DOI cua may dev, sang may khach la sai hoan toan,
\' Windows KHONG tu dong doi sang duong dan tuong doi (da test that bang
\' PowerShell: di chuyen thu muc xong thi shortcut tro vao noi khong con ton
\' tai). Vi vay phai tao luc CHAY THAT tren may khach — scriptDir luc do moi
\' dung 100%. Ket qua: LAN DAU TIEN nguoi dung van phai tu vao backend\\start.vbs
\' de bam (icon VBScript mac dinh, khong tranh duoc) — nhung tu LAN THU HAI tro
\' di, "PyFlow Studio.lnk" (icon rieng) da nam san o thu muc goc de dung.
shortcutPath = parentDir & "\\PyFlow Studio.lnk"
iconPath = scriptDir & "\\pyflow.ico"
If Not fso.FileExists(shortcutPath) And fso.FileExists(iconPath) Then
    Set shortcut = ws.CreateShortcut(shortcutPath)
    shortcut.TargetPath = scriptDir & "\\start.vbs"
    shortcut.IconLocation = iconPath & ",0"
    shortcut.WorkingDirectory = scriptDir
    shortcut.Save
End If

\' BAT CHE DO BAN QUYEN (License Enforce = 1)
Set env = ws.Environment("Process")
env("PYFLOW_LICENSE_ENFORCE") = "1"

\' Dong port 8000 neu dang mo
ws.Run "powershell -Command ""Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }""", 0, True
WScript.Sleep 1000

\' ── Don file cua BAN CU con sot lai sau khi cap nhat ────────────────────────
\' Cap nhat = giai nen update.zip DE len thu muc cu; file ban cu khong con trong
\' ban moi van nam lai trong _internal va lam backend treo (v2.3.155). Xoa moi file
\' khong co trong release_files.txt, CHUA NGUYEN thu muc data (du lieu + license).
CleanStaleFiles scriptDir

backendExe = scriptDir & "\\pyflow-backend.exe"

If Not fso.FileExists(backendExe) Then
    MsgBox "Chưa tìm thấy file thực thi Backend.", 16, "Lỗi Khởi Động"
    WScript.Quit 1
End If

\' ── Kiem tra Chromium rieng cua Playwright; chua co thi cai (mot lan) ──────
\' BAT BUOC: neu thieu, khoi Browser se fallback sang Chrome/Edge he thong —
\' tuc la Chrome ca nhan cua may khach, chiu anh huong group policy / tien ich /
\' phien ban khac nhau => hay bi "khong dang nhap duoc" va hien thanh vang
\' "unsupported command-line flag". Chromium rieng thi may nao cung giong nhau.
localAppData = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%")
pwRoot = scriptDir & "\\ms-playwright"
If Not fso.FolderExists(pwRoot) Then
    pwRoot = localAppData & "\\ms-playwright"
End If

If Not ChromiumReady(pwRoot) Then
    q = Chr(34)
    \' Mo console cai dat (hien tien trinh tai), doi cai xong roi moi chay tiep
    ws.CurrentDirectory = scriptDir
    ws.Run "cmd /c " & q & q & backendExe & q & " install-browser" & q, 1, True
    If Not ChromiumReady(pwRoot) Then
        \' Popup tu tat sau 20s de khong treo may khi may khong co mang
        ws.Popup "Chua tai duoc Chromium rieng cho automation (can Internet, ~150MB)." & vbCrLf & vbCrLf & _
                 "PyFlow van chay duoc bang Chrome he thong, nhung khoi Browser co the bi chan dang nhap." & vbCrLf & vbCrLf & _
                 "Cach xu ly: mo thu muc backend, chay lenh" & vbCrLf & _
                 "    pyflow-backend.exe install-browser" & vbCrLf & _
                 "hoac copy thu muc ms-playwright tu may da chay duoc vao:" & vbCrLf & _
                 "    " & scriptDir & "\\ms-playwright", 20, "PyFlow Studio - Thieu Chromium", 48
    End If
End If

\' Khoi dong Backend
ws.CurrentDirectory = scriptDir
ws.Run """" & backendExe & """", 0, False

WScript.Sleep 3000

\' Mo trinh duyet
ws.Run "http://localhost:8000", 1, False

\' Moi phien ban chi don 1 lan (danh dau trong data\\.cleaned_version).
Sub CleanStaleFiles(backendDir)
    Dim manifestPath, internalDir, markerPath, ts, line, keep, version, done
    manifestPath = backendDir & "\\release_files.txt"
    internalDir = backendDir & "\\_internal"
    If Not fso.FileExists(manifestPath) Or Not fso.FolderExists(internalDir) Then Exit Sub
    Set keep = CreateObject("Scripting.Dictionary")
    keep.CompareMode = 1
    version = ""
    \' -1 = doc dang Unicode (UTF-16) — khop ten file co ky tu ngoai bang ma ANSI
    Set ts = fso.OpenTextFile(manifestPath, 1, False, -1)
    Do While Not ts.AtEndOfStream
        line = Trim(ts.ReadLine)
        If Left(line, 9) = "#version=" Then
            version = Mid(line, 10)
        ElseIf Len(line) > 0 Then
            keep(line) = True
        End If
    Loop
    ts.Close
    \' Danh sach rong/hong thi KHONG xoa gi (an toan hon xoa nham ca ban moi)
    If keep.Count < 100 Or version = "" Then Exit Sub
    markerPath = internalDir & "\\data\\.cleaned_version"
    done = ""
    If fso.FileExists(markerPath) Then
        Set ts = fso.OpenTextFile(markerPath, 1)
        If Not ts.AtEndOfStream Then done = Trim(ts.ReadLine)
        ts.Close
    End If
    If done = version Then Exit Sub
    On Error Resume Next
    CleanFolder fso.GetFolder(internalDir), "", keep
    If Not fso.FolderExists(internalDir & "\\data") Then fso.CreateFolder internalDir & "\\data"
    Set ts = fso.CreateTextFile(markerPath, True)
    ts.WriteLine version
    ts.Close
    On Error GoTo 0
End Sub

Sub CleanFolder(folder, rel, keep)
    Dim f, sf, toDelete, emptyDirs, p
    Set toDelete = CreateObject("Scripting.Dictionary")
    Set emptyDirs = CreateObject("Scripting.Dictionary")
    For Each f In folder.Files
        p = rel & f.Name
        If Not keep.Exists(p) Then toDelete(f.Path) = True
    Next
    For Each p In toDelete.Keys
        fso.DeleteFile p, True
    Next
    For Each sf In folder.SubFolders
        If Not (rel = "" And LCase(sf.Name) = "data") Then
            CleanFolder sf, rel & sf.Name & "\\", keep
            If sf.Files.Count = 0 And sf.SubFolders.Count = 0 Then emptyDirs(sf.Path) = True
        End If
    Next
    For Each p In emptyDirs.Keys
        fso.DeleteFolder p, True
    Next
End Sub

\' Co chromium-<rev>\\chrome-win64\\chrome.exe trong pwRoot hay chua?
Function ChromiumReady(pwRoot)
    Dim f
    ChromiumReady = False
    If Not fso.FolderExists(pwRoot) Then Exit Function
    For Each f In fso.GetFolder(pwRoot).SubFolders
        If LCase(Left(f.Name, 9)) = "chromium-" Then
            If fso.FileExists(f.Path & "\\chrome-win64\\chrome.exe") Then ChromiumReady = True
        End If
    Next
End Function
''')

    # KHONG tao "PyFlow Studio.lnk" o day (luc build, tren may dev) — da THU THAT
    # bang PowerShell: shortcut .lnk luu duong dan TUYET DOI luc tao, sang may
    # khach (thu muc goc khac) la sai hoan toan, Windows KHONG tu doi sang tuong
    # doi (di chuyen thu muc test xong la shortcut tro vao cho khong con ton
    # tai). Vi vay viec tao shortcut duoc doi sang cho CHINH start.vbs tu lam
    # luc chay that tren may khach (xem khoi code o dau start.vbs ben tren) —
    # scriptDir luc do moi chac chan dung 100%.
    print(f"Dong goi thanh cong tai thu muc: {release_dir}")
    
    # ---------------------------------------------------------
    # Auto ZIP and GitHub Release
    # ---------------------------------------------------------
    print("Dang tao file update.zip...")
    
    zip_path = os.path.join(root_dir, "Releases", "update")
    shutil.make_archive(zip_path, 'zip', release_dir)
    print(f"Da tao {zip_path}.zip")

    # ── Ky ban cap nhat ──────────────────────────────────────────────────────
    # update.zip duoc giai nen DE LEN thu muc cai dat roi chay lai app -> day la
    # kenh phan phoi code toi may khach. Khong ky thi ai sua duoc asset cua
    # release la moi may khach bam "Cap nhat" se chay code cua ho.
    sys.path.insert(0, os.path.join(root_dir, "backend"))
    from services.update_signing import sign_update

    priv_file = os.path.join(root_dir, "secrets", "license_private.txt")
    if not os.path.exists(priv_file):
        print("!! KHONG TIM THAY secrets/license_private.txt - KHONG the ky ban cap nhat.")
        print("   Client doi moi se TU CHOI cai ban nay. Dung lai.")
        sys.exit(1)

    with open(priv_file, "r", encoding="utf-8") as f:
        priv_b64 = f.read().strip()

    print("Dang ky update.zip (Ed25519)...")
    sig_text = sign_update(zip_path + ".zip", priv_b64)
    sig_path = zip_path + ".zip.sig"
    with open(sig_path, "w", encoding="utf-8") as f:
        f.write(sig_text)
    print(f"Da tao {sig_path}")

    
    env_file = os.path.join(root_dir, ".env")
    token = None
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            for line in f:
                if line.startswith("GITHUB_TOKEN="):
                    token = line.split("=", 1)[1].strip()
                    break
                    
    if token:
        print("Dang upload len GitHub Releases...")
        try:
            # 1. Check/Create Release
            repo = "phampetro/workflow_re"
            tag_name = f"v{version}"
            
            headers = {
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "PyFlow-Studio-Builder"
            }
            
            # Kiem tra release co chua
            check_req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/tags/{tag_name}", headers=headers)
            release_id = None
            upload_url = None
            try:
                with urllib.request.urlopen(check_req) as response:
                    res_data = json.loads(response.read().decode())
                    release_id = res_data["id"]
                    upload_url = res_data["upload_url"]
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    # Create release
                    post_data = json.dumps({"tag_name": tag_name, "name": f"Release v{version}", "body": "Auto-generated release"}).encode('utf-8')
                    create_req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases", data=post_data, headers=headers)
                    with urllib.request.urlopen(create_req) as response:
                        res_data = json.loads(response.read().decode())
                        release_id = res_data["id"]
                        upload_url = res_data["upload_url"]
                else:
                    raise e
                    
            if upload_url:
                # Upload CA HAI: update.zip va update.zip.sig
                # Client doi moi bat buoc phai co .sig moi chiu cai (xem
                # backend/routers/system.py -> verify_update).
                uploads = [
                    ("update.zip", zip_path + ".zip", "application/zip"),
                    ("update.zip.sig", zip_path + ".zip.sig", "application/json"),
                ]
                wanted = {name for name, _, _ in uploads}

                # 2. Xoa asset cu trung ten (chi trung ten minh sap upload)
                assets_req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases/{release_id}/assets", headers=headers)
                with urllib.request.urlopen(assets_req) as response:
                    assets = json.loads(response.read().decode())
                    for asset in assets:
                        if asset["name"] in wanted:
                            del_req = urllib.request.Request(asset["url"], headers=headers, method="DELETE")
                            urllib.request.urlopen(del_req)

                # 3. Upload asset moi.
                # Upload .sig TRUOC roi moi toi .zip: neu dut mang giua chung thi
                # release con lai chu ky cu + KHONG co zip -> client bao loi ro
                # rang. Nguoc lai (zip moi + sig cu) se thanh "chu ky khong hop le"
                # rat kho hieu.
                for name, path, ctype in reversed(uploads):
                    size = os.path.getsize(path)
                    print(f"Dang upload {name} ({size} bytes)...")
                    clean_url = upload_url.split("{")[0] + f"?name={name}"
                    with open(path, "rb") as f:
                        file_data = f.read()
                    upload_req = urllib.request.Request(clean_url, data=file_data, headers={
                        "Authorization": f"Bearer {token}",
                        "Accept": "application/vnd.github.v3+json",
                        "Content-Type": ctype,
                        "User-Agent": "PyFlow-Studio-Builder"
                    })
                    with urllib.request.urlopen(upload_req):
                        print(f"   {name}: OK")
                print("Upload GitHub thanh cong!")
                    
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode()
            print(f"Loi khi upload GitHub: {e.code} - {err_msg}")
        except Exception as e:
            print(f"Loi khi upload GitHub: {e}")
    else:
        print("Khong tim thay GITHUB_TOKEN trong file .env, bo qua upload.")

def _ensure_backend_venv():
    """Luôn chạy build bằng Python của backend\\.venv, dù gọi bằng lệnh nào.

    Gõ `python tools\\build_release.py` trong PowerShell là chạy bằng Python HỆ THỐNG —
    thiếu cryptography nên build xong ~10 phút mới chết ở bước ký update.zip
    ("No module named 'cryptography'"). PyInstaller/pip trong script vốn đã dùng venv,
    chỉ bước ký là dùng nhầm interpreter đang chạy.
    """
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    venv_py = os.path.join(root_dir, "backend", ".venv", "Scripts", "python.exe")
    if not os.path.exists(venv_py):
        sys.exit(f"[LOI] Khong tim thay {venv_py} — chay setup.bat truoc.")
    if os.path.normcase(os.path.abspath(sys.executable)) != os.path.normcase(venv_py):
        print(f"Chay lai bang Python cua backend\\.venv: {venv_py}")
        sys.exit(subprocess.call([venv_py, os.path.abspath(__file__), *sys.argv[1:]]))


def _preflight_signing(root_dir):
    """Kiểm ký được TRƯỚC khi build — không đợi build xong mới phát hiện thiếu."""
    priv_file = os.path.join(root_dir, "secrets", "license_private.txt")
    if not os.path.exists(priv_file):
        sys.exit("[LOI] Khong tim thay secrets/license_private.txt — khong ky duoc ban cap nhat. Dung lai.")
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: F401
    except ImportError:
        sys.exit("[LOI] backend\\.venv thieu goi cryptography — chay: "
                 "backend\\.venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt")


if __name__ == "__main__":
    _ensure_backend_venv()
    _preflight_signing(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    main()
