# Áp dụng bản cập nhật kiểu ĐỔI CHỖ có HOÀN TÁC (PyFlow Studio, Windows PowerShell 5.1).
#
# Gọi bởi updater.bat mà routers/system.py ghi ra cạnh thư mục cài đặt. Thay cho cách
# cũ "Expand-Archive -Force đè lên thư mục đang cài": file của bản cũ nằm lại lẫn với
# bản mới (v2.3.155 treo trên máy khách vì thế), và hỏng giữa chừng là không còn bản
# nào chạy được.
#
# Các bước:
#   1. Giải nén update.zip vào _update_stage\ (bản cũ chưa bị đụng tới).
#   2. Chuyển backend\ frontend\ runtime\ cũ vào _update_backup\, đưa bản mới vào chỗ.
#   3. Mang thư mục DỮ LIỆU (backend\_internal\data) từ bản cũ sang bản mới.
#   4. Khởi động, chờ /health. Không lên trong $HealthTimeoutSec giây → tắt, trả mọi
#      thứ về như cũ (kể cả dữ liệu), chạy lại bản cũ, ghi data\.update_failed để
#      giao diện báo "đã quay về bản cũ".
#
# Mã thoát: 0 = thành công, 10 = thất bại ĐÃ XỬ LÝ (bản cũ đã chạy lại). Mã khác =
# script không chạy được (VD chính sách PowerShell) → updater.bat dùng cách cũ.
#
# ⚠ KHÔNG BAO GIỜ Remove-Item một thư mục còn chứa dữ liệu khách — mọi chỗ xoá đều
# kiểm điều này trước.
param(
    [Parameter(Mandatory = $true)][string]$Install,
    [Parameter(Mandatory = $true)][string]$Zip,
    [string]$HealthUrl = "http://127.0.0.1:8000/health",
    [int]$HealthTimeoutSec = 120,
    [int]$WaitOldExitSec = 3
)

$ErrorActionPreference = "Stop"
$Install = (Resolve-Path -LiteralPath $Install).Path
$stage = Join-Path $Install "_update_stage"
$backup = Join-Path $Install "_update_backup"
$parts = @("backend", "frontend", "runtime")
$dataRel = "backend\_internal\data"
$logFile = Join-Path $Install "update.log"

function Log([string]$msg) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Out-File -FilePath $logFile -Append -Encoding utf8
}

function Has-Data([string]$root) { Test-Path -LiteralPath (Join-Path $root $dataRel) }

function Remove-Safe([string]$path) {
    # Xoá thư mục tạm — từ chối nếu bên trong còn dữ liệu khách.
    if (-not (Test-Path -LiteralPath $path)) { return }
    if ((Test-Path -LiteralPath (Join-Path $path $dataRel)) -or (Test-Path -LiteralPath (Join-Path $path "_internal\data"))) {
        Log "GIU LAI $path vi con thu muc du lieu ben trong"
        return
    }
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
}

