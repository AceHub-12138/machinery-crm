$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'environment.cjs'
Write-Host '将停止并清理以下本机验收资源：'
& node $runner list
if ($LASTEXITCODE -ne 0) { throw '无法核实验收资源，已停止。' }
if ((Read-Host '输入 y 确认清理') -cne 'y') { Write-Host '已取消。'; return }
& node $runner stop
if ($LASTEXITCODE -ne 0) { throw '清理未完成，请保留窗口检查。' }
Write-Host '验收环境已清理。'
