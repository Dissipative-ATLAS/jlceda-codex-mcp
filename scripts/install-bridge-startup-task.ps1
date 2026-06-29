param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$TaskName = "Codex JLCEDA MCP Bridge"
)

$ErrorActionPreference = "Stop"

$startScript = Join-Path $Root "scripts\start-local-bridge.ps1"
if (-not (Test-Path $startScript)) {
  throw "Cannot find start script: $startScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Start the local Codex JLCEDA MCP HTTP/WebSocket bridge at Windows logon." `
  -Force | Out-Null

[pscustomobject]@{
  installed = $true
  taskName = $TaskName
  startScript = $startScript
} | ConvertTo-Json -Depth 3
