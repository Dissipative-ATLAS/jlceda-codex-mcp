$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$McpDir = Join-Path $Root "mcp"
Push-Location $McpDir
try {
  if (!(Test-Path "node_modules")) {
    npm install
  }
  npm run http
} finally {
  Pop-Location
}
