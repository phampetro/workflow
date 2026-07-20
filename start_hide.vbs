' PyFlow Studio - Khoi dong an
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set logFile = fso.OpenTextFile(scriptDir & "\start_hide.log", 8, True)
Set ws = CreateObject("WScript.Shell")

logFile.WriteLine Now & " - Bat dau khoi dong..."

' Kiem tra Python
exitCodePy = ws.Run("cmd /c python --version", 0, True)
If exitCodePy <> 0 Then
    MsgBox "Hệ thống không tìm thấy Python. Vui lòng cài đặt Python (và đánh dấu 'Add to PATH') trước khi chạy PyFlow Studio.", 16, "Lỗi Khởi Động"
    logFile.WriteLine Now & " - LOI: Khong tim thay Python."
    logFile.Close
    WScript.Quit 1
End If

' Kiem tra Node.js
exitCodeNode = ws.Run("cmd /c npm --version", 0, True)
If exitCodeNode <> 0 Then
    MsgBox "Hệ thống không tìm thấy Node.js. Vui lòng cài đặt Node.js trước khi chạy PyFlow Studio.", 16, "Lỗi Khởi Động"
    logFile.WriteLine Now & " - LOI: Khong tim thay Node.js."
    logFile.Close
    WScript.Quit 1
End If

' Dong port 8000, 5173
logFile.WriteLine Now & " - Dong port 8000, 5173..."
ws.Run "powershell -Command ""Get-NetTCPConnection -LocalPort 8000,5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }""", 0, True
WScript.Sleep 1000

backendDir = scriptDir & "\backend"
frontendDir = scriptDir & "\frontend"
pythonExe = backendDir & "\.venv\Scripts\python.exe"

If Not fso.FileExists(pythonExe) Then
    logFile.WriteLine Now & " - LOI: Khong tim thay " & pythonExe & " - hay chay setup.bat truoc."
    logFile.Close
    WScript.Quit 1
End If

' Khoi dong Backend (an)
logFile.WriteLine Now & " - Khoi dong Backend..."
ws.CurrentDirectory = backendDir
ws.Run """" & pythonExe & """ -m uvicorn main:app --host 127.0.0.1 --port 8000", 0, False

' Khoi dong Frontend (an)
logFile.WriteLine Now & " - Khoi dong Frontend..."
ws.CurrentDirectory = frontendDir
ws.Run "cmd /c npm run dev", 0, False

' Mo trinh duyet
logFile.WriteLine Now & " - Mo trinh duyet..."
ws.Run "http://localhost:5173", 1, False

logFile.WriteLine Now & " - Hoan tat!"
logFile.WriteLine "================================"

logFile.Close
WScript.Sleep 2000
