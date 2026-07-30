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

' ── Kiem tra Chromium rieng cua Playwright; chua co thi cai (mot lan) ──────
' BAT BUOC: neu thieu, khoi Browser se fallback sang Chrome/Edge he thong —
' tuc la Chrome ca nhan cua may khach, chiu anh huong group policy / tien ich /
' phien ban khac nhau => hay bi "khong dang nhap duoc" va hien thanh vang
' "unsupported command-line flag". Chromium rieng thi may nao cung giong nhau.
localAppData = ws.ExpandEnvironmentStrings("%LOCALAPPDATA%")
pwRoot = scriptDir & "\backend\ms-playwright"
If Not fso.FolderExists(pwRoot) Then
    pwRoot = localAppData & "\ms-playwright"
End If

If Not ChromiumReady(pwRoot) Then
    q = Chr(34)
    ' Mo console cai dat (hien tien trinh tai), doi cai xong roi moi chay tiep
    ws.CurrentDirectory = scriptDir & "\backend"
    ws.Run "cmd /c " & q & q & backendExe & q & " install-browser" & q, 1, True
    If Not ChromiumReady(pwRoot) Then
        ' Popup tu tat sau 20s de khong treo may khi may khong co mang
        ws.Popup "Chua tai duoc Chromium rieng cho automation (can Internet, ~150MB)." & vbCrLf & vbCrLf & _
                 "PyFlow van chay duoc bang Chrome he thong, nhung khoi Browser co the bi chan dang nhap." & vbCrLf & vbCrLf & _
                 "Cach xu ly: mo thu muc backend, chay lenh" & vbCrLf & _
                 "    pyflow-backend.exe install-browser" & vbCrLf & _
                 "hoac copy thu muc ms-playwright tu may da chay duoc vao:" & vbCrLf & _
                 "    " & scriptDir & "\backend\ms-playwright", 20, "PyFlow Studio - Thieu Chromium", 48
    End If
End If

' Khoi dong Backend
ws.CurrentDirectory = scriptDir & "\backend"
ws.Run """" & backendExe & """", 0, False

WScript.Sleep 3000

' Mo trinh duyet
ws.Run "http://localhost:8000", 1, False

' Co chromium-<rev>\chrome-win64\chrome.exe trong pwRoot hay chua?
Function ChromiumReady(pwRoot)
    Dim f
    ChromiumReady = False
    If Not fso.FolderExists(pwRoot) Then Exit Function
    For Each f In fso.GetFolder(pwRoot).SubFolders
        If LCase(Left(f.Name, 9)) = "chromium-" Then
            If fso.FileExists(f.Path & "\chrome-win64\chrome.exe") Then ChromiumReady = True
        End If
    Next
End Function
