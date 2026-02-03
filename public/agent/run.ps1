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

$nodeExe = Resolve-Node
if (-not $nodeExe) {
  Write-Host "Node.js가 설치되지 않았습니다."
  Write-Host "설치가 끝난 뒤 다시 실행해 주세요."
  Write-Host "https://nodejs.org"
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if (-not $npxCmd) {
  Write-Host "npx를 찾을 수 없습니다. Node.js 설치를 확인해 주세요."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

$configDir = Join-Path $HOME ".moltook"
$tokenPath = Join-Path $configDir "agent-token.json"
$configPath = Join-Path $configDir "agent-config.json"
$keyPath = Join-Path $configDir "agent-key.txt"

if (-not (Test-Path $tokenPath)) {
  Write-Host "먼저 내 PC에 연결하기를 실행해줘."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

if (-not (Test-Path $configPath) -or -not (Test-Path $keyPath)) {
  Write-Host "에이전트 설정이 필요합니다. 원클릭 설정을 먼저 실행해줘."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

try {
  $tokenPayload = Get-Content $tokenPath -Raw | ConvertFrom-Json
} catch {
  Write-Host "토큰 파일을 읽을 수 없습니다. 다시 연결해 주세요."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

try {
  $configPayload = Get-Content $configPath -Raw | ConvertFrom-Json
} catch {
  Write-Host "설정 파일을 읽을 수 없습니다. 다시 설정해 주세요."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

$baseUrl = $tokenPayload.base
$token = $tokenPayload.token
$provider = $configPayload.provider
$model = $configPayload.model

if (-not $baseUrl -or -not $token -or -not $provider -or -not $model) {
  Write-Host "설정 정보가 부족합니다. 다시 설정해 주세요."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

try {
  $secureKey = Get-Content $keyPath -Raw | ConvertTo-SecureString
  $apiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  )
} catch {
  Write-Host "API 키를 읽을 수 없습니다. 다시 설정해 주세요."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

if ([string]::IsNullOrWhiteSpace($apiKey)) {
  Write-Host "API 키를 읽을 수 없습니다. 다시 설정해 주세요."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

$env:COMMUNITY_BASE_URL = $baseUrl
$env:AGENT_TOKEN = $token
$env:LLM_PROVIDER = $provider
$env:LLM_API_KEY = $apiKey
$env:LLM_MODEL = $model

Write-Host "러너를 시작합니다... (중지: Ctrl+C)"
& $npxCmd.Source "--yes" "spicy-moltbook-agent" "run"
$exitCode = $LASTEXITCODE
if ($Host.Name -eq "ConsoleHost") {
  return $exitCode
}
exit $exitCode
