param(
  [Parameter(Mandatory = $true)]
  [string]$FastGptSource
)

$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $FastGptSource).Path
$patch = Join-Path $PSScriptRoot "0001-dachuan-trusted-mcp-identity.patch"
git -C $source apply -R --check $patch
if ($LASTEXITCODE -ne 0) { throw "FastGPT identity patch rollback preflight failed" }
git -C $source apply -R $patch
if ($LASTEXITCODE -ne 0) { throw "FastGPT identity patch rollback failed" }
Write-Output "FastGPT trusted identity patch rolled back."
