@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo   PyFlow Studio - Cai dat lan dau
echo ============================================
echo.

echo [1/4] Tao Python virtual environment (backend\.venv)...
if exist "%ROOT%\backend\.venv\Scripts\python.exe" (
    echo    Da ton tai, bo qua.
) else (
    python -m venv "%ROOT%\backend\.venv"
    if errorlevel 1 (
        echo [Loi] Khong tao duoc venv. Kiem tra da cai Python va them vao PATH chua.
        pause
        exit /b 1
    )
)
echo    [OK]

echo [2/4] Cai dat thu vien Python...
"%ROOT%\backend\.venv\Scripts\pip.exe" install -r "%ROOT%\backend\requirements.txt"
if errorlevel 1 (
    echo [Loi] Cai thu vien Python that bai.
    pause
    exit /b 1
)
echo    [OK]

echo [3/4] Cai dat trinh duyet cho Playwright (khoi "Trinh duyet")...
"%ROOT%\backend\.venv\Scripts\python.exe" -m playwright install
if errorlevel 1 (
    echo [Canh bao] Cai Playwright that bai - khoi "Trinh duyet" se khong hoat dong. Co the bo qua neu khong dung khoi nay.
)
echo    [OK]

echo [4/4] Cai dat thu vien Frontend (npm install)...
pushd "%ROOT%\frontend"
call npm install
set NPM_ERR=%errorlevel%
popd
if not "%NPM_ERR%"=="0" (
    echo [Loi] npm install that bai. Kiem tra da cai Node.js chua.
    pause
    exit /b 1
)
echo    [OK]

echo.
echo ============================================
echo   Cai dat xong! Chay start.bat de khoi dong.
echo ============================================
pause
