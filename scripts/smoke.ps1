<#
  One-command health check for the Go quota plugin.

  Answers five questions in order:
    1. is the plugin registered with OpenCode?
    2. does its RPC endpoint answer?
    3. is the answer real usage data (credential + subscription + network)?
    4. does the pricing/limits catalog still parse (docs/go markup intact)?
    5. did any plugin half fail to load while these checks ran? (the TUI half
       fails silently on a missing peer dependency — the OpenCode log is the
       only place it shows up)

  Run: bun run smoke                       (against the running service)
       bun run smoke -- -Standalone        (against a private server, does not
                                            touch your running session)

  Use -Standalone right after changing the server half: the shared service keeps
the previously loaded plugin in memory until it restarts.
#>
param([switch]$Standalone)

$ErrorActionPreference = "Continue"

$apiFlags = @()
if ($Standalone) { $apiFlags += "--standalone" }
$warnings = 0

# Everything the plugin writes to the OpenCode log after this point is ours to judge.
$logPath = Join-Path $env:USERPROFILE ".local\share\opencode\log\opencode.log"
$logStart = if (Test-Path $logPath) { (Get-Item $logPath).Length } else { 0 }

function Read-AppendedLog {
  if (-not (Test-Path $logPath)) { return "" }
  $stream = [System.IO.File]::Open($logPath, "Open", "Read", "ReadWrite")
  try {
    if ($stream.Length -le $logStart) { return "" }
    $stream.Seek($logStart, "Begin") | Out-Null
    return (New-Object System.IO.StreamReader($stream)).ReadToEnd()
  } finally {
    $stream.Close()
  }
}

function Invoke-Rpc([string]$method) {
  $raw = & opencode api @apiFlags post "/api/rpc/go-limits/$method" --data '{\"input\":{}}' 2>&1 | Out-String
  try { return $raw | ConvertFrom-Json } catch { return $null }
}

function Write-ServiceHint {
  Write-Host "        if the server plugin changed, restart the background service:" -ForegroundColor DarkGray
  Write-Host "        opencode service restart" -ForegroundColor DarkGray
}

Write-Host "1/5 plugin registration" -ForegroundColor Cyan
$listed = & opencode plugin list 2>&1 | Select-String -SimpleMatch "go-limits"
if (-not $listed) {
  Write-Host "  FAIL  go-limits is not registered" -ForegroundColor Red
  Write-Host "        check the 'plugins' entry in ~/.config/opencode/opencode.jsonc" -ForegroundColor DarkGray
  exit 1
}
Write-Host "  OK    $($listed.Line.Trim())" -ForegroundColor Green

Write-Host "2/5 RPC + usage endpoint" -ForegroundColor Cyan
$body = Invoke-Rpc "get"
if (-not $body) {
  Write-Host "  FAIL  unreadable response from /api/rpc/go-limits/get" -ForegroundColor Red
  Write-ServiceHint
  exit 1
}
if ($body._tag) {
  Write-Host "  FAIL  $($body._tag): $($body.message)" -ForegroundColor Red
  Write-ServiceHint
  exit 1
}

