# Flutter web server for iPhone testing (Safari on same Wi-Fi).
# Does NOT open Chrome — made for phone access.
Set-Location $PSScriptRoot

$flutterCmd = $null
if (Get-Command flutter -ErrorAction SilentlyContinue) {
  $flutterCmd = "flutter"
} elseif (Test-Path "C:\flutter\bin\flutter.bat") {
  $flutterCmd = "C:\flutter\bin\flutter.bat"
}

if (-not $flutterCmd) {
  Write-Error "Flutter not found. Install to C:\flutter or add flutter to PATH."
  exit 1
}

$configPath = Join-Path $PSScriptRoot "..\web-files\js\config.js"
if (-not (Test-Path $configPath)) {
  Write-Error "Missing $configPath"
  exit 1
}

$content = Get-Content $configPath -Raw

function Get-ConfigValue {
  param([string]$Name)
  $marker = $Name + ":"
  $idx = $content.IndexOf($marker)
  if ($idx -lt 0) { return "" }
  $rest = $content.Substring($idx + $marker.Length).TrimStart()
  if (-not $rest.StartsWith('"')) { return "" }
  $end = $rest.IndexOf('"', 1)
  if ($end -lt 1) { return "" }
  return $rest.Substring(1, $end - 1)
}

$defines = @()
foreach ($pair in @(
    @{ Key = "SUPABASE_URL"; Config = "supabaseUrl" },
    @{ Key = "SUPABASE_ANON_KEY"; Config = "supabaseAnonKey" },
    @{ Key = "OMDB_API_KEY"; Config = "omdbApiKey" },
    @{ Key = "TMDB_API_KEY"; Config = "tmdbApiKey" },
    @{ Key = "PUBLIC_APP_URL"; Config = "publicAppUrl" }
  )) {
  $value = Get-ConfigValue -Name $pair.Config
  if ($value) { $defines += "--dart-define=$($pair.Key)=$value" }
}

$port = "53100"
if ($args.Count -gt 0) { $port = $args[0] }

function Get-LanIpAddress {
  try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
    $wifi = $candidates | Where-Object { $_.InterfaceAlias -match "Wi-?Fi|Wireless" } | Select-Object -First 1
    if ($wifi) { return $wifi.IPAddress }
    $first = $candidates | Select-Object -First 1
    if ($first) { return $first.IPAddress }
  } catch { }
  return $null
}

$lanIp = Get-LanIpAddress

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  iPhone testing mode" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
if ($lanIp) {
  Write-Host "  On iPhone Safari, open EXACTLY:" -ForegroundColor Yellow
  Write-Host "  http://${lanIp}:$port/gate" -ForegroundColor White -BackgroundColor DarkBlue
} else {
  Write-Host "  Run ipconfig, find Wi-Fi IPv4, then open:" -ForegroundColor Yellow
  Write-Host "  http://YOUR_IP:$port/gate"
}
Write-Host ""
Write-Host "  Rules:" -ForegroundColor Gray
Write-Host "  - Uses RELEASE build (required for IP / iPhone - debug mode shows a white page)" -ForegroundColor Gray
Write-Host "  - iPhone and PC on the SAME Wi-Fi (not guest network)" -ForegroundColor Gray
Write-Host "  - If phone cannot connect, run allow-phone-access.ps1 as Admin once" -ForegroundColor Gray
Write-Host "  - Keep this window open while testing" -ForegroundColor Gray
Write-Host "  - No hot reload in release mode; stop (q) and rerun to apply code changes" -ForegroundColor Gray
Write-Host ""

$portBusy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($portBusy) {
  Write-Host "Port $port is already in use. Press q in the flutter terminal, then run this script again." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

Write-Host "Building release web app (first run can take 1-2 minutes)..." -ForegroundColor Gray
Write-Host ""

& $flutterCmd run -d web-server --release --web-hostname 0.0.0.0 --web-port $port @defines
