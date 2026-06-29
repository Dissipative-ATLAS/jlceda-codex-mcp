param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [int]$HttpPort = 38425,
  [int]$WsPort = 38426
)

$ErrorActionPreference = "Stop"

$mcpDir = Join-Path $Root "mcp"
$serverPath = Join-Path $mcpDir "server.js"
if (-not (Test-Path $serverPath)) {
  throw "Cannot find MCP server: $serverPath"
}

$existing = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -match [regex]::Escape($serverPath) -or
    ($_.CommandLine -match "server\.js --http-only" -and $_.CommandLine -match [regex]::Escape($mcpDir))
  })

$portOwnerIds = @(Get-NetTCPConnection -LocalPort $HttpPort,$WsPort -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" } |
  Select-Object -ExpandProperty OwningProcess -Unique)

foreach ($ownerId in $portOwnerIds) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue
  if ($owner -and $owner.Name -eq "node.exe" -and $owner.CommandLine -match "server\.js --http-only") {
    $existing += $owner
  }
}

foreach ($process in @($existing | Sort-Object ProcessId -Unique)) {
  Stop-Process -Id $process.ProcessId -Force
}

$portUsers = @(Get-NetTCPConnection -LocalPort $HttpPort,$WsPort -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq "Listen" } |
  Select-Object -ExpandProperty OwningProcess -Unique)

if (@($portUsers).Count -gt 0) {
  $owners = @($portUsers | ForEach-Object {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $_" -ErrorAction SilentlyContinue
    if ($p) { "$($p.ProcessId): $($p.CommandLine)" } else { "$_" }
  })
  throw "Bridge ports are already in use:`n$($owners -join "`n")"
}

Start-Process -FilePath "node" -ArgumentList "server.js --http-only" -WorkingDirectory $mcpDir -WindowStyle Hidden
Start-Sleep -Seconds 1

$health = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$HttpPort/health" -TimeoutSec 5
$health.Content
