from fastapi import APIRouter, Request
import logging
import subprocess
import os
import sys
import json
import urllib.request
import shutil
import threading

logger = logging.getLogger("pyflow.system")

router = APIRouter(prefix="/api/system", tags=["System"])

# Lỗi của lần cập nhật gần nhất.
# run_updater() chạy trong threading.Timer, tức SAU KHI /update đã trả response
# "Đang cập nhật và khởi động lại...". Khi thành công thì app tự thoát nên không
# cần báo gì; khi THẤT BẠI (chữ ký sai, mạng đứt) mà không lưu lại thì người dùng
# ngồi nhìn spinner vĩnh viễn, không biết chuyện gì. FE poll /update-status để lấy.
_update_error: str | None = None


def _set_update_error(msg: str) -> None:
    global _update_error
    _update_error = msg


# ── Hardware & Resource Monitoring ─────────────────────────────
try:
    import psutil
    psutil.cpu_percent(interval=None)
except Exception:
    psutil = None

_cached_cpu_name: str | None = None
_cached_cpu_cores: dict | None = None


def _get_cpu_info():
    global _cached_cpu_name, _cached_cpu_cores
    if _cached_cpu_name is None:
        name = ""
        if sys.platform == "win32":
            try:
                import winreg
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
                name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
                name = name.strip()
            except Exception:
                pass
        if not name:
            import platform
            name = platform.processor() or "CPU"
        _cached_cpu_name = name

    if _cached_cpu_cores is None:
        phys = None
        logic = os.cpu_count() or 1
        if psutil:
            try:
                phys = psutil.cpu_count(logical=False)
            except Exception:
                pass
        _cached_cpu_cores = {
            "physical_cores": phys or logic,
            "logical_cores": logic
        }

    cpu_pct = 0.0
    if psutil:
        try:
            cpu_pct = psutil.cpu_percent(interval=0.1)
        except Exception:
            pass

    return {
        "name": _cached_cpu_name,
        "physical_cores": _cached_cpu_cores["physical_cores"],
        "logical_cores": _cached_cpu_cores["logical_cores"],
        "percent": round(cpu_pct, 1)
    }


def _get_memory_info():
    if psutil:
        try:
            mem = psutil.virtual_memory()
            return {
                "total_gb": round(mem.total / (1024 ** 3), 2),
                "used_gb": round(mem.used / (1024 ** 3), 2),
                "free_gb": round(mem.available / (1024 ** 3), 2),
                "percent": round(mem.percent, 1)
            }
        except Exception:
            pass
    return {
        "total_gb": 0,
        "used_gb": 0,
        "free_gb": 0,
        "percent": 0.0
    }


def _get_disk_info():
    if psutil:
        try:
            d = psutil.disk_usage(os.getcwd())
            return {
                "total_gb": round(d.total / (1024 ** 3), 1),
                "free_gb": round(d.free / (1024 ** 3), 1),
                "used_gb": round((d.total - d.free) / (1024 ** 3), 1),
                "percent": round(d.percent, 1)
            }
        except Exception:
            pass
    return {
        "total_gb": 0,
        "free_gb": 0,
        "used_gb": 0,
        "percent": 0.0
    }


_this_process = None

def _get_app_resource_usage():
    global _this_process
    if not psutil:
        return {"cpu_percent": 0.0, "memory_mb": 0.0}
    try:
        if _this_process is None:
            _this_process = psutil.Process(os.getpid())
            try:
                _this_process.cpu_percent()
            except Exception:
                pass

        mem_rss = _this_process.memory_info().rss
        cpu_pct = _this_process.cpu_percent()

        try:
            for child in _this_process.children(recursive=True):
                try:
                    mem_rss += child.memory_info().rss
                    cpu_pct += child.cpu_percent()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
        except Exception:
            pass

        logical_cores = psutil.cpu_count(logical=True) or 1
        normalized_cpu_pct = round(cpu_pct / logical_cores, 1)

        return {
            "cpu_percent": normalized_cpu_pct,
            "memory_mb": round(mem_rss / (1024 * 1024), 1)
        }
    except Exception:
        return {"cpu_percent": 0.0, "memory_mb": 0.0}


@router.get("/hardware")
def get_hardware_info():
    """Thông tin phần cứng máy tính và tài nguyên CPU/RAM/Disk theo thời gian thực."""
    cpu_info = _get_cpu_info()
    return {
        "cpu": cpu_info,
        "memory": _get_memory_info(),
        "disk": _get_disk_info(),
        "app": _get_app_resource_usage()
    }


