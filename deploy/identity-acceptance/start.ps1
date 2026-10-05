param(
  [string]$FastGptSource = ""
)

$ErrorActionPreference = "Stop"
$acceptanceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $acceptanceDir "..\..")).Path
$envFile = Join-Path $acceptanceDir ".env.identity-acceptance"
$template = Join-Path $acceptanceDir ".env.identity-acceptance.example"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is required for isolated acceptance." }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }

if (-not (Test-Path -LiteralPath $envFile)) {
  node (Join-Path $acceptanceDir "prepare-env.mjs") $template $envFile
  if ($LASTEXITCODE -ne 0) { throw "Isolated environment generation failed." }
}
node (Join-Path $acceptanceDir "validate-env.mjs") $envFile
if ($LASTEXITCODE -ne 0) { throw "Isolated environment validation failed." }

& (Join-Path $acceptanceDir "build-fastgpt.ps1") -FastGptSource $FastGptSource
if ($LASTEXITCODE -ne 0) { throw "FastGPT image preparation failed." }

docker build --progress=plain -f (Join-Path $acceptanceDir "Dockerfile.mcp") -t "dachuanpro-crm-erp-mcp:1.2.0-identity-acceptance.1" $repoRoot
if ($LASTEXITCODE -ne 0) { throw "CRM/MCP acceptance image build failed." }
docker build --progress=plain -f (Join-Path $acceptanceDir "Dockerfile.acceptance") -t "dachuanpro-identity-acceptance-runner:1.0.0" $repoRoot
if ($LASTEXITCODE -ne 0) { throw "Identity acceptance runner image build failed." }

Push-Location $acceptanceDir
try {
  docker compose -p dachuan-identity-acceptance --env-file $envFile config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Compose validation failed." }

  # Start only the isolated database dependencies. The migration container is
  # created but deliberately not started until its actual Docker network has
  # been inspected from the host.
  docker compose -p dachuan-identity-acceptance --env-file $envFile up -d --no-build --wait --wait-timeout 300 mysql identity-redis
  if ($LASTEXITCODE -ne 0) { throw "Isolated database dependencies failed to become healthy." }
  docker compose -p dachuan-identity-acceptance --env-file $envFile create --force-recreate db-init
  if ($LASTEXITCODE -ne 0) { throw "Unable to create the isolated migration container." }

  $expectedDataNetwork = "dachuan-identity-acceptance_identity-data"
  $dbInitContainer = (docker compose -p dachuan-identity-acceptance --env-file $envFile ps -q --all db-init).Trim()
  $mysqlContainer = (docker compose -p dachuan-identity-acceptance --env-file $envFile ps -q mysql).Trim()
  if (-not $dbInitContainer -or -not $mysqlContainer) { throw "Isolated database containers are missing." }
  $networkInternal = (docker network inspect $expectedDataNetwork --format '{{.Internal}}').Trim()
  $dbInitNetworks = @(docker inspect $dbInitContainer --format '{{range $key, $value := .NetworkSettings.Networks}}{{println $key}}{{end}}' | Where-Object { $_ })
  $mysqlNetworks = @(docker inspect $mysqlContainer --format '{{range $key, $value := .NetworkSettings.Networks}}{{println $key}}{{end}}' | Where-Object { $_ })
  $dbInitPorts = (docker inspect $dbInitContainer --format '{{json .HostConfig.PortBindings}}').Trim()
  $mysqlPorts = (docker inspect $mysqlContainer --format '{{json .HostConfig.PortBindings}}').Trim()
  if ($networkInternal -ne "true") {
    throw "Refusing migration: the expected database Docker network is not internal."
  }
  if ($dbInitNetworks.Count -ne 1 -or $dbInitNetworks[0] -ne $expectedDataNetwork -or $mysqlNetworks.Count -ne 1 -or $mysqlNetworks[0] -ne $expectedDataNetwork) {
    throw "Refusing migration: database containers are not isolated on the expected internal Docker network."
  }
  if ($dbInitPorts -notin @("null", "{}") -or $mysqlPorts -notin @("null", "{}")) {
    throw "Refusing migration: isolated database containers publish host ports."
  }
  Write-Output "IDENTITY_ACCEPTANCE_DATABASE_NETWORK=VERIFIED"

  docker compose -p dachuan-identity-acceptance --env-file $envFile start db-init
  if ($LASTEXITCODE -ne 0) { throw "Unable to start the isolated migration container." }
  $dbInitExitCode = (docker wait $dbInitContainer).Trim()
  if ($dbInitExitCode -ne "0") { throw "Isolated migration/seed failed with exit code $dbInitExitCode." }
  $dbInitLogs = @(docker logs $dbInitContainer 2>&1)
  [string]::Join("`n", $dbInitLogs) | node (Join-Path $PSScriptRoot "verify-db-init-privilege-log.mjs")
  if ($LASTEXITCODE -ne 0) { throw "Isolated MCP database privilege gates failed." }
  Write-Output "IDENTITY_ACCEPTANCE_DB_INIT_EXIT_CODE=0"
  Write-Output "MCP_ACCEPTANCE_DUAL_DATABASE_PRIVILEGES=PASS"
  Write-Output "MCP_ACCEPTANCE_LEAD_WRITER_PRIVILEGES=PASS"

  docker compose -p dachuan-identity-acceptance --env-file $envFile up -d --no-build --wait --wait-timeout 900
  if ($LASTEXITCODE -ne 0) { throw "Isolated stack failed to become healthy." }
  docker compose -p dachuan-identity-acceptance --env-file $envFile ps
} finally {
  Pop-Location
}
Write-Output "CRM=http://127.0.0.1:18080"
Write-Output "FastGPT=http://127.0.0.1:18081"
Write-Output "MCP=http://127.0.0.1:18080/api/mcp"
Write-Output "Next: create the acceptance FastGPT Agent/API key, update AGENT_GATEWAY_FASTGPT_API_KEY, recreate crm, then run accept.ps1."
