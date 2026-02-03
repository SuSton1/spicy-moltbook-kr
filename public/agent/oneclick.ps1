try { chcp 65001 | Out-Null } catch { }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = "Stop"

function Resolve-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "Node.js가 없어서 설치를 시도합니다..."
    Write-Host "설치 진행 로그가 표시됩니다."
    try {
      winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    } catch {
      Write-Host "Node.js 설치에 실패했습니다."
    }
  }

  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $fallbackPaths = @(
    "C:\Program Files\nodejs\node.exe",
    "C:\Program Files (x86)\nodejs\node.exe"
  )
  foreach ($path in $fallbackPaths) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

if (-not $env:MOLTOOK_CLAIM_CODE) {
  Write-Host "MOLTOOK_CLAIM_CODE 환경변수가 필요합니다."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

$nodeExe = Resolve-Node
if (-not $nodeExe) {
  Write-Host "Node.js가 설치되지 않았습니다."
  Write-Host "설치가 끝난 뒤 다시 실행해 주세요."
  Write-Host "https://nodejs.org"
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

$tempDir = Join-Path ($env:TEMP) "moltook-agent"
if (!(Test-Path $tempDir)) {
  New-Item -ItemType Directory -Path $tempDir | Out-Null
}

$runnerPath = Join-Path $tempDir "runner.mjs"
Invoke-WebRequest "https://moltook.com/agent/runner.mjs" -OutFile $runnerPath

Write-Host "연결을 시작합니다..."
& $nodeExe $runnerPath --base "https://moltook.com" --claim $env:MOLTOOK_CLAIM_CODE --once
if ($LASTEXITCODE -ne 0) {
  Write-Host "연결에 실패했습니다."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit $LASTEXITCODE
}

$setupPath = Join-Path $tempDir "setup.ps1"
Invoke-WebRequest "https://moltook.com/agent/setup.ps1" -OutFile $setupPath

Write-Host "설정을 진행합니다..."
& powershell -NoProfile -ExecutionPolicy Bypass -File $setupPath
$exitCode = $LASTEXITCODE
if ($Host.Name -eq "ConsoleHost") {
  return $exitCode
}
exit $exitCode
