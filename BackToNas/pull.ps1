# ==============================================================================
# GigaNexusAI - 同仁從 NAS 拉取專案腳本
# 來源 NAS: \\10.10.130.31\docker-folder\code\GigaNexusAI
#
# 功能：
# 1. 互動式詢問同仁欲拉取至本機的目標目錄 (支援直接按 Enter 使用建議預設值)。
# 2. 自動檢查 NAS 網路連線與目標磁碟狀態。
# 3. 使用多執行緒高速複製，完整同步程式碼與所有 .env 環境設定。
# 4. Git 來源已設為公司 GitLab (ssh://git@10.10.130.123:2222/...)，不含 GitHub 個人設定。
# 5. 覆蓋保護：目標目錄已有 git 專案時改為「更新模式」，只補本機沒有的檔案與專案，
#    不覆蓋任何已存在的檔案、不動 .git；.env 有差異時列出並詢問，覆蓋前先備份。
#    程式碼的更新一律用 git pull，NAS 只負責第一次建置與 .env。
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
# 用 ProviderPath：UNC 路徑的 .Path 會帶 "Microsoft.PowerShell.Core\FileSystem::" 前綴，robocopy 認不得
$parentDir = (Resolve-Path "$PSScriptRoot\..").ProviderPath
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
}

# 目標目錄或其第一層子目錄已有 .git，代表同仁已拉取過並可能有本機修改 → 更新模式
$existingRepos = @(Get-ChildItem -Path $TargetDir -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { Test-Path (Join-Path $_.FullName ".git") })
if (Test-Path (Join-Path $TargetDir ".git")) { $existingRepos += Get-Item $TargetDir }
$UpdateMode = $existingRepos.Count -gt 0

