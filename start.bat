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

echo [2/4] Kiem tra va khoi phuc moi truong Ao (Virtual Environment)...
cd /d "%~dp0backend"

:: Kiem tra xem .venv co hoat dong khong (do loi copy sang may khac)
.venv\Scripts\python -c "import sys" >nul 2>&1
if %errorlevel% neq 0 (
    echo Phat hien .venv bi loi hoac chua ton tai (co the do copy sang may khac).
    echo Dang tao lai moi truong ao va cai dat thu vien...
    if exist .venv rmdir /s /q .venv
    python -m venv .venv
    .venv\Scripts\python -m pip install --upgrade pip
    .venv\Scripts\python -m pip install -r requirements.txt
    echo Cai dat hoan tat!
)

echo [3/4] Khoi dong Backend (port 8000)...
start /B "" cmd /c ".venv\Scripts\python main.py > "%~dp0backend_log.txt" 2>&1"
cd /d "%~dp0"

echo [4/4] Doi backend san sang va mo browser...
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
if not exist "node_modules\" (
    echo [4/5] Cai dat thu vien Frontend (lan dau hoac do copy sang may khac)...
    npm install
)
npm run dev
