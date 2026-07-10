@echo off
chcp 65001 >nul
title PyFlow Studio
cls
echo =============================================
echo   PyFlow Studio -- Khoi dong toan bo
echo =============================================
echo.

echo [1/4] Giai phong cong 8000 va 5173...
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

:: Kiem tra .venv bang cach chay thu python - luu errorlevel ngay lap tuc
.venv\Scripts\python.exe -c "import sys" >nul 2>&1
set VENV_OK=%errorlevel%

if %VENV_OK% neq 0 (
    echo Phat hien .venv bi loi hoac chua ton tai.
    echo Dang tao lai moi truong ao va cai dat thu vien...
    if exist .venv rmdir /s /q .venv
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo [LOI] Khong the tao .venv! Hay kiem tra Python da duoc cai dat chua.
        pause
        exit /b 1
    )
    .venv\Scripts\python.exe -m pip install --upgrade pip --quiet
    .venv\Scripts\python.exe -m pip install -r requirements.txt --quiet
    echo Cai dat hoan tat!
)

echo [3/4] Khoi dong Backend (port 8000)...
set LOG_FILE=%~dp0backend_log.txt
start "" cmd /c "cd /d "%~dp0backend" && .venv\Scripts\python.exe main.py > "%LOG_FILE%" 2>&1"
cd /d "%~dp0"

echo Doi backend san sang...
timeout /t 3 /nobreak >nul

echo [4/4] Mo browser...
start "" "http://localhost:5173"

echo.
echo Backend : http://localhost:8000  (log: backend_log.txt)
echo Frontend: http://localhost:5173
echo.
echo Nhan Ctrl+C de dung Frontend.
echo =============================================
echo.

cd /d "%~dp0frontend"
if not exist "node_modules\" (
    echo Cai dat thu vien Frontend (lan dau hoac do copy sang may khac)...
    npm install
    if %errorlevel% neq 0 (
        echo [LOI] Khong the cai dat node_modules!
        pause
        exit /b 1
    )
)
npm run dev