function Stop-App {
    # Mọi tiến trình chạy từ thư mục backend (pyflow-backend.exe, python của venv project).
    $prefix = (Join-Path $Install "backend") + "\"
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

function Start-App {
    # Không được ném lỗi: được gọi cả trong nhánh xử lý lỗi (ném ở đó = thoát mã 1 =
    # updater.bat tưởng script không chạy được và dùng cách cũ).
    try {
        $vbs = Join-Path $Install "backend\start.vbs"
        if (Test-Path -LiteralPath $vbs) {
            Start-Process -FilePath "wscript.exe" -ArgumentList "`"$vbs`"" -WorkingDirectory (Join-Path $Install "backend")
        } else {
            Log "KHONG THAY $vbs de khoi dong"
        }
    } catch { Log "LOI khoi dong: $_" }
}

function Wait-Healthy {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 5
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Mark-Failed([string]$reason) {
    try {
        $dataDir = Join-Path $Install $dataRel
        if (Test-Path -LiteralPath $dataDir) {
            $reason | Out-File -FilePath (Join-Path $dataDir ".update_failed") -Encoding utf8
        }
    } catch { Log "LOI ghi .update_failed: $_" }
}

function Restore {
    # Trả bản cũ về chỗ. Dữ liệu đi TRƯỚC: chỉ xoá bản mới khi nó không còn giữ dữ liệu.
    $curData = Join-Path $Install $dataRel
    $bakData = Join-Path $backup $dataRel
    if ((Test-Path -LiteralPath $curData) -and -not (Test-Path -LiteralPath $bakData) -and
        (Test-Path -LiteralPath (Join-Path $backup "backend\_internal"))) {
        Move-Item -LiteralPath $curData -Destination $bakData
    }
    foreach ($p in $parts) {
        $b = Join-Path $backup $p
        $i = Join-Path $Install $p
        if (-not (Test-Path -LiteralPath $b)) {
            # Phần do bản MỚI mang thêm (VD runtime\ lần đầu có): gỡ đi để bản cũ chạy
            # đúng như trước. backend\ luôn có ở cả 2 bản nên không rơi vào nhánh này.
            if ($p -ne "backend" -and (Test-Path -LiteralPath $i)) { Remove-Item -LiteralPath $i -Recurse -Force }
            continue
        }
        if (Test-Path -LiteralPath $i) {
            if ($p -eq "backend" -and (Has-Data $Install)) {
                throw "Khong hoan tac duoc: $i van con du lieu - can xu ly tay (xem update.log)"
            }
            Remove-Item -LiteralPath $i -Recurse -Force
        }
        Move-Item -LiteralPath $b -Destination $i
    }
}

# ── 1. Giải nén vào thư mục tạm ────────────────────────────────────────────────
Log "=== Bat dau cap nhat: $Zip"
Start-Sleep -Seconds $WaitOldExitSec          # đợi bản cũ tự thoát
Stop-App
try {
    Remove-Safe $stage
    Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force
    if (-not (Test-Path -LiteralPath (Join-Path $stage "backend\pyflow-backend.exe"))) {
        throw "ban cap nhat thieu backend\pyflow-backend.exe"
    }
} catch {
    Log "LOI giai nen: $_ - giu nguyen ban cu"
    Remove-Safe $stage
    Start-App
    Mark-Failed "extract: $_"
    exit 10
}

# ── 2-3. Đổi chỗ + mang dữ liệu sang ──────────────────────────────────────────
try {
    Remove-Safe $backup
    if (Test-Path -LiteralPath $backup) { throw "_update_backup cu con du lieu - dung lai de khong de len" }
    New-Item -ItemType Directory -Path $backup | Out-Null
    foreach ($p in $parts) {
        $src = Join-Path $Install $p
        if (Test-Path -LiteralPath $src) { Move-Item -LiteralPath $src -Destination (Join-Path $backup $p) }
    }
    foreach ($p in $parts) {
        $s = Join-Path $stage $p
        if (Test-Path -LiteralPath $s) { Move-Item -LiteralPath $s -Destination (Join-Path $Install $p) }
    }
    $newData = Join-Path $Install $dataRel
    if (Test-Path -LiteralPath $newData) {
        # Bản build không được kèm dữ liệu; nếu có thì để riêng, không trộn với dữ liệu khách.
        Move-Item -LiteralPath $newData -Destination ($newData + ".from_zip")
    }
    $oldData = Join-Path $backup $dataRel
    if (Test-Path -LiteralPath $oldData) { Move-Item -LiteralPath $oldData -Destination $newData }
    Get-ChildItem -LiteralPath $stage -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $Install -Force }
    Log "Da doi cho ban moi, dang khoi dong..."
} catch {
    Log "LOI doi cho: $_ - hoan tac"
    try { Restore } catch { Log "LOI hoan tac: $_" }
    Remove-Safe $stage
    Start-App
    Mark-Failed "swap: $_"
    exit 10
}

# ── 4. Khởi động + kiểm /health, không lên thì quay về ─────────────────────────
Start-App
if (Wait-Healthy) {
    Log "Ban moi chay tot - don thu muc tam"
    Remove-Safe $backup
    Remove-Safe $stage
    Remove-Item -LiteralPath $Zip -Force -ErrorAction SilentlyContinue
    exit 0
}

Log "Ban moi KHONG len trong $HealthTimeoutSec s - quay ve ban cu"
Stop-App
Start-Sleep -Seconds 2
try { Restore } catch { Log "LOI hoan tac: $_" }
Remove-Safe $stage
Start-App
Mark-Failed "health: ban moi khong khoi dong duoc trong $HealthTimeoutSec giay"
exit 10
