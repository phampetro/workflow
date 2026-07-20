#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/4] Kiem tra va giai phong port 8000, 5173..."
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null
echo "   [OK]"

if [ ! -f "$ROOT/backend/.venv/bin/uvicorn" ]; then
    echo ""
    echo "[Loi] Chua thay backend/.venv - vui long cai dat moi truong truoc."
    exit 1
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo ""
    echo "[Loi] Chua thay frontend/node_modules - vui long cai dat moi truong truoc."
    exit 1
fi

echo "[2/4] Khoi dong Backend..."
cd "$ROOT/backend"
./.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 &
BE_PID=$!
echo "   [OK]"

echo "[3/4] Khoi dong Frontend..."
cd "$ROOT/frontend"
npm run dev &
FE_PID=$!
echo "   [OK]"

echo "[4/4] Mo trinh duyet..."
sleep 2
if which open > /dev/null; then
    open http://localhost:5173
elif which xdg-open > /dev/null; then
    xdg-open http://localhost:5173
fi
echo "   [OK]"

echo ""
echo "[Xong] BE: localhost:8000  FE: localhost:5173"
echo "Nhan Ctrl+C de dung ca hai."

# Doi tat ca cac tien trinh con
wait $BE_PID $FE_PID
