#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "[1/3] Dang cap nhat ma nguon tu Github..."
git pull origin main

echo "[2/3] Doi he thong cu tat hoan toan..."
sleep 2

echo "[3/3] Khoi dong lai he thong (Chay ngam)..."
./start_hide.sh
