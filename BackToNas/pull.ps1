# ==============================================================================
# GigaNexusAI - 同仁從 NAS 拉取專案腳本
# 來源 NAS: \\10.10.130.31\docker-folder\code\GigaNexusAI
#
# 功能：
# 1. 互動式詢問同仁欲拉取至本機的目標目錄 (支援直接按 Enter 使用建議預設值)。
# 2. 自動檢查 NAS 網路連線與目標磁碟狀態。
# 3. 使用多執行緒高速複製，完整同步程式碼與所有 .env 環境設定。
# 4. Git 來源已設為公司 GitLab (ssh://git@10.10.130.123:2222/...)，不含 GitHub 個人設定。
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "        GigaNexusAI 專案拉取工具 (從公司 NAS -> 本機)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 設定 NAS 來源路徑
$defaultNasPath = "\\10.10.130.31\docker-folder\code\GigaNexusAI"
$NasBase        = "\\10.10.130.31\docker-folder"

# 若同仁是直接在 NAS 共享路徑上執行，優先採用腳本所在專案根目錄
$parentDir = (Resolve-Path "$PSScriptRoot\..").Path
$NasSource = if (Test-Path (Join-Path $parentDir "giga-Portal")) {
    $parentDir
} else {
    $defaultNasPath
}

Write-Host "[1/4] 檢查 NAS 來源狀態..." -ForegroundColor Yellow
if (-not (Test-Path $NasSource)) {
    Write-Host ""
    Write-Host "❌ 錯誤：無法連線至 NAS 專案庫 [$NasSource]！" -ForegroundColor Red
    Write-Host "請檢查以下項目：" -ForegroundColor Yellow
    Write-Host "  1. 本機是否已連接公司區域網路或 VPN" -ForegroundColor Yellow
    Write-Host "  2. 檔案總管是否能開啟 $NasBase" -ForegroundColor Yellow
    Write-Host "  3. 是否需要輸入 NAS 存取帳號密碼" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "請按 Enter 鍵結束"
    exit 1
}
Write-Host "  NAS 來源連線正常 (來源: $NasSource)。" -ForegroundColor Green
Write-Host ""

# 2. 詢問同仁目標目錄
Write-Host "[2/4] 設定本機目標目錄..." -ForegroundColor Yellow

# 依本機磁碟建議預設目錄
$defaultTarget = if (Test-Path "D:\") { "D:\GigaNexusAI" } else { "C:\GigaNexusAI" }

Write-Host ""
Write-Host "請輸入欲將專案放置於本機的完整目錄路徑" -ForegroundColor Cyan
Write-Host "(建議格式: D:\GigaNexusAI 或 C:\Projects\GigaNexusAI)" -ForegroundColor Gray
Write-Host "直接按 [Enter] 鍵將採用預設路徑: " -NoNewline -ForegroundColor Yellow
Write-Host "$defaultTarget" -ForegroundColor White
Write-Host "目標路徑: " -NoNewline -ForegroundColor Yellow

$userInput = Read-Host

$TargetDir = if ([string]::IsNullOrWhiteSpace($userInput)) {
    $defaultTarget
} else {
    # 去除前後引號與空白
    $userInput.Trim().Trim('"').Trim("'")
}

# 驗證輸入路徑格式
try {
    $driveName = [System.IO.Path]::GetPathRoot($TargetDir)
    if ([string]::IsNullOrWhiteSpace($driveName) -or (-not (Test-Path $driveName))) {
        Write-Host "❌ 錯誤：指定的磁碟機 [$driveName] 不存在或無效！" -ForegroundColor Red
        Read-Host "請按 Enter 鍵結束"
        exit 1
    }
} catch {
    Write-Host "❌ 錯誤：路徑格式不正確: $_" -ForegroundColor Red
    Read-Host "請按 Enter 鍵結束"
    exit 1
}

Write-Host ""
Write-Host "確認目標目錄: " -NoNewline -ForegroundColor Gray
Write-Host "$TargetDir" -ForegroundColor White

# 檢查目錄是否存在與重複
try {
    $normTarget = (Resolve-Path -Path $TargetDir -ErrorAction SilentlyContinue)
    $normSource = (Resolve-Path -Path $NasSource -ErrorAction SilentlyContinue)
    if ($normTarget -and $normSource -and ($normTarget.Path -eq $normSource.Path)) {
        Write-Host "❌ 錯誤：目標目錄不可與 NAS 來源目錄相同！" -ForegroundColor Red
        Read-Host "請按 Enter 鍵結束"
        exit 1
    }
} catch {}

if (-not (Test-Path $TargetDir)) {
    Write-Host "  目標目錄目前不存在，將為您自動建立。" -ForegroundColor Gray
    try {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
        Write-Host "  已建立目錄: $TargetDir" -ForegroundColor Green
    } catch {
        Write-Host "❌ 無法建立目錄: $_" -ForegroundColor Red
        Read-Host "請按 Enter 鍵結束"
        exit 1
    }
} else {
    $existingFiles = Get-ChildItem -Path $TargetDir -Force
    if ($existingFiles.Count -gt 0) {
        Write-Host ""
        Write-Host "⚠️ 注意：目標目錄 [$TargetDir] 內已有其他檔案/資料夾！" -ForegroundColor Yellow
        Write-Host "拉取作業將會同步覆蓋/更新相同名稱之檔案。" -ForegroundColor Yellow
        Write-Host "確定要繼續進行嗎？(Y/N): " -NoNewline -ForegroundColor Yellow
        $confirm = Read-Host
        if ($confirm.Trim().ToUpper() -ne "Y") {
            Write-Host "操作已取消。" -ForegroundColor Gray
            exit 0
        }
    }
}
Write-Host ""

# 3. 執行高效同步拉取 (Robocopy)
Write-Host "[3/4] 正在從 NAS 拉取專案檔案至本機 (使用多執行緒高速傳輸)..." -ForegroundColor Yellow
Write-Host "  來源: $NasSource" -ForegroundColor Gray
Write-Host "  目的: $TargetDir" -ForegroundColor Gray

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$robocopyArgs = @(
    "`"$NasSource`"",
    "`"$TargetDir`"",
    "/E",                # 遞迴複製所有子目錄 (含空目錄)
    "/FFT",              # 網路檔案系統時間差相容
    "/MT:8",             # 8 執行緒高速傳輸
    "/R:2",              # 失敗重試 2 次
    "/W:2",              # 重試間隔 2 秒
    "/NP",               # 隱藏逐筆百分比以提升效能
    "/NDL"               # 隱藏目錄列表以保持視窗整潔
)

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = "robocopy.exe"
$processInfo.Arguments = ($robocopyArgs -join " ")
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.StandardOutputEncoding = [System.Text.Encoding]::GetEncoding(950)

$proc = [System.Diagnostics.Process]::Start($processInfo)
$procOutput = $proc.StandardOutput.ReadToEnd()
$proc.WaitForExit()
$exitCode = $proc.ExitCode

$stopwatch.Stop()
$elapsedSec = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)

