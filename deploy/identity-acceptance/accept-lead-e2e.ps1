$ErrorActionPreference = "Stop"
$acceptanceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $acceptanceDir ".env.identity-acceptance"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Run start.ps1 before Lead E2E acceptance." }
node (Join-Path $acceptanceDir "validate-env.mjs") $envFile
if ($LASTEXITCODE -ne 0) { throw "Isolated environment validation failed." }

Push-Location $acceptanceDir
try {
  docker compose -p dachuan-identity-acceptance --env-file $envFile --profile lead-e2e config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Lead E2E Compose validation failed." }
  docker compose -p dachuan-identity-acceptance --env-file $envFile --profile lead-e2e up -d --no-build --pull never --wait --wait-timeout 300 lead-mcp lead-llm-mock
  if ($LASTEXITCODE -ne 0) { throw "Lead E2E services failed to become healthy." }
  node (Join-Path $acceptanceDir "provision-lead-e2e.mjs") $envFile "http://127.0.0.1:18081"
  if ($LASTEXITCODE -ne 0) { throw "Lead E2E FastGPT provisioning failed." }
  docker compose -p dachuan-identity-acceptance --env-file $envFile --profile lead-e2e up -d --no-build --pull never --no-deps --force-recreate fastgpt
  if ($LASTEXITCODE -ne 0) { throw "FastGPT Lead assertion configuration reload failed." }
  docker compose -p dachuan-identity-acceptance --env-file $envFile --profile lead-e2e up -d --no-build --pull never --wait --wait-timeout 300 fastgpt lead-mcp lead-llm-mock
  if ($LASTEXITCODE -ne 0) { throw "Lead E2E stack failed to become healthy after reload." }
  docker compose -p dachuan-identity-acceptance --env-file $envFile --profile lead-e2e run --rm --no-deps lead-e2e-runner
  if ($LASTEXITCODE -ne 0) { throw "Lead E2E acceptance failed." }
} finally {
  Pop-Location
}
Write-Output "LEAD_E2E_ISOLATED_STACK=PASS"
