#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if ! command -v python3 &> /dev/null; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        osascript -e 'display dialog "Hệ thống không tìm thấy Python3. Vui lòng cài đặt trước." buttons {"OK"} default button "OK" with icon stop with title "Lỗi khởi động"'
    fi
    exit 1
fi

if ! command -v npm &> /dev/null; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        osascript -e 'display dialog "Hệ thống không tìm thấy Node.js. Vui lòng cài đặt trước." buttons {"OK"} default button "OK" with icon stop with title "Lỗi khởi động"'
    fi
    exit 1
fi

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: Dung AppleScript de chay ngam va giau hoan toan Terminal
    osascript -e "do shell script \"cd \\\"$ROOT\\\" && nohup ./start.sh > /dev/null 2>&1 &\""
else
    # Linux: Dung nohup binh thuong
    nohup ./start.sh > /dev/null 2>&1 &
fi