@router.get("/update-status")
def get_update_status():
    """Trạng thái lần cập nhật gần nhất. FE poll sau khi bấm Cập nhật."""
    return {"error": _update_error}

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
            logger.exception("Kiểm tra cập nhật GitHub thất bại")
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
                sig_url = None
                for asset in release_data.get("assets", []):
                    name = asset["name"]
                    if name.endswith(".zip.sig"):
                        sig_url = asset["browser_download_url"]
                    elif name.endswith(".zip") and download_url is None:
                        download_url = asset["browser_download_url"]

            if not download_url:
                # KHÔNG fallback về zipball_url của GitHub nữa: đó là snapshot mã
                # nguồn, không phải bản đóng gói, và không hề được ký.
                raise Exception("Không tìm thấy file cập nhật (update.zip) trên GitHub Releases.")
            if not sig_url:
                raise Exception(
                    "Bản cập nhật này không có chữ ký số (update.zip.sig) nên đã bị từ chối. "
                    "Vui lòng liên hệ nhà phát hành."
                )

            _set_update_error(None)

            def run_updater():
                root_dir = os.path.dirname(sys.executable)
                parent_dir = os.path.dirname(root_dir)
                zip_path = os.path.join(parent_dir, "update.zip")
                
                req = urllib.request.Request(download_url)
                req.add_header("User-Agent", "PyFlow-Studio-Updater")
                # timeout BẮT BUỘC: không có thì mạng chập chờn làm thread Timer treo
                # vĩnh viễn, trong khi API đã trả "Đang cập nhật và khởi động lại…"
                # từ lâu — UI quay spinner mãi, không có gì xảy ra, không có log.
                # (check_update ở trên đã có timeout=10, chỗ này bị bỏ sót.)
                with urllib.request.urlopen(req, timeout=120) as response, open(zip_path, 'wb') as out_file:
                    shutil.copyfileobj(response, out_file)

                # ── CHỐT CHẶN: xác minh chữ ký TRƯỚC khi giải nén ────────────
                # updater.bat sẽ giải nén file này ĐÈ LÊN thư mục cài đặt rồi chạy
                # lại app. Không verify thì bất kỳ ai sửa được asset của release
                # (tài khoản GitHub bị chiếm) đều khiến mọi máy khách chạy code lạ.
                from services.update_signing import verify_update
                from services.license_pubkey import PUBLIC_KEY_B64
                try:
                    sig_req = urllib.request.Request(sig_url)
                    sig_req.add_header("User-Agent", "PyFlow-Studio-Updater")
                    with urllib.request.urlopen(sig_req, timeout=30) as r:
                        sig_text = r.read().decode("utf-8")
                    verify_update(zip_path, sig_text, PUBLIC_KEY_B64)
                except Exception as e:
                    # Xoá file đã tải: không để lại bản chưa xác minh trên đĩa,
                    # tránh lần sau có ai đó giải nén tay.
                    try:
                        os.remove(zip_path)
                    except Exception:
                        pass
                    logger.error(f"Từ chối bản cập nhật — xác minh chữ ký thất bại: {e}")
                    _set_update_error(f"Bản cập nhật không hợp lệ: {e}")
                    return

                logger.info("✅ Chữ ký bản cập nhật hợp lệ, tiến hành cài đặt.")

                # Windows-only: bản đóng gói chỉ tồn tại dưới dạng .exe do PyInstaller
                # build trên Windows. Nhánh POSIX cũ (sinh updater.sh chạy `unzip` rồi
                # `./start_mac.command`) là code chết — nó chỉ chạy khi sys.frozen, mà
                # không có bản frozen nào cho macOS/Linux.
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
                os._exit(0)
            
            threading.Timer(1.0, run_updater).start()
            return {"status": "updating", "message": "Đang tải bản cập nhật và khởi động lại..."}
        except Exception as e:
            return {"error": str(e)}

    # Windows-only (xem chú thích ở run_updater bên trên). Chặn sớm và báo rõ:
    # nếu để rơi xuống mà không làm gì, run_and_die vẫn os._exit(0) → app tắt hẳn
    # mà không hề cập nhật, người dùng không có cách nào biết chuyện gì đã xảy ra.
    if os.name != "nt":
        return {"error": "unsupported_os",
                "message": "Tính năng tự cập nhật chỉ hỗ trợ Windows."}

    try:
        def run_and_die():
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            bat_file = os.path.join(root_dir, "update_and_restart.bat")
            subprocess.Popen(["cmd.exe", "/c", bat_file], cwd=root_dir, creationflags=0x00000010)
            # Kill current process
            os._exit(0)

        # Doi 1 giay roi tat de API kip tra ve response cho Frontend
        threading.Timer(1.0, run_and_die).start()
        
        return {"status": "updating", "message": "Hệ thống đang cập nhật và khởi động lại..."}
    except Exception as e:
        return {"error": str(e)}
