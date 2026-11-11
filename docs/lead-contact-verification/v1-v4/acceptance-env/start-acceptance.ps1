$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'environment.cjs') start
if ($LASTEXITCODE -ne 0) { throw '启动中止。如已建立验收目录，请运行停止脚本清理本次资源。' }
