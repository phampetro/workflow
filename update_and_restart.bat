@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo [1/3] Dang cap nhat ma nguon tu Github...
git pull origin main

echo [2/3] Doi he thong cu tat hoan toan...
timeout /t 2 /nobreak >nul

echo [3/3] Khoi dong lai he thong (Chay ngam)...
start "" "%ROOT%\start_hide.vbs"

exit
