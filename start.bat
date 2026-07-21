@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

python --version >nul 2>&1
if errorlevel 1 (
    echo [Loi] He thong khong tim thay Python. Vui long cai dat Python va them vao PATH.
    pause
    exit /b 1
)

npm --version >nul 2>&1
if errorlevel 1 (
    echo [Loi] He thong khong tim thay Node.js. Vui long cai dat Node.js.
    pause
    exit /b 1
)

echo [1/4] Kiem tra va giai phong port 7000, 9000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":7000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo    [OK]

if not exist "%ROOT%\backend\.venv\Scripts\uvicorn.exe" (
    echo.
    echo [Loi] Chua thay backend\.venv - hay chay setup.bat truoc khi chay start.bat.
    pause
    exit /b 1
)
if not exist "%ROOT%\frontend\node_modules" (
    echo.
    echo [Loi] Chua thay frontend\node_modules - hay chay setup.bat truoc khi chay start.bat.
    pause
    exit /b 1
)

echo [2/4] Khoi dong Backend...
start "BE" /D "%ROOT%\backend" cmd /k ".venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 7000"
echo    [OK]

echo [3/4] Khoi dong Frontend...
start "FE" /D "%ROOT%\frontend" cmd /k "npm run dev"
echo    [OK]

echo [4/4] Mo trinh duyet...
start http://localhost:9000
echo    [OK]

echo.
echo [Xong] BE: localhost:7000  FE: localhost:9000
timeout /t 3 /nobreak >nul
exit
