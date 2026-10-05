param(
  [Parameter(Mandatory = $true)]
  [string]$FastGptSource
)

$ErrorActionPreference = "Stop"
$expectedCommit = "a0aec83f2ae444f5783416d17d0d9d12b7c1dc39"
$source = (Resolve-Path -LiteralPath $FastGptSource).Path
$patch = Join-Path $PSScriptRoot "0001-dachuan-trusted-mcp-identity.patch"
$actualCommit = (git -C $source rev-parse HEAD).Trim()
if ($actualCommit -ne $expectedCommit) {
  throw "FastGPT source commit must be $expectedCommit, got $actualCommit"
}
git -C $source apply --check $patch
if ($LASTEXITCODE -ne 0) { throw "FastGPT identity patch preflight failed" }
git -C $source apply $patch
if ($LASTEXITCODE -ne 0) { throw "FastGPT identity patch apply failed" }
Write-Output "FastGPT v4.15.1 trusted identity and Lead SERVICE assertion patch applied."
