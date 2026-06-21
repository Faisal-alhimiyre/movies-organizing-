# Run Flutter web with keys from web-files/js/config.js (not committed).
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
  Write-Error "Missing $configPath - copy config.example.js and fill in keys."
  exit 1
}

$content = Get-Content $configPath -Raw

function Get-ConfigValue {
  param([string]$Name)

  $marker = $Name + ":"
  $idx = $content.IndexOf($marker)
  if ($idx -lt 0) {
    return ""
  }

  $rest = $content.Substring($idx + $marker.Length).TrimStart()
  if (-not $rest.StartsWith('"')) {
    return ""
  }

  $end = $rest.IndexOf('"', 1)
  if ($end -lt 1) {
    return ""
  }

  return $rest.Substring(1, $end - 1)
}

$pairs = @(
  @{ Key = "SUPABASE_URL"; Config = "supabaseUrl" },
  @{ Key = "SUPABASE_ANON_KEY"; Config = "supabaseAnonKey" },
  @{ Key = "OMDB_API_KEY"; Config = "omdbApiKey" },
  @{ Key = "TMDB_API_KEY"; Config = "tmdbApiKey" },
  @{ Key = "PUBLIC_APP_URL"; Config = "publicAppUrl" }
)

$defines = @()
foreach ($pair in $pairs) {
  $value = Get-ConfigValue -Name $pair.Config
  if ($value) {
    $defines += "--dart-define=$($pair.Key)=$value"
  }
}

$hasSupabaseUrl = $false
$hasSupabaseKey = $false
foreach ($define in $defines) {
  if ($define.StartsWith("--dart-define=SUPABASE_URL=")) {
    $hasSupabaseUrl = $true
  }
  if ($define.StartsWith("--dart-define=SUPABASE_ANON_KEY=")) {
    $hasSupabaseKey = $true
  }
}

if (-not $hasSupabaseUrl -or -not $hasSupabaseKey) {
  Write-Warning "Supabase keys missing in config.js - app will run in local-only mode."
}

$port = "53100"
if ($args.Count -gt 0) {
  $port = $args[0]
}

function Get-LanIpAddress {
  try {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object {
        $_.IPAddress -notlike "127.*" -and
        $_.IPAddress -notlike "169.254.*"
      }

    $wifi = $candidates | Where-Object { $_.InterfaceAlias -match "Wi-?Fi|Wireless" } | Select-Object -First 1
    if ($wifi) {
      return $wifi.IPAddress
    }

    $first = $candidates | Select-Object -First 1
    if ($first) {
      return $first.IPAddress
    }
  } catch {
    # Fallback if Get-NetIPAddress is unavailable.
  }

  return $null
}

$lanIp = Get-LanIpAddress

Write-Host ""
Write-Host "=== Our Movie Nights (dev) ===" -ForegroundColor Cyan
Write-Host "On this PC (Chrome):  http://localhost:$port/gate" -ForegroundColor Green
Write-Host "  Use localhost on this PC - hot reload works there." -ForegroundColor Gray
if ($lanIp) {
  Write-Host "On iPhone / network IP: http://${lanIp}:$port/gate" -ForegroundColor Yellow
  Write-Host "  IP access needs release mode - run .\run-dev-phone.ps1 instead." -ForegroundColor Yellow
} else {
  Write-Host "On your iPhone: run 'ipconfig' in another terminal and use your Wi-Fi IPv4 address."
}
Write-Host ""
Write-Host "Flutter will open Chrome automatically." -ForegroundColor Gray
Write-Host "Hot reload: click THIS terminal after 'Flutter run key commands', then press r." -ForegroundColor Gray
Write-Host "Hot restart: press R (capital) if hot reload times out." -ForegroundColor Gray
Write-Host "Do NOT type r at the PS prompt - PowerShell reruns the script and port $port will be busy." -ForegroundColor Gray
Write-Host ""

$portBusy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($portBusy) {
  Write-Host "Port $port is already in use. The dev server may still be running." -ForegroundColor Yellow
  Write-Host "  Press q in the flutter terminal to quit, then run this script again." -ForegroundColor Yellow
  Write-Host ""
  exit 1
}

Write-Host "Starting Chrome (first launch can take ~60 seconds)..." -ForegroundColor Gray
Write-Host ""

# Use -d chrome so Flutter owns the browser process — hot reload stays connected.
# Falls back to web-server if Chrome is not found.
$chromeAvailable = $false
$chromePaths = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)
foreach ($p in $chromePaths) {
  if (Test-Path $p) { $chromeAvailable = $true; break }
}
# Also check if flutter can see Chrome devices
if (-not $chromeAvailable) {
  $devices = & $flutterCmd devices 2>&1
  if ($devices -match "chrome") { $chromeAvailable = $true }
}

if ($chromeAvailable) {
  & $flutterCmd run -d chrome --web-port $port @defines
} else {
  Write-Host "Chrome not found - falling back to web-server mode." -ForegroundColor Yellow
  Write-Host "Open http://localhost:${port}/gate in a browser after startup." -ForegroundColor Yellow
  Write-Host ""
  & $flutterCmd run -d web-server --web-hostname 0.0.0.0 --web-port $port @defines
}