if ($UpdateMode) {
    Write-Host ""
    Write-Host "⚠️ 目標目錄已有 $($existingRepos.Count) 個 git 專案，將以「更新模式」執行：" -ForegroundColor Yellow
    Write-Host "  • 只補本機沒有的專案與檔案，不覆蓋任何已存在的檔案。" -ForegroundColor White
    Write-Host "  • 不複製、不修改任何 .git 資料夾 (您的分支與提交紀錄不受影響)。" -ForegroundColor White
    Write-Host "  • .env 與 NAS 版本不同時，會列出並另外詢問是否更新 (覆蓋前自動備份)。" -ForegroundColor White
    Write-Host "  • 程式碼請改用 git pull 從 GitLab 更新，不要靠 NAS 拉取。" -ForegroundColor White
    Write-Host "確定要繼續進行嗎？(Y/N): " -NoNewline -ForegroundColor Yellow
    $confirm = Read-Host
    if ($confirm.Trim().ToUpper() -ne "Y") {
        Write-Host "操作已取消。" -ForegroundColor Gray
        exit 0
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

# 執行一次 Robocopy；Exit Code >= 8 代表失敗，直接結束
function Invoke-Robocopy([string]$Src, [string]$Dst, [string[]]$Extra = @()) {
    # 結尾的反斜線會吃掉引號 (例: "D:\")，先去掉；磁碟根目錄改寫成 D:\.
    $Src = $Src.TrimEnd('\'); if ($Src -match '^[A-Za-z]:$') { $Src += '\.' }
    $Dst = $Dst.TrimEnd('\'); if ($Dst -match '^[A-Za-z]:$') { $Dst += '\.' }

    $robocopyArgs = @(
        "`"$Src`"",
        "`"$Dst`"",
        "/E",                # 遞迴複製所有子目錄 (含空目錄)
        "/FFT",              # 網路檔案系統時間差相容
        "/MT:8",             # 8 執行緒高速傳輸
        "/R:2",              # 失敗重試 2 次
        "/W:2",              # 重試間隔 2 秒
        "/NP",               # 隱藏逐筆百分比以提升效能
        "/NDL"               # 隱藏目錄列表以保持視窗整潔
    ) + $Extra

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

    if ($proc.ExitCode -ge 8) {
        Write-Host "❌ Robocopy 拉取過程發生錯誤 (Exit Code: $($proc.ExitCode))！" -ForegroundColor Red
        Write-Host $procOutput -ForegroundColor Gray
        Read-Host "請按 Enter 鍵結束"
        exit 1
    }
    return $proc.ExitCode
}

# 列出 .env 類檔案 (排除 node_modules、.git 與本工具產生的備份)
function Get-EnvFiles([string]$Root) {
    Get-ChildItem -Path $Root -Filter "*.env*" -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(node_modules|\.git)\\' -and $_.Extension -ne ".swp" -and $_.Name -notmatch '\.bak-\d{14}$' }
}

if (-not $UpdateMode) {
    # 第一次拉取：完整複製 (含 .git 與 .env)
    $exitCode = Invoke-Robocopy $NasSource $TargetDir
} else {
    # 更新模式 (a)：本機沒有的整個專案資料夾 → 完整複製 (含 .git)
    $exitCode = 0
    $newDirs = Get-ChildItem -Path $NasSource -Directory -Force |
        Where-Object { -not (Test-Path (Join-Path $TargetDir $_.Name)) }
    foreach ($dir in $newDirs) {
        Write-Host "  新專案: $($dir.Name)" -ForegroundColor Cyan
        $exitCode = [math]::Max($exitCode, (Invoke-Robocopy $dir.FullName (Join-Path $TargetDir $dir.Name)))
    }

    # 更新模式 (b)：其餘只補本機沒有的檔案；/XC /XN /XO 排除所有已存在的檔案，/XD .git 不碰版本庫
    $exitCode = [math]::Max($exitCode, (Invoke-Robocopy $NasSource $TargetDir @("/XC", "/XN", "/XO", "/XD", ".git")))

    # 更新模式 (c)：.env 內容與 NAS 不同 → 列出並詢問，覆蓋前備份本機檔
    $nasRoot = (Get-Item -LiteralPath $NasSource).FullName.TrimEnd('\')
    $changedEnv = @()
    foreach ($nasEnv in Get-EnvFiles $NasSource) {
        $rel = $nasEnv.FullName.Substring($nasRoot.Length).TrimStart('\')
        $localPath = Join-Path $TargetDir $rel
        if ((Test-Path -LiteralPath $localPath) -and
            (Get-FileHash -LiteralPath $nasEnv.FullName).Hash -ne (Get-FileHash -LiteralPath $localPath).Hash) {
            $changedEnv += [pscustomobject]@{ Rel = $rel; Src = $nasEnv.FullName; Dst = $localPath }
        }
    }

    if ($changedEnv.Count -gt 0) {
        Write-Host ""
        Write-Host "⚠️ 以下 $($changedEnv.Count) 個 .env 檔與 NAS 版本不同：" -ForegroundColor Yellow
        $changedEnv | ForEach-Object { Write-Host "    $($_.Rel)" -ForegroundColor White }
        Write-Host "  若您沒有自行修改過，通常是負責人更新了連線設定，建議更新。" -ForegroundColor Gray
        Write-Host "要以 NAS 版本覆蓋嗎？本機舊檔會備份為 <檔名>.bak-時間戳記 (Y/N): " -NoNewline -ForegroundColor Yellow
        $confirmEnv = Read-Host
        if ($confirmEnv.Trim().ToUpper() -eq "Y") {
            $stamp = Get-Date -Format "yyyyMMddHHmmss"
            foreach ($item in $changedEnv) {
                Copy-Item -LiteralPath $item.Dst -Destination "$($item.Dst).bak-$stamp" -Force
                Copy-Item -LiteralPath $item.Src -Destination $item.Dst -Force
            }
            Write-Host "  已更新 $($changedEnv.Count) 個 .env 檔 (備份後綴 .bak-$stamp)。" -ForegroundColor Green
        } else {
            Write-Host "  已略過，.env 維持本機版本。" -ForegroundColor Gray
        }
    } else {
        Write-Host "  .env 與 NAS 版本一致。" -ForegroundColor Green
    }
}

$stopwatch.Stop()
$elapsedSec = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)

Write-Host "  拉取傳輸完成！耗時: $elapsedSec 秒 (狀態碼: $exitCode)" -ForegroundColor Green
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
Write-Host "   之後程式碼一律用 git pull 更新；不要直接推 develop / main，請開自己的分支並送 Merge Request。" -ForegroundColor White
Write-Host "   第一次設定 (Git 身分、SSH 金鑰) 與分支流程請看：" -ForegroundColor White
Write-Host "     $TargetDir\BackToNas\同仁開發指南.md" -ForegroundColor Gray
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
