param(
  [string]$FastGptSource = ""
)

$ErrorActionPreference = "Stop"
$acceptanceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $acceptanceDir "..\..")).Path
$envFile = Join-Path $acceptanceDir ".env.identity-acceptance"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Missing $envFile; run start.ps1 first." }

$settings = @{}
Get-Content -LiteralPath $envFile | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2] }
}
$expectedCommit = $settings["FASTGPT_SOURCE_COMMIT"]
$image = $settings["FASTGPT_IMAGE"]
if (-not $expectedCommit -or -not $image) { throw "FastGPT commit/image settings are missing." }

if (-not $FastGptSource) {
  $buildRoot = Join-Path $acceptanceDir ".build"
  if (-not (Test-Path -LiteralPath $buildRoot)) { New-Item -ItemType Directory -Path $buildRoot | Out-Null }
  $FastGptSource = Join-Path $buildRoot "fastgpt"
  if (-not (Test-Path -LiteralPath $FastGptSource)) {
    git clone https://github.com/labring/FastGPT.git $FastGptSource
    if ($LASTEXITCODE -ne 0) { throw "FastGPT clone failed." }
    git -C $FastGptSource checkout --detach $expectedCommit
    if ($LASTEXITCODE -ne 0) { throw "FastGPT commit checkout failed." }
  }
}
$FastGptSource = (Resolve-Path -LiteralPath $FastGptSource).Path
$head = (git -C $FastGptSource rev-parse HEAD).Trim()
if ($head -ne $expectedCommit) {
  throw "FastGPT source must be exactly $expectedCommit; current HEAD is $head."
}

$patchFile = Join-Path $repoRoot "deploy\fastgpt\v4.15.1\0001-dachuan-trusted-mcp-identity.patch"
$previousErrorActionPreference = $ErrorActionPreference
try {
  # A failed reverse check is the expected signal for an unpatched checkout.
  # Windows PowerShell otherwise promotes git's stderr to a terminating error
  # before LASTEXITCODE can be inspected.
  $ErrorActionPreference = "Continue"
  git -C $FastGptSource apply --check -R $patchFile 2>$null
  $reverseCheckExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousErrorActionPreference
}
if ($reverseCheckExitCode -ne 0) {
  & (Join-Path $repoRoot "deploy\fastgpt\v4.15.1\apply.ps1") -FastGptSource $FastGptSource
}

$dockerfile = Join-Path $acceptanceDir "Dockerfile.fastgpt"
if (-not (Test-Path -LiteralPath $dockerfile)) { throw "Missing $dockerfile." }

# Dependency installation, lifecycle scripts and identity patch tests all run
# inside Dockerfile.fastgpt with the pinned Corepack pnpm toolchain. Do not add
# host pnpm invocations here: Windows PATH must not influence this build.
docker build --progress=plain --label "org.opencontainers.image.revision=$expectedCommit" --label "dachuan.identity.acceptance=true" --label "dachuan.identity.tests=mcp-context-lead-service-pass" --label "dachuan.pnpm.version=10.33.4" -f $dockerfile -t $image $FastGptSource
if ($LASTEXITCODE -ne 0) { throw "FastGPT custom image build failed." }

docker run --rm --entrypoint node $image -e "const {createCanvas}=require('canvas'); const c=createCanvas(10,10); console.log(c.width,c.height)"
if ($LASTEXITCODE -ne 0) { throw "FastGPT canvas runtime check failed." }

$runtimeGate = @'
set -eu
node_file="$(find /app/node_modules/canvas -name canvas.node -type f -print -quit)"
test -n "$node_file"
echo "CANVAS_NODE=$node_file"
ldd_output="$(ldd "$node_file" 2>&1 || true)"
printf '%s\n' "$ldd_output" | sed -n '/=>/p'
if printf '%s\n' "$ldd_output" | grep -E '=> not found|Error loading shared library .*: No such file or directory'; then
  echo 'CANVAS_LDD=FAIL' >&2
  exit 1
fi
echo 'CANVAS_LDD=PASS_NO_SHARED_LIBRARY_NOT_FOUND'
for tool in python3 make g++; do
  if command -v "$tool" >/dev/null 2>&1; then
    echo "RUNTIME_TOOLCHAIN_GATE=FAIL tool=$tool" >&2
    exit 1
  fi
done
echo 'RUNTIME_TOOLCHAIN_GATE=PASS'
'@
$runtimeGate = $runtimeGate.Replace("`r`n", "`n")
docker run --rm --entrypoint sh $image -c $runtimeGate
if ($LASTEXITCODE -ne 0) { throw "FastGPT canvas shared-library/runtime-toolchain gate failed." }
Write-Output "FASTGPT_IMAGE_READY=$image"
