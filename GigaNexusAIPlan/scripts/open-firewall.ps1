# 允許區網筆電連線到 NexusPlan（TCP 5190），僅限「網域 / 私人」網路設定檔
# 使用方式：以「系統管理員」身分開啟 PowerShell 後執行
#   powershell -ExecutionPolicy Bypass -File scripts\open-firewall.ps1
param([int]$Port = 5190)

$name = "NexusPlan $Port"
if (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue) {
  Write-Host "防火牆規則「$name」已存在。"
} else {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain,Private | Out-Null
  Write-Host "已新增防火牆規則「$name」（網域 / 私人網路）。"
}
