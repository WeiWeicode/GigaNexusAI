# ==============================================================================
# GigaNexusAI - 每日下班專案備份至 NAS 腳本
# 目標 NAS: \\10.10.130.31\docker-folder\code\GigaNexusAI
#
# 備份規則：
# 1. 包含所有各專案之 .env 設定檔。
# 2. 排除 GitHub 個人設定 (移除 github.com remotes 與 .github 目錄)，完整保留公司 GitLab 設定。
# 3. 排除舊專案與參考專案 (old_PortalSolar, pull_portal_solar.py, Elearning_Vue)。
# 4. 排除 node_modules 與編譯產物 (target, dist, .claude 等快取)，兼顧備份速度與 NAS 空間。
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "        GigaNexusAI 專案備份作業 (本地 -> 公司 NAS)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. 設定來源與目標路徑
$SourceDir = (Resolve-Path "$PSScriptRoot\..").Path
$NasDir    = "\\10.10.130.31\docker-folder\code\GigaNexusAI"
$NasBase   = "\\10.10.130.31\docker-folder"

Write-Host "• 來源目錄: $SourceDir" -ForegroundColor White
Write-Host "• NAS 目標: $NasDir" -ForegroundColor White
Write-Host ""

# 2. 檢查 NAS 連線狀態
Write-Host "[1/5] 檢查 NAS 網路共享連線..." -ForegroundColor Yellow
if (-not (Test-Path $NasBase)) {
    Write-Host ""
    Write-Host "❌ 錯誤：無法連線至 NAS 共享路徑 [$NasBase]！" -ForegroundColor Red
    Write-Host "請檢查以下項目：" -ForegroundColor Yellow
    Write-Host "  1. 本機是否已連接公司區域網路或 VPN" -ForegroundColor Yellow
    Write-Host "  2. 檔案總管是否能手動開啟 $NasBase" -ForegroundColor Yellow
    Write-Host "  3. 是否需要輸入 NAS 存取帳號密碼" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "請按 Enter 鍵結束"
    exit 1
}

if (-not (Test-Path $NasDir)) {
    Write-Host "  NAS 專案資料夾尚不存在，建立中..." -ForegroundColor Gray
    try {
        New-Item -ItemType Directory -Path $NasDir -Force | Out-Null
        Write-Host "  已建立 NAS 專案目錄: $NasDir" -ForegroundColor Green
    } catch {
        Write-Host "❌ 建立 NAS 目錄失敗: $_" -ForegroundColor Red
        Read-Host "請按 Enter 鍵結束"
        exit 1
    }
}
Write-Host "  NAS 連線正常。" -ForegroundColor Green
Write-Host ""

# 3. 設定排除清單
# 排除目錄 (不分大小寫)
$ExcludeDirs = @(
    "node_modules",
    "target",            # Rust 編譯輸出
    "dist",              # 前端打包輸出
    "dist-arch",         # NexusPlan 架構圖產物
    "iisnode",           # IIS node 暫存
    "old_PortalSolar",   # 舊版 Solar 專案
    "Elearning_Vue",     # 舊版/參考用 E-Learning 專案
    ".claude",           # Claude AI 對話與本機暫存
    ".gemini",           # Gemini 快取
    ".system_generated", # IDE 系統快取
    ".turbo",
    ".next",
    ".cache",
    ".vscode",
    ".idea",
    "temp",
    "tmp",
    "`$RECYCLE.BIN",
    "System Volume Information"
)

# 排除檔案 (不分大小寫)
$ExcludeFiles = @(
    "pull_portal_solar.py", # 舊專案拉取腳本
    "*.tgz",                # 暫存 tar 包 (如 lightningcss-musl.tgz 等)
    "*.tar.gz",
    "*.tmp",
    "*.log",
    "desktop.ini",
    "thumbs.db"
)

# 4. 執行高效同步備份 (使用 Windows 內建 Robocopy)
Write-Host "[2/5] 正在同步專案檔案至 NAS (使用多執行緒高速傳輸)..." -ForegroundColor Yellow
Write-Host "  (已排除 node_modules、編譯產物、舊專案，保留所有 .env 與核心代碼)" -ForegroundColor Gray

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