$usage = $body.output.usage
if (-not $usage) {
  $code = $body.output.code
  if (-not $code) { $code = "unknown" }
  $message = $body.output.error
  if (-not $message) { $message = "no usage in response" }
  Write-Host "  FAIL  [$code] $message" -ForegroundColor Red
  switch ($code) {
    "no-credential" { Write-Host "        run /connect in OpenCode and pick OpenCode Go" -ForegroundColor DarkGray }
    "unauthorized"  { Write-Host "        the Go API key was rejected - re-issue it in the console" -ForegroundColor DarkGray }
    "not-subscribed" { Write-Host "        the key is valid but has no Go subscription" -ForegroundColor DarkGray }
    "network"       { Write-Host "        cannot reach opencode.ai - check VPN/proxy/DNS" -ForegroundColor DarkGray }
    "bad-response"  { Write-Host "        the endpoint changed shape - update index.ts/rpc.ts" -ForegroundColor DarkGray }
  }
  exit 1
}
Write-Host ("  OK    5h={0}% weekly={1}% monthly={2}%" -f `
  $usage.rolling.percent, $usage.weekly.percent, $usage.monthly.percent) -ForegroundColor Green

Write-Host "3/5 pricing catalog (docs/go)" -ForegroundColor Cyan
$catalogBody = Invoke-Rpc "catalog"
if (-not $catalogBody) {
  Write-Host "  FAIL  unreadable response from /api/rpc/go-limits/catalog" -ForegroundColor Red
  Write-ServiceHint
  exit 1
}
if ($catalogBody._tag) {
  Write-Host "  FAIL  $($catalogBody._tag): $($catalogBody.message)" -ForegroundColor Red
  Write-ServiceHint
  exit 1
}

$catalog = $catalogBody.output.catalog
if (-not $catalog -or -not $catalog.plans.go) {
  $code = $catalogBody.output.code
  if (-not $code) { $code = "unknown" }
  Write-Host "  FAIL  [$code] $($catalogBody.output.error)" -ForegroundColor Red
  if ($code -eq "pricing-parse") {
    Write-Host "        docs/go markup changed - update pricing.mjs and the fixture" -ForegroundColor DarkGray
  }
  exit 1
}

$goCount = @($catalog.plans.go).Count
$plusPlan = @($catalog.plans.plus)
$plusCount = if ($plusPlan.Count -gt 0) { "$($plusPlan.Count)" } else { "none" }
Write-Host ("  OK    Go: {0} models, Go Plus: {1}" -f $goCount, $plusCount) -ForegroundColor Green
foreach ($model in (@($catalog.plans.go) | Select-Object -First 3)) {
  Write-Host ("        {0}: {1} req/month" -f $model.name, $model.monthly) -ForegroundColor DarkGray
}

Write-Host "4/5 plugin API version" -ForegroundColor Cyan
$installedVersion = $null
$installedManifest = Join-Path $PSScriptRoot "..\node_modules\@opencode\plugin\package.json"
if (Test-Path $installedManifest) {
  $installedVersion = (Get-Content $installedManifest -Raw | ConvertFrom-Json).version
}
$cliVersion = $null
if ((& opencode --version 2>&1 | Out-String) -match "(\d+\.\d+\.\d+)") {
  $cliVersion = $Matches[1]
}

if (-not $installedVersion) {
  $warnings++
  Write-Host "  WARN  @opencode/plugin is not installed" -ForegroundColor Yellow
  Write-Host "        npm install --save-exact `"@opencode/plugin@$cliVersion`"" -ForegroundColor DarkGray
} elseif (-not $cliVersion) {
  $warnings++
  Write-Host "  WARN  could not read the OpenCode version" -ForegroundColor Yellow
} elseif ($installedVersion -eq $cliVersion) {
  Write-Host "  OK    $installedVersion matches the CLI" -ForegroundColor Green
} else {
  $warnings++
  Write-Host "  WARN  plugin API $installedVersion, OpenCode CLI $cliVersion" -ForegroundColor Yellow
  Write-Host "        these can drift apart after an OpenCode update; align them with:" -ForegroundColor DarkGray
  Write-Host "        npm install --save-exact `"@opencode/plugin@$cliVersion`"" -ForegroundColor DarkGray
}

Write-Host "5/5 plugin load failures in the OpenCode log" -ForegroundColor Cyan
$appended = Read-AppendedLog
$loadFailures = @(
  $appended -split "`n" | Where-Object {
    $_ -match "component=plugin" -and $_ -match "opencode-go-limits" -and $_ -match "error="
  }
)
if ($loadFailures.Count -gt 0) {
  Write-Host "  FAIL  a plugin half failed to load:" -ForegroundColor Red
  foreach ($line in ($loadFailures | Select-Object -Last 2)) {
    $message = ($line -split 'error="')[-1]
    if (-not $message) { $message = $line }
    Write-Host "        $($message.Substring(0, [Math]::Min(180, $message.Length)))" -ForegroundColor DarkGray
  }
  Write-Host "        a missing peer (@opentui/solid, solid-js) breaks the TUI half;" -ForegroundColor DarkGray
  Write-Host "        reinstall the package: opencode plugin remove/add <package>" -ForegroundColor DarkGray
  exit 1
}
Write-Host "  OK    no plugin load failures while checking" -ForegroundColor Green

if ($warnings -gt 0) {
  Write-Host "verdict: healthy, $warnings warning(s)" -ForegroundColor Yellow
} else {
  Write-Host "verdict: healthy" -ForegroundColor Green
}
