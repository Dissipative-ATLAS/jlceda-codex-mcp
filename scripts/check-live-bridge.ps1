param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$ExpectedVersion = "0.3.8",
  [string]$ExpectedUuid = "c0deceda000000000000000000000003",
  [int]$HttpPort = 38425
)

$ErrorActionPreference = "Stop"

function Invoke-BridgeGet {
  param([string]$Path)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$HttpPort$Path" -TimeoutSec 5
    return ($response.Content | ConvertFrom-Json)
  } catch {
    return [pscustomobject]@{
      success = $false
      error = $_.Exception.Message
    }
  }
}

$cacheRoot = Join-Path $env:LOCALAPPDATA "LCEDA-Pro\cache.x64.3\IndexedDB"
$cacheMatches = @()
if (Test-Path $cacheRoot) {
  $patterns = @($ExpectedVersion, $ExpectedUuid, "Codex Live")
  foreach ($pattern in $patterns) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $matches = @(& rg -a -n -F $pattern $cacheRoot 2>$null)
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    $cacheMatches += [pscustomobject]@{
      pattern = $pattern
      count = @($matches).Count
      sample = (@($matches) | Select-Object -First 3)
    }
  }
}

$processes = @(Get-CimInstance Win32_Process -Filter "Name = 'lceda-pro.exe'" -ErrorAction SilentlyContinue |
  Sort-Object CreationDate |
  Select-Object ProcessId,CreationDate,CommandLine)

$health = Invoke-BridgeGet -Path "/health"
$ws = Invoke-BridgeGet -Path "/api/jlceda/ws-status"
$activation = Invoke-BridgeGet -Path "/api/jlceda/activation-log?limit=20"
$probe = Invoke-BridgeGet -Path "/api/jlceda/probe-log?limit=20"
$exports = @()
$exportDir = Join-Path $Root "exports"
if (Test-Path $exportDir) {
  $exports = @(Get-ChildItem $exportDir -Filter "*.json" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 10 Name,Length,LastWriteTime)
}

$versionCacheMatch = $cacheMatches | Where-Object { $_.pattern -eq $ExpectedVersion } | Select-Object -First 1
$menuCacheMatch = $cacheMatches | Where-Object { $_.pattern -eq "Codex Live" } | Select-Object -First 1
$activationRecords = @()
if ($activation -and $activation.records) {
  $activationRecords = @($activation.records)
}
$probeRecords = @()
if ($probe -and $probe.records) {
  $probeRecords = @($probe.records)
}
$activationFromJlc = @($activationRecords | Where-Object {
  [string]$ua = $_.userAgent
  ($ua -match "Electron|JLCEDA|LCEDA|Chrome|Chromium") -and ($ua -notmatch "PowerShell|curl|node")
})
$probeFromJlc = @($probeRecords | Where-Object {
  [string]$ua = $_.userAgent
  ($ua -match "Electron|JLCEDA|LCEDA|Chrome|Chromium") -and ($ua -notmatch "PowerShell|curl|node")
})
$connectedClients = 0
if ($ws -and $ws.bridge -and $null -ne $ws.bridge.connectedClients) {
  $connectedClients = [int]$ws.bridge.connectedClients
}

[pscustomobject]@{
  checkedAt = (Get-Date).ToString("o")
  expected = [pscustomobject]@{
    version = $ExpectedVersion
    uuid = $ExpectedUuid
  }
  verdict = [pscustomobject]@{
    localBridgeReachable = [bool]($health -and $health.success)
    localBridgeVersionOk = [bool]($health -and $health.version -eq $ExpectedVersion)
    jlcedaProcessRunning = [bool](@($processes).Count -gt 0)
    extensionVersionSeenInCache = [bool]($versionCacheMatch -and $versionCacheMatch.count -gt 0)
    codexMenuSeenInCache = [bool]($menuCacheMatch -and $menuCacheMatch.count -gt 0)
    activationFromJlcSeen = [bool](@($activationFromJlc).Count -gt 0)
    probeFromJlcSeen = [bool](@($probeFromJlc).Count -gt 0)
    liveWsConnected = [bool]($connectedClients -gt 0)
  }
  localBridge = [pscustomobject]@{
    health = $health
    websocket = $ws
    activation = $activation
    probe = $probe
  }
  jlceda = [pscustomobject]@{
    processes = $processes
    cacheRoot = $cacheRoot
    cacheMatches = $cacheMatches
  }
  latestExports = $exports
} | ConvertTo-Json -Depth 8
