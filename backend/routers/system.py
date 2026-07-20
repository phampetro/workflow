from fastapi import APIRouter
import subprocess
import os

router = APIRouter(prefix="/api/system", tags=["System"])

@router.get("/info")
def get_system_info():
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
        version = f"{major}.{minor}"

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
    try:
        import platform
        import threading
        
        def run_and_die():
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            if platform.system() == "Windows":
                bat_file = os.path.join(root_dir, "update_and_restart.bat")
                # CREATE_NEW_CONSOLE = 0x00000010
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
