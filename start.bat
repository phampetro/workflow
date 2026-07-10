@echo off
chcp 65001 >nul
title PyFlow Studio
cls
echo =============================================
echo   PyFlow Studio -- Khoi dong toan bo
echo =============================================
echo.

echo [1/3] Giai phong cong 8000 va 5173...
for /f "tokens=5" %%a in ('netstat -a -n -o ^| findstr :8000') do (
    taskkill /f /pid %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -a -n -o ^| findstr :5173') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo Da giai phong cong.
echo.

echo [2/3] Khoi dong Backend (port 8000)...
start /B "" cmd /c "cd /d "%~dp0backend" && .venv\Scripts\python main.py > "%~dp0backend_log.txt" 2>&1"

echo [3/4] Doi backend san sang...
timeout /t 3 /nobreak >nul

echo [4/4] Mo browser...
start "" "http://localhost:5173"

echo.
echo Backend : http://localhost:8000  (log: backend_log.txt)
echo Frontend: http://localhost:5173
echo.
echo Nhan Ctrl+C de dung tat ca.
echo =============================================
echo.

cd /d "%~dp0frontend"
npm run dev
