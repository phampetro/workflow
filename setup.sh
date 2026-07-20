#!/bin/bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================"
echo "  PyFlow Studio - Cai dat lan dau (macOS/Linux)"
echo "============================================"
echo ""

echo "[1/4] Tao Python virtual environment (backend/.venv)..."
if [ -f "$ROOT/backend/.venv/bin/python" ]; then
    echo "   Da ton tai, bo qua."
else
    python3 -m venv "$ROOT/backend/.venv"
    if [ $? -ne 0 ]; then
        echo "[Loi] Khong tao duoc venv. Kiem tra da cai Python3 chua."
        exit 1
    fi
fi
echo "   [OK]"

echo "[2/4] Cai dat thu vien Python..."
"$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt"
if [ $? -ne 0 ]; then
    echo "[Loi] Cai thu vien Python that bai."
    exit 1
fi
echo "   [OK]"

echo "[3/4] Cai dat Chromium cho Playwright (khoi Trinh duyet)..."
"$ROOT/backend/.venv/bin/python" -m playwright install chromium
if [ $? -ne 0 ]; then
    echo "[Canh bao] Cai Playwright that bai - khoi Trinh duyet se khong hoat dong."
fi
echo "   [OK]"

echo "[4/4] Cai dat thu vien Frontend (npm install)..."
cd "$ROOT/frontend"
npm install
if [ $? -ne 0 ]; then
    echo "[Loi] npm install that bai. Kiem tra da cai Node.js chua."
    exit 1
fi
echo "   [OK]"

echo ""
echo "============================================"
echo "  Cai dat xong! Chay ./start.sh de khoi dong."
echo "============================================"