$robocopyArgs = @(
    "`"$SourceDir`"",
    "`"$NasDir`"",
    "/MIR",              # 鏡像同步 (完整同步，清理來源已刪除檔案)
    "/FFT",              # 支援 FAT/網路儲存精確度
    "/MT:8",             # 8 執行緒加速傳輸
    "/R:2",              # 失敗重試 2 次
    "/W:2",              # 重試等待 2 秒
    "/NP",               # 不顯示逐個百分比以提升效能
    "/NDL",              # 不列出目錄名稱以精簡輸出
    "/XD"
) + $ExcludeDirs + @("/XF") + $ExcludeFiles

$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = "robocopy.exe"
$processInfo.Arguments = ($robocopyArgs -join " ")
$processInfo.UseShellExecute = $false
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.StandardOutputEncoding = [System.Text.Encoding]::GetEncoding(950) # 繁中 Big5/CP950 避免亂碼

$proc = [System.Diagnostics.Process]::Start($processInfo)
$procOutput = $proc.StandardOutput.ReadToEnd()
$proc.WaitForExit()
$exitCode = $proc.ExitCode

$stopwatch.Stop()
$elapsedSec = [math]::Round($stopwatch.Elapsed.TotalSeconds, 1)

# Robocopy Exit Code 說明:
# 0 = 無任何檔案異動
# 1 = 已複製 1 個或多個檔案
# 2 = 目標目錄存在額外檔案 (EXTRA)
# 3 = 已複製檔案且有額外檔案
# 4-7 = 輕微警示/屬性異動 (仍算成功)
# >= 8 = 發生嚴重錯誤
if ($exitCode -ge 8) {
    Write-Host "❌ Robocopy 備份過程發生錯誤 (Exit Code: $exitCode)！" -ForegroundColor Red
    Write-Host $procOutput -ForegroundColor Gray
    Read-Host "請按 Enter 鍵結束"
    exit 1
} else {
    Write-Host "  檔案同步完成！耗時: $elapsedSec 秒 (狀態碼: $exitCode)" -ForegroundColor Green
}
Write-Host ""

# 5. Git 設定檔清洗：移除 GitHub 個人 remote，保留並確認 GitLab 設定
Write-Host "[3/5] 檢查並處理 Git 設定檔 (清除 GitHub，保留公司 GitLab)..." -ForegroundColor Yellow

function Clean-GitConfigText ([string]$text) {
    $lines = $text -split "\r?\n"
    $sections = [System.Collections.Generic.List[PSCustomObject]]::new()
    $currentSection = [PSCustomObject]@{
        Header = ""
        Lines = [System.Collections.Generic.List[string]]::new()
    }
    
    foreach ($line in $lines) {
        if ($line -match '^\s*\[(.*)\]\s*$') {
            if ($currentSection.Header -ne "" -or $currentSection.Lines.Count -gt 0) {
                $sections.Add($currentSection)
            }
            $currentSection = [PSCustomObject]@{
                Header = $matches[1].Trim()
                Lines = [System.Collections.Generic.List[string]]::new()
            }
        } else {
            $currentSection.Lines.Add($line)
        }
    }
    if ($currentSection.Header -ne "" -or $currentSection.Lines.Count -gt 0) {
        $sections.Add($currentSection)
    }

    # 提取 gitlab url
    $gitlabUrl = $null
    foreach ($sec in $sections) {
        if ($sec.Header -match '^remote\s+"gitlab"$') {
            foreach ($l in $sec.Lines) {
                if ($l -match '^\s*url\s*=\s*(.+)$') {
                    $gitlabUrl = $matches[1].Trim()
                    break
                }
            }
        }
    }

    # 過濾包含 github.com 的 remote 區塊
    $filtered = [System.Collections.Generic.List[PSCustomObject]]::new()
    $hasOrigin = $false
    foreach ($sec in $sections) {
        $isGitHubRemote = $false
        if ($sec.Header -match '^remote\s+"') {
            foreach ($l in $sec.Lines) {
                if ($l -match 'github\.com') {
                    $isGitHubRemote = $true
                    break
                }
            }
        }
        if (-not $isGitHubRemote) {
            if ($sec.Header -match '^remote\s+"origin"$') {
                $hasOrigin = $true
            }
            $filtered.Add($sec)
        }
    }

    # 若原 origin 指向 github 已被移除，而有 gitlab，則以 gitlab 替補建立 origin
    if (-not $hasOrigin -and $gitlabUrl) {
        $newOrigin = [PSCustomObject]@{
            Header = 'remote "origin"'
            Lines = [System.Collections.Generic.List[string]]::new()
        }
        $newOrigin.Lines.Add("`turl = $gitlabUrl")
        $newOrigin.Lines.Add("`tfetch = +refs/heads/*:refs/remotes/origin/*")
        $filtered.Add($newOrigin)
    }

    # 重組內容
    $sb = [System.Text.StringBuilder]::new()
    foreach ($sec in $filtered) {
        if ($sec.Header -ne "") {
            $sb.AppendLine("[$($sec.Header)]") | Out-Null
        }
        foreach ($l in $sec.Lines) {
            if ($l.Trim() -ne "" -or $sec.Header -eq "") {
                $sb.AppendLine($l) | Out-Null
            }
        }
    }
    return $sb.ToString().Trim()
}

