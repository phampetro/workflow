' PyFlow Studio - Khoi dong an
Set fso = CreateObject("Scripting.FileSystemObject")
Set logFile = fso.OpenTextFile("start_hide.log", 8, True)
Set ws = CreateObject("WScript.Shell")

logFile.WriteLine Now & " - Bat dau khoi dong..."

' Dong port 8000, 5173
logFile.WriteLine Now & " - Dong port 8000, 5173..."
ws.Run "powershell -Command ""Get-NetTCPConnection -LocalPort 8000,5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }""", 0, True
WScript.Sleep 1000

' Khoi dong Backend (an) - cd vao thu muc truoc
logFile.WriteLine Now & " - Khoi dong Backend..."
ws.CurrentDirectory = "D:\Local Google Drive\workflow\backend"
ws.Run """D:\Local Google Drive\workflow\backend\.venv\Scripts\python.exe"" -m uvicorn main:app --host 127.0.0.1 --port 8000", 0, False

' Khoi dong Frontend (an)
logFile.WriteLine Now & " - Khoi dong Frontend..."
ws.CurrentDirectory = "D:\Local Google Drive\workflow\frontend"
ws.Run "cmd /c npm run dev", 0, False

' Mo trinh duyet
logFile.WriteLine Now & " - Mo trinh duyet..."
ws.Run "http://localhost:5173", 1, False

logFile.WriteLine Now & " - Hoan tat!"
logFile.WriteLine "================================"

logFile.Close
WScript.Sleep 2000