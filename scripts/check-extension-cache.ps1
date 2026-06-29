param(
  [string]$ExpectedVersion,
  [string]$ExpectedUuid,
  [string[]]$Patterns = @(),
  [string]$CacheRoot = (Join-Path $env:LOCALAPPDATA "LCEDA-Pro\cache.x64.3\IndexedDB")
)

$ErrorActionPreference = "Stop"

if (-not $ExpectedVersion) {
  throw "ExpectedVersion is required."
}
if (-not $ExpectedUuid) {
  throw "ExpectedUuid is required."
}

$normalizedPatterns = @()
foreach ($pattern in $Patterns) {
  if ($null -eq $pattern) {
    continue
  }
  $parts = [string]$pattern -split ","
  foreach ($part in $parts) {
    $trimmed = $part.Trim()
    if ($trimmed.Length -gt 0) {
      $normalizedPatterns += $trimmed
    }
  }
}
$allPatterns = @($ExpectedVersion, $ExpectedUuid) + $normalizedPatterns
$matches = @()

if (Test-Path $CacheRoot) {
  foreach ($pattern in $allPatterns) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $hitLines = @(& rg -a -n -F --glob '!LOCK' --glob '!Cookies' --glob '!Cookies-journal' $pattern $CacheRoot 2>$null)
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    $matches += [pscustomobject]@{
      pattern = $pattern
      count = @($hitLines).Count
      sample = @($hitLines | Select-Object -First 5)
    }
  }
}

[pscustomobject]@{
  checkedAt = (Get-Date).ToString("o")
  cacheRoot = $CacheRoot
  exists = Test-Path $CacheRoot
  expected = [pscustomobject]@{
    version = $ExpectedVersion
    uuid = $ExpectedUuid
  }
  verdict = [pscustomobject]@{
    versionSeen = [bool](($matches | Where-Object { $_.pattern -eq $ExpectedVersion } | Select-Object -First 1).count -gt 0)
    uuidSeen = [bool](($matches | Where-Object { $_.pattern -eq $ExpectedUuid } | Select-Object -First 1).count -gt 0)
    allExtraPatternsSeen = [bool](@($matches | Where-Object {
      $_.pattern -ne $ExpectedVersion -and $_.pattern -ne $ExpectedUuid -and $_.count -le 0
    }).Count -eq 0)
  }
  matches = $matches
} | ConvertTo-Json -Depth 8
