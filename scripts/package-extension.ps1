param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [string]$ExtensionDir = "extension-live044",
  [string]$OutputPath
)

$ErrorActionPreference = "Stop"

$packageScript = Join-Path $Root "tools\package-eext.mjs"
if (-not (Test-Path $packageScript)) {
  throw "Cannot find package script: $packageScript"
}

$resolvedExtensionDir = Join-Path $Root $ExtensionDir
if (-not (Test-Path $resolvedExtensionDir)) {
  throw "Cannot find extension directory: $resolvedExtensionDir"
}

if (-not $OutputPath) {
  $manifest = Get-Content (Join-Path $resolvedExtensionDir "extension.json") -Raw | ConvertFrom-Json
  $OutputPath = Join-Path $Root ("codex-jlceda-export-bridge-$($manifest.version)-jszip.eext")
}

node $packageScript $resolvedExtensionDir $OutputPath