if ($exitCode -ge 8) {
    Write-Host "❌ Robocopy 拉取過程發生錯誤 (Exit Code: $exitCode)！" -ForegroundColor Red
    Write-Host $procOutput -ForegroundColor Gray
    Read-Host "請按 Enter 鍵結束"
    exit 1
} else {
    Write-Host "  拉取傳輸完成！耗時: $elapsedSec 秒 (狀態碼: $exitCode)" -ForegroundColor Green
}
Write-Host ""

# 4. 驗證與同仁指引
Write-Host "[4/4] 檢查拉取成果與後續開發指引..." -ForegroundColor Yellow

$envFiles = Get-ChildItem -Path $TargetDir -Filter "*.env*" -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.Extension -ne ".swp" }

Write-Host "  已成功拉取 $( $envFiles.Count ) 個環境變數 (.env) 相關檔案。" -ForegroundColor Green
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "🎉 GigaNexusAI 專案已成功拉取至本機！" -ForegroundColor Green
Write-Host "• 本機目錄: $TargetDir" -ForegroundColor White
Write-Host "• 總耗時: $elapsedSec 秒" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 【同仁後續操作小提醒】" -ForegroundColor Cyan
Write-Host "1. Git 來源：" -ForegroundColor Yellow
Write-Host "   專案已預先設定為公司內部 GitLab (ssh://git@10.10.130.123:2222/giganexus/...)。" -ForegroundColor White
Write-Host "   可直接使用 git pull / git push。" -ForegroundColor White
Write-Host ""
Write-Host "2. 相依套件安裝：" -ForegroundColor Yellow
Write-Host "   為節省網路傳輸時間，備份未包含龐大之 node_modules 與編譯產物。" -ForegroundColor White
Write-Host "   請進入您負責開發的專案資料夾執行套件安裝，例如：" -ForegroundColor White
Write-Host "     cd `"$TargetDir\giga-Portal\frontend`" ; npm install" -ForegroundColor Gray
Write-Host "     cd `"$TargetDir\giga-api-gateway-bff\bff`" ; npm install" -ForegroundColor Gray
Write-Host "     cd `"$TargetDir\GigaItApp\frontend`" ; npm install" -ForegroundColor Gray
Write-Host ""
Write-Host "3. 全專案架構檢視：" -ForegroundColor Yellow
Write-Host "   雙擊執行 `"$TargetDir\GigaNexusAIPlan\start-architecture.cmd`"" -ForegroundColor White
Write-Host "   或在 GigaNexusAIPlan 目錄執行 npm run arch (http://localhost:5191)。" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if ($Host.Name -eq "ConsoleHost") {
    Write-Host "請按任意鍵關閉視窗..." -NoNewline -ForegroundColor Gray
    [Console]::ReadKey($true) | Out-Null
}
