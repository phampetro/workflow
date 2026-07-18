@echo off
setlocal enabledelayedexpansion

echo [1/4] Kiem tra va giai phong port 8000, 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
echo    [OK]

echo [2/4] Khoi dong Backend...
start "BE" cmd /k "title BE && cd /d d:\Local Google Drive\workflow\backend && .venv\Scripts\uvicorn.exe main:app --host 127.0.0.1 --port 8000"
echo    [OK]

echo [3/4] Khoi dong Frontend...
start "FE" cmd /k "title FE && cd /d d:\Local Google Drive\workflow\frontend && npm run dev"
echo    [OK]

echo [4/4] Mo trinh duyet...
start http://localhost:5173
echo    [OK]

echo.
echo [Xong] BE: localhost:8000  FE: localhost:5173
timeout /t 3 /nobreak >nul
exit
