param([switch]$PurgeIsolatedData)

$ErrorActionPreference = "Stop"
$acceptanceDir = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$envFile = Join-Path $acceptanceDir ".env.identity-acceptance"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing isolated environment file: $envFile" }
node (Join-Path $acceptanceDir "validate-env.mjs") $envFile
if ($LASTEXITCODE -ne 0) { throw "Refusing rollback: isolated environment validation failed." }
Push-Location $acceptanceDir
try {
  if ($PurgeIsolatedData) {
    $confirmation = Read-Host "Type PURGE-IDENTITY-ACCEPTANCE to delete only this Compose project's volumes"
    if ($confirmation -ne "PURGE-IDENTITY-ACCEPTANCE") { throw "Purge cancelled." }
    docker compose -p dachuan-identity-acceptance --env-file $envFile down --volumes --remove-orphans
  } else {
    docker compose -p dachuan-identity-acceptance --env-file $envFile down --remove-orphans
  }
  if ($LASTEXITCODE -ne 0) { throw "Rollback failed." }
} finally {
  Pop-Location
}
Write-Output $(if ($PurgeIsolatedData) { "Isolated stack and volumes removed." } else { "Isolated stack stopped; volumes retained for recovery." })
