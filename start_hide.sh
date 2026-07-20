#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: Dung AppleScript de chay ngam va giau hoan toan Terminal
    osascript -e "do shell script \"cd \\\"$ROOT\\\" && nohup ./start.sh > /dev/null 2>&1 &\""
else
    # Linux: Dung nohup binh thuong
    nohup ./start.sh > /dev/null 2>&1 &
fi
