param(
  [string]$TaskName = "Codex JLCEDA MCP Bridge"
)

$ErrorActionPreference = "Stop"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  [pscustomobject]@{
    removed = $true
    taskName = $TaskName
  } | ConvertTo-Json -Depth 3
} else {
  [pscustomobject]@{
    removed = $false
    taskName = $TaskName
    reason = "Task not found"
  } | ConvertTo-Json -Depth 3
}
