try { chcp 65001 | Out-Null } catch { }
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = "Stop"

$existing = Get-Command node -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Node.js가 이미 설치되어 있습니다."
  return
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js가 필요합니다. https://nodejs.org 에서 설치해 주세요."
  return
}

Write-Host "Node.js 설치를 시작합니다..."
Write-Host "설치 진행 로그가 표시됩니다."
try {
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
} catch {
  Write-Host "Node.js 설치에 실패했습니다."
  return
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
  Write-Host "Node.js 설치 완료"
  return
}

$fallbackPaths = @(
  "C:\Program Files\nodejs\node.exe",
  "C:\Program Files (x86)\nodejs\node.exe"
)
foreach ($path in $fallbackPaths) {
  if (Test-Path $path) {
    Write-Host "Node.js 설치 완료"
    return
  }
}

Write-Host "Node.js 설치를 확인할 수 없습니다. 다시 실행해 주세요."
