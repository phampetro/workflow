@echo off
chcp 65001 >nul
echo =============================================
echo   PyFlow Studio -- Backend v1.0
echo   http://localhost:8000
echo =============================================
cd /d "%~dp0"
.venv\Scripts\python main.py
