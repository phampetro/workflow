@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo   PyFlow Studio - Cai dat lan dau
echo ============================================
echo.

echo [1/4] Tao Python virtual environment (backend\.venv)...
REM venv luu duong dan tuyet doi toi Python goc (pyvenv.cfg) nen hong khi doi may / cai lai Python.
REM Neu python.exe trong venv khong chay duoc thi xoa va tao lai.
if exist "%ROOT%\backend\.venv\Scripts\python.exe" (
    "%ROOT%\backend\.venv\Scripts\python.exe" -c "import uvicorn, pandas" >nul 2>&1
    if errorlevel 1 (
        echo    venv cu hong hoac cai do, dang tao lai...
        rmdir /s /q "%ROOT%\backend\.venv"
    )
)
if exist "%ROOT%\backend\.venv\Scripts\python.exe" (
    echo    Da ton tai, bo qua.
) else (
    REM Uu tien Python 3.14/3.13/3.12 (da co wheel dung san); Python qua moi se phai build tu source va loi.
    set "PYCMD=python"
    for %%v in (3.14 3.13 3.12) do (
        if "!PYCMD!"=="python" (
            py -%%v -c "import sys" >nul 2>&1
            if not errorlevel 1 set "PYCMD=py -%%v"
        )
    )
    echo    Dung: !PYCMD!
    !PYCMD! -m venv "%ROOT%\backend\.venv"
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

echo [3/4] Cai dat Chromium cho Playwright (khoi "Trinh duyet")...
"%ROOT%\backend\.venv\Scripts\python.exe" -m playwright install chromium
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