$gitConfigs = Get-ChildItem -Path $NasDir -Filter "config" -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.DirectoryName -like "*\.git" }

$cleanedCount = 0
foreach ($cfg in $gitConfigs) {
    try {
        $rawText = [System.IO.File]::ReadAllText($cfg.FullName, [System.Text.Encoding]::UTF8)
        if ($rawText -match "github\.com") {
            $sanitized = Clean-GitConfigText -text $rawText
            [System.IO.File]::WriteAllText($cfg.FullName, $sanitized, [System.Text.Encoding]::UTF8)
            $cleanedCount++
            $relPath = $cfg.FullName.Substring($NasDir.Length).TrimStart("\")
            Write-Host "  [Git清洗] 已清除 GitHub 設定並保留/設為 GitLab: $relPath" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "  ⚠️ 處理 Git 設定檔異常 ($($cfg.FullName)): $_" -ForegroundColor Yellow
    }
}

# 移除 NAS 上的 .github 資料夾 (若有)
$githubDirs = Get-ChildItem -Path $NasDir -Directory -Filter ".github" -Recurse -Force -ErrorAction SilentlyContinue
foreach ($gDir in $githubDirs) {
    try {
        Remove-Item -Path $gDir.FullName -Recurse -Force
        Write-Host "  [移除] .github 目錄: $($gDir.FullName)" -ForegroundColor Cyan
    } catch {}
}

Write-Host "  Git 設定處理完畢 (共清洗 $cleanedCount 個儲存庫的 GitHub 設定，全部保留 GitLab)。" -ForegroundColor Green
Write-Host ""

# 6. 驗證所有 .env 檔案備份完整性
Write-Host "[4/5] 驗證環境變數檔案 (.env) 備份完整性..." -ForegroundColor Yellow

$sourceEnvFiles = Get-ChildItem -Path $SourceDir -Filter "*.env*" -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object {
        $_.FullName -notmatch '\\node_modules\\' -and
        $_.FullName -notmatch '\\old_PortalSolar\\' -and
        $_.FullName -notmatch '\\Elearning_Vue\\' -and
        $_.FullName -notmatch '\\\.claude\\' -and
        $_.Extension -ne ".swp"
    }

$envOkCount = 0
foreach ($envFile in $sourceEnvFiles) {
    $rel = $envFile.FullName.Substring($SourceDir.Length).TrimStart("\")
    $nasEnvTarget = Join-Path $NasDir $rel

    if (Test-Path $nasEnvTarget) {
        $envOkCount++
        Write-Host "  [OK] $rel" -ForegroundColor Green
    } else {
        # 若鏡像同步漏掉，強制補抄
        $destParent = Split-Path $nasEnvTarget -Parent
        if (-not (Test-Path $destParent)) {
            New-Item -ItemType Directory -Path $destParent -Force | Out-Null
        }
        Copy-Item -Path $envFile.FullName -Destination $nasEnvTarget -Force
        $envOkCount++
        Write-Host "  [補抄] $rel" -ForegroundColor Yellow
    }
}
Write-Host "  已確認 $envOkCount 個 .env 相關設定檔完整備份至 NAS。" -ForegroundColor Green
Write-Host ""

# 7. 完成總結
Write-Host "[5/5] 備份驗證與完成！" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "🎉 GigaNexusAI 專案備份成功！" -ForegroundColor Green
Write-Host "• 備份完成時間: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor White
Write-Host "• 總耗時: $elapsedSec 秒" -ForegroundColor White
Write-Host "• NAS 儲存位置: $NasDir" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "💡 同仁可至該 NAS 目錄執行 [從NAS拉取專案.bat] 一鍵取得專案！" -ForegroundColor Gray
Write-Host ""

if ($Host.Name -eq "ConsoleHost") {
    Write-Host "請按任意鍵關閉視窗..." -NoNewline -ForegroundColor Gray
    [Console]::ReadKey($true) | Out-Null
}
