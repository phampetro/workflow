' PyFlow Studio - Khoi dong (Release)
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set ws = CreateObject("WScript.Shell")

' BAT CHE DO BAN QUYEN (License Enforce = 1)
Set env = ws.Environment("Process")
env("PYFLOW_LICENSE_ENFORCE") = "1"

' Dong port 8000 neu dang mo
ws.Run "powershell -Command ""Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }""", 0, True
WScript.Sleep 1000

backendExe = scriptDir & "\backend\pyflow-backend.exe"

If Not fso.FileExists(backendExe) Then
    MsgBox "Chưa tìm thấy file thực thi Backend.", 16, "Lỗi Khởi Động"
    WScript.Quit 1
End If

' ── Kiem tra Chromium rieng cua Playwright; neu chua co thi cai (mot lan) ──
' Chromium rieng giup automation tach khoi Chrome dang mo giao dien PyFlow,
' tranh tranh GPU lam "den" tab ung dung.
localAppData = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%")
pwDir = localAppData & "\ms-playwright"
chromiumFound = False
If fso.FolderExists(pwDir) Then
    For Each f In fso.GetFolder(pwDir).SubFolders
        If LCase(Left(f.Name, 9)) = "chromium-" Then
            If fso.FileExists(f.Path & "\chrome-win64\chrome.exe") Then
                chromiumFound = True
            End If
        End If
    Next
End If

If Not chromiumFound Then
    q = Chr(34)
    ' Mo console cai dat (hien tien trinh tai), doi cai xong roi moi chay tiep
    ws.CurrentDirectory = scriptDir & "\backend"
    ws.Run "cmd /c " & q & q & backendExe & q & " install-browser" & q, 1, True
End If

' Khoi dong Backend
ws.CurrentDirectory = scriptDir & "\backend"
ws.Run """" & backendExe & """", 0, False

WScript.Sleep 3000

' Mo trinh duyet
ws.Run "http://localhost:8000", 1, False
