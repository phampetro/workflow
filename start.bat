@echo off
chcp 65001 >nul
title PyFlow Studio
cls
echo =============================================
echo   PyFlow Studio -- Khoi dong toan bo
echo =============================================
echo.

echo [1/5] Kiem tra va cap nhat code tu Git...
git pull
if %errorlevel% neq 0 (
    echo.
    echo [Loi] Cap nhat Git that bai! ^(Co the do conflict hoac ket noi mang^).
    echo [Loi] Da dung qua trinh khoi dong.
    pause
    exit /b %errorlevel%
)
echo Cap nhat Git thanh cong.
echo.

echo [2/5] Giai phong cong 8000 va 5173...
for /f "tokens=5" %%a in ('netstat -a -n -o ^| findstr :8000') do taskkill /f /pid %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -a -n -o ^| findstr :5173') do taskkill /f /pid %%a >nul 2>&1
echo Da giai phong cong.
echo.

echo [3/5] Kiem tra moi truong Python (.venv)...
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
    echo Chua co .venv, dang tao moi truong ao va cai thu vien...
    python -m venv .venv
    .venv\Scripts\python.exe -m pip install --upgrade pip --quiet
    .venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
    echo Cai dat hoan tat!
    echo.
)

echo [4/5] Khoi dong Backend (an, port 8000)...
start /B cmd /c "cd /d "%~dp0backend" && .venv\Scripts\python.exe main.py >> "%~dp0backend_log.txt" 2>&1"
cd /d "%~dp0"

echo Doi backend san sang...
timeout /t 3 /nobreak >nul

echo Mo trinh duyet...
start "" "http://localhost:5173"
echo.
echo Backend : http://localhost:8000  (log: backend_log.txt)
echo Frontend: http://localhost:5173
echo.
echo Nhan Ctrl+C de dung.
echo =============================================
echo.

echo [5/5] Khoi dong Frontend...
cd /d "%~dp0frontend"
if not exist "node_modules\" (
    echo Chua co node_modules, dang cai npm install...
    npm install
    echo.
)
npm run dev
