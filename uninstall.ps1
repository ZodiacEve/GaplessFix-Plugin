param(
    [string]$BetterNCMProfile = $(if ($env:BETTERNCM_PROFILE) { $env:BETTERNCM_PROFILE } else { 'C:\betterncm' })
)

$ErrorActionPreference = 'Stop'
$profileDir = [IO.Path]::GetFullPath($BetterNCMProfile)
$pluginsDir = Join-Path $profileDir 'plugins_dev'
$target = [IO.Path]::GetFullPath((Join-Path $pluginsDir 'GaplessFix'))
if (-not (Test-Path -LiteralPath $target)) { Write-Output '没有找到已安装的 GaplessFix。'; return }
if (Get-Process -Name cloudmusic -ErrorAction SilentlyContinue) {
    throw '请先退出网易云音乐（包括托盘图标），再运行脚本。'
}
$manifestPath = Join-Path $target 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw '目标目录不是 GaplessFix，未移动。' }
$installed = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($installed.slug -ne 'gapless-fix') { throw '目标目录属于其他插件，未移动。' }

$backupRoot = Join-Path $profileDir 'plugins_backup'
$backup = [IO.Path]::GetFullPath((Join-Path $backupRoot ('GaplessFix-uninstalled-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))))
if ([IO.Path]::GetDirectoryName($target) -ne [IO.Path]::GetFullPath($pluginsDir) -or
    [IO.Path]::GetDirectoryName($backup) -ne [IO.Path]::GetFullPath($backupRoot)) { throw '备份路径不正确。' }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Move-Item -LiteralPath $target -Destination $backup
Write-Output "已卸载，插件备份保留在：$backup"
Write-Output '重新打开网易云即可恢复原生播放。'
