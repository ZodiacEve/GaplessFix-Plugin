param(
    [string]$BetterNCMProfile = $(if ($env:BETTERNCM_PROFILE) { $env:BETTERNCM_PROFILE } else { 'C:\betterncm' })
)

$ErrorActionPreference = 'Stop'
$profileDir = [IO.Path]::GetFullPath($BetterNCMProfile)
if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) {
    throw '找不到 BetterNCM 数据目录。请先安装 BetterNCM，或用 -BetterNCMProfile 指定目录。'
}
if (Get-Process -Name cloudmusic -ErrorAction SilentlyContinue) {
    throw '请先退出网易云音乐（包括托盘图标），再运行脚本。'
}

$files = @('manifest.json', 'main.js', 'README.md', 'LICENSE')
foreach ($name in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) {
        throw "缺少文件：$name。请完整解压后再安装。"
    }
}
$sourceManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($sourceManifest.slug -ne 'gapless-fix') { throw '插件清单不匹配。' }

$pluginsDir = Join-Path $profileDir 'plugins_dev'
$target = [IO.Path]::GetFullPath((Join-Path $pluginsDir 'GaplessFix'))
if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -eq $target.TrimEnd('\')) {
    Write-Output '插件已经在安装目录里，重新打开网易云即可。'
    return
}
if (Test-Path -LiteralPath $target) {
    $manifestPath = Join-Path $target 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw '目标目录不是 GaplessFix，未覆盖。' }
    $installed = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($installed.slug -ne 'gapless-fix') { throw '目标目录属于其他插件，未覆盖。' }
    $backupRoot = Join-Path $profileDir 'plugins_backup'
    $backup = [IO.Path]::GetFullPath((Join-Path $backupRoot ('GaplessFix-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))))
    if ([IO.Path]::GetDirectoryName($target) -ne [IO.Path]::GetFullPath($pluginsDir) -or
        [IO.Path]::GetDirectoryName($backup) -ne [IO.Path]::GetFullPath($backupRoot)) { throw '备份路径不正确。' }
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Move-Item -LiteralPath $target -Destination $backup
    Write-Output "旧版已备份到：$backup"
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $target }
Write-Output "已安装到：$target"
Write-Output '重新打开网易云即可使用。'
