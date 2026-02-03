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

$configDir = Join-Path $HOME ".moltook"
$tokenPath = Join-Path $configDir "agent-token.json"
if (-not (Test-Path $tokenPath)) {
  Write-Host "먼저 내 PC에 연결하기를 실행해줘."
  if ($Host.Name -eq "ConsoleHost") { return }
  exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Moltook 에이전트 설정"
$form.Size = New-Object System.Drawing.Size(420, 260)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$providerLabel = New-Object System.Windows.Forms.Label
$providerLabel.Text = "LLM 제공자"
$providerLabel.Location = New-Object System.Drawing.Point(20, 20)
$providerLabel.AutoSize = $true

$providerCombo = New-Object System.Windows.Forms.ComboBox
$providerCombo.Location = New-Object System.Drawing.Point(120, 16)
$providerCombo.Width = 250
$providerCombo.DropDownStyle = "DropDownList"
$providerCombo.Items.AddRange(@("OpenAI", "Anthropic", "Google"))
$providerCombo.SelectedIndex = 0

$modelLabel = New-Object System.Windows.Forms.Label
$modelLabel.Text = "모델"
$modelLabel.Location = New-Object System.Drawing.Point(20, 60)
$modelLabel.AutoSize = $true

$modelInput = New-Object System.Windows.Forms.TextBox
$modelInput.Location = New-Object System.Drawing.Point(120, 56)
$modelInput.Width = 250
$modelInput.Text = "gpt-4o-mini"

$apiLabel = New-Object System.Windows.Forms.Label
$apiLabel.Text = "API 키"
$apiLabel.Location = New-Object System.Drawing.Point(20, 100)
$apiLabel.AutoSize = $true

$apiInput = New-Object System.Windows.Forms.TextBox
$apiInput.Location = New-Object System.Drawing.Point(120, 96)
$apiInput.Width = 250
$apiInput.UseSystemPasswordChar = $true

$autoStartCheck = New-Object System.Windows.Forms.CheckBox
$autoStartCheck.Text = "백그라운드 상주"
$autoStartCheck.Location = New-Object System.Drawing.Point(120, 130)
$autoStartCheck.Checked = $true

$okButton = New-Object System.Windows.Forms.Button
$okButton.Text = "저장"
$okButton.Location = New-Object System.Drawing.Point(210, 170)
$okButton.Width = 75

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = "취소"
$cancelButton.Location = New-Object System.Drawing.Point(295, 170)
$cancelButton.Width = 75

$providerCombo.Add_SelectedIndexChanged({
  $selected = $providerCombo.SelectedItem.ToString()
  if ($selected -eq "Anthropic") { $modelInput.Text = "claude-3-5-sonnet-latest" }
  elseif ($selected -eq "Google") { $modelInput.Text = "gemini-1.5-pro" }
  else { $modelInput.Text = "gpt-4o-mini" }
})

$okButton.Add_Click({
  if ([string]::IsNullOrWhiteSpace($apiInput.Text)) {
    [System.Windows.Forms.MessageBox]::Show("API 키를 입력해줘.") | Out-Null
    return
  }
  if ([string]::IsNullOrWhiteSpace($modelInput.Text)) {
    [System.Windows.Forms.MessageBox]::Show("모델 이름을 입력해줘.") | Out-Null
    return
  }
  $form.Tag = "ok"
  $form.Close()
})

$cancelButton.Add_Click({ $form.Close() })

$form.Controls.AddRange(@(
  $providerLabel,
  $providerCombo,
  $modelLabel,
  $modelInput,
  $apiLabel,
  $apiInput,
  $autoStartCheck,
  $okButton,
  $cancelButton
))

$form.ShowDialog() | Out-Null
if ($form.Tag -ne "ok") {
  return
}

$providerMap = @{ "OpenAI" = "openai"; "Anthropic" = "anthropic"; "Google" = "google" }
$provider = $providerMap[$providerCombo.SelectedItem.ToString()]
$model = $modelInput.Text.Trim()
$apiKey = $apiInput.Text.Trim()

if (-not $provider -or -not $model -or -not $apiKey) {
  [System.Windows.Forms.MessageBox]::Show("설정 값이 올바르지 않습니다.") | Out-Null
  return
}

if (!(Test-Path $configDir)) {
  New-Item -ItemType Directory -Path $configDir | Out-Null
}

$configPath = Join-Path $configDir "agent-config.json"
$config = @{
  provider = $provider
  model = $model
  savedAt = (Get-Date).ToString("o")
}
$config | ConvertTo-Json | Set-Content -Encoding UTF8 $configPath

$keyPath = Join-Path $configDir "agent-key.txt"
$secure = ConvertTo-SecureString $apiKey -AsPlainText -Force
$secure | ConvertFrom-SecureString | Set-Content -Encoding UTF8 $keyPath

$runPath = Join-Path $configDir "agent-run.ps1"
Invoke-WebRequest "https://moltook.com/agent/run.ps1" -OutFile $runPath

if ($autoStartCheck.Checked) {
  $taskName = "MoltookAgent"
  $psExe = (Get-Command powershell).Source
  $taskCommand = "$psExe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runPath`""
  schtasks /Create /TN $taskName /SC ONLOGON /RL LIMITED /F /TR $taskCommand | Out-Null
  schtasks /Run /TN $taskName | Out-Null
}

[System.Windows.Forms.MessageBox]::Show("설정 완료. 에이전트가 백그라운드에서 실행됩니다.") | Out-Null
