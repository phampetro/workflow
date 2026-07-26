from fastapi import APIRouter, Request
import subprocess
import os
import sys
import json
import urllib.request
import shutil
import threading

router = APIRouter(prefix="/api/system", tags=["System"])

@router.get("/info")
def get_system_info():
    if getattr(sys, 'frozen', False):
        try:
            version_file = os.path.join(sys._MEIPASS, "release_version.json")
            with open(version_file, "r") as f:
                return json.load(f)
        except Exception as e:
            return {"version": "Unknown", "updatedAt": "Unknown", "commitCount": 0, "error": str(e)}

    try:
        # Get total commits
        count_out = subprocess.check_output(["git", "rev-list", "--count", "HEAD"], text=True).strip()
        count = int(count_out)
        
        # Calculate version
        base_count = 24
        adjusted = max(0, count - base_count)
        increment = adjusted // 10
        major = 1 + (increment // 10)
        minor = increment % 10
        version = f"{major}.{minor}.{count}"

        # Get last commit date
        date_out = subprocess.check_output(
            ["git", "log", "-1", "--format=%cd", "--date=format:%d/%m/%Y %H:%M:%S"], text=True
        ).strip()

        return {
            "version": version,
            "updatedAt": date_out,
            "commitCount": count
        }
    except Exception as e:
        return {
            "version": "1.0",
            "updatedAt": "Unknown",
            "commitCount": 0,
            "error": str(e)
        }

@router.get("/check-update")
def check_update():
    if getattr(sys, 'frozen', False):
        try:
            req = urllib.request.Request("https://api.github.com/repos/phampetro/workflow_re/releases/latest")
            req.add_header("User-Agent", "PyFlow-Studio-Updater")
            with urllib.request.urlopen(req, timeout=10) as response:
                release_data = json.loads(response.read().decode())
            
            latest_version = release_data.get("tag_name", "").lstrip("v")
            assets = release_data.get("assets", [])
            download_url = None
            for asset in assets:
                if asset["name"].endswith(".zip"):
                    download_url = asset["browser_download_url"]
                    break
            
            if not download_url:
                download_url = release_data.get("zipball_url")
            
            version_file = os.path.join(sys._MEIPASS, "release_version.json")
            with open(version_file, "r") as f:
                current_version = json.load(f).get("version", "0.0.0")
                
            if latest_version and latest_version != current_version:
                return {"hasUpdate": True, "message": f"Có bản cập nhật mới (v{latest_version})", "download_url": download_url}
            
            return {"hasUpdate": False, "message": "Bạn đang dùng phiên bản mới nhất"}
        except Exception as e:
            return {"hasUpdate": False, "error": str(e), "message": "Không thể kiểm tra cập nhật từ GitHub."}

    try:
        # Fetch remote updates
        subprocess.run(["git", "fetch", "origin", "main"], check=True, timeout=10)
        status_out = subprocess.check_output(["git", "status", "-uno"], text=True)
        if "Your branch is behind" in status_out:
            return {"hasUpdate": True, "message": "Có bản cập nhật mới"}
        return {"hasUpdate": False, "message": "Bạn đang dùng phiên bản mới nhất"}
    except FileNotFoundError:
        return {"hasUpdate": False, "error": "GIT_NOT_FOUND", "message": "Hệ thống không tìm thấy Git. Vui lòng cài đặt Git để sử dụng tính năng cập nhật."}
    except Exception as e:
        return {"hasUpdate": False, "error": str(e)}

@router.post("/update")
def execute_update():
    if getattr(sys, 'frozen', False):
        try:
            req = urllib.request.Request("https://api.github.com/repos/phampetro/workflow_re/releases/latest")
            req.add_header("User-Agent", "PyFlow-Studio-Updater")
            with urllib.request.urlopen(req, timeout=10) as response:
                release_data = json.loads(response.read().decode())
                download_url = None
                for asset in release_data.get("assets", []):
                    if asset["name"].endswith(".zip"):
                        download_url = asset["browser_download_url"]
                        break
                if not download_url:
                    download_url = release_data.get("zipball_url")
            
            if not download_url:
                raise Exception("Không tìm thấy link tải bản cập nhật trên GitHub Releases.")

            def run_updater():
                import platform
                root_dir = os.path.dirname(sys.executable)
                parent_dir = os.path.dirname(root_dir)
                zip_path = os.path.join(parent_dir, "update.zip")
                
                req = urllib.request.Request(download_url)
                req.add_header("User-Agent", "PyFlow-Studio-Updater")
                with urllib.request.urlopen(req) as response, open(zip_path, 'wb') as out_file:
                    shutil.copyfileobj(response, out_file)
                
                if platform.system() == "Windows":
                    bat_path = os.path.join(parent_dir, "updater.bat")
                    with open(bat_path, "w", encoding="utf-8") as f:
                        f.write(f'''@echo off
echo DANG TAI VA CAP NHAT PHIEN BAN MOI...
echo Xin vui long cho, khong dong cua so nay.
ping 127.0.0.1 -n 3 > nul
echo Giai nen file update.zip...
powershell -command "Expand-Archive -Force -Path update.zip -DestinationPath ."
echo Hoan tat giai nen. Xoa file tam...
del update.zip
echo Khoi dong lai phan mem...
start start.vbs
del "%~f0"
''')
                    subprocess.Popen(["cmd.exe", "/c", bat_path], cwd=parent_dir, creationflags=0x00000010)
                else:
                    sh_path = os.path.join(parent_dir, "updater.sh")
                    with open(sh_path, "w", encoding="utf-8") as f:
                        f.write(f'''#!/bin/bash
echo "DANG CAP NHAT PHIEN BAN MOI..."
sleep 2
unzip -o update.zip
rm update.zip
./start_mac.command &
rm "$0"
''')
                    os.chmod(sh_path, 0o755)
                    subprocess.Popen([sh_path], cwd=parent_dir, preexec_fn=os.setsid)
                os._exit(0)
            
            threading.Timer(1.0, run_updater).start()
            return {"status": "updating", "message": "Đang tải bản cập nhật và khởi động lại..."}
        except Exception as e:
            return {"error": str(e)}

    try:
        import platform
        
        def run_and_die():
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            if platform.system() == "Windows":
                bat_file = os.path.join(root_dir, "update_and_restart.bat")
                subprocess.Popen(["cmd.exe", "/c", bat_file], cwd=root_dir, creationflags=0x00000010)
            else:
                sh_file = os.path.join(root_dir, "update_and_restart.sh")
                subprocess.Popen([sh_file], cwd=root_dir, preexec_fn=os.setsid)
            
            # Kill current process
            os._exit(0)

        # Doi 1 giay roi tat de API kip tra ve response cho Frontend
        threading.Timer(1.0, run_and_die).start()
        
        return {"status": "updating", "message": "Hệ thống đang cập nhật và khởi động lại..."}
    except Exception as e:
        return {"error": str(e)}
