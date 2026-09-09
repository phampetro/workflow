import os
import shutil
import subprocess
import sys
import json
import urllib.request
import urllib.error

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    os.chdir(root_dir)
    
    release_dir = os.path.join(root_dir, "Releases", "pyflow-studio")
    
    print("Don dep thu muc release cu...")
    if os.path.exists(release_dir):
        shutil.rmtree(release_dir)
    os.makedirs(release_dir)
    
    print("Build Frontend...")
    frontend_dir = os.path.join(root_dir, "frontend")
    subprocess.run(["npm", "run", "build"], cwd=frontend_dir, shell=True, check=True)
    
    print("Build Backend (EXE) bang PyInstaller...")
    backend_src = os.path.join(root_dir, "backend")
    
    # Kiem tra python exe
    python_exe = os.path.join(backend_src, ".venv", "Scripts", "python.exe")
    if not os.path.exists(python_exe):
        python_exe = os.path.join(backend_src, ".venv", "bin", "python")
        
    print("Tao file release_version.json...")
    try:
        count_out = subprocess.check_output(["git", "rev-list", "--count", "HEAD"], text=True).strip()
        count = int(count_out)
        base_count = 24
        adjusted = max(0, count - base_count)
        increment = adjusted // 10
        major = 1 + (increment // 10)
        minor = increment % 10
        version = f"{major}.{minor}.{count}"
        date_out = subprocess.check_output(["git", "log", "-1", "--format=%cd", "--date=format:%d/%m/%Y %H:%M:%S"], text=True).strip()
    except Exception:
        version = "1.0.0"
        date_out = "Unknown"
        count = 0
        
    version_file = os.path.join(backend_src, "release_version.json")
    with open(version_file, "w") as f:
        json.dump({"version": version, "updatedAt": date_out, "commitCount": count}, f)
        
    subprocess.run([python_exe, "-m", "pip", "install", "pyinstaller"], cwd=backend_src, check=True)
    
    pyinstaller_cmd = [
        python_exe, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name", "pyflow-backend",
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
    
    print("Tao start.vbs (Windows)...")
    start_vbs_path = os.path.join(release_dir, "start.vbs")
    with open(start_vbs_path, "w", encoding="utf-8") as f:
        f.write('''\' PyFlow Studio - Khoi dong (Release)
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set ws = CreateObject("WScript.Shell")

\' BAT CHE DO BAN QUYEN (License Enforce = 1)
Set env = ws.Environment("Process")
env("PYFLOW_LICENSE_ENFORCE") = "1"

\' Dong port 8000 neu dang mo
ws.Run "powershell -Command ""Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }""", 0, True
WScript.Sleep 1000

backendExe = scriptDir & "\\backend\\pyflow-backend.exe"

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
pwRoot = scriptDir & "\\backend\\ms-playwright"
If Not fso.FolderExists(pwRoot) Then
    pwRoot = localAppData & "\\ms-playwright"
End If

If Not ChromiumReady(pwRoot) Then
    q = Chr(34)
    \' Mo console cai dat (hien tien trinh tai), doi cai xong roi moi chay tiep
    ws.CurrentDirectory = scriptDir & "\\backend"
    ws.Run "cmd /c " & q & q & backendExe & q & " install-browser" & q, 1, True
    If Not ChromiumReady(pwRoot) Then
        \' Popup tu tat sau 20s de khong treo may khi may khong co mang
        ws.Popup "Chua tai duoc Chromium rieng cho automation (can Internet, ~150MB)." & vbCrLf & vbCrLf & _
                 "PyFlow van chay duoc bang Chrome he thong, nhung khoi Browser co the bi chan dang nhap." & vbCrLf & vbCrLf & _
                 "Cach xu ly: mo thu muc backend, chay lenh" & vbCrLf & _
                 "    pyflow-backend.exe install-browser" & vbCrLf & _
                 "hoac copy thu muc ms-playwright tu may da chay duoc vao:" & vbCrLf & _
                 "    " & scriptDir & "\\backend\\ms-playwright", 20, "PyFlow Studio - Thieu Chromium", 48
    End If
End If

\' Khoi dong Backend
ws.CurrentDirectory = scriptDir & "\\backend"
ws.Run """" & backendExe & """", 0, False

WScript.Sleep 3000

\' Mo trinh duyet
ws.Run "http://localhost:8000", 1, False

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

if __name__ == "__main__":
    main()
