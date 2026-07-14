Set WshShell = CreateObject("WScript.Shell")
' Chạy file start.bat ở chế độ ẩn hoàn toàn (0 = Hidden)
WshShell.Run chr(34) & "start.bat" & Chr(34), 0
Set WshShell = Nothing
