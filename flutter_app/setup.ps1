# First-time Flutter platform setup (run once after installing Flutter SDK)
Set-Location $PSScriptRoot

$flutterCmd = $null
if (Get-Command flutter -ErrorAction SilentlyContinue) {
  $flutterCmd = "flutter"
} elseif (Test-Path "C:\flutter\bin\flutter.bat") {
  $flutterCmd = "C:\flutter\bin\flutter.bat"
}

if (-not $flutterCmd) {
  Write-Error @"
Flutter not found. Either:
  1. Add C:\flutter\bin to your PATH, restart the terminal, and run this again, or
  2. Install Flutter to C:\flutter from https://docs.flutter.dev/get-started/install/windows
"@
  exit 1
}

& $flutterCmd create . --org com.ourmovienights --project-name our_movie_nights --platforms=web,android,ios
& $flutterCmd pub get
& $flutterCmd test

Write-Host ""
Write-Host "Done. Run: flutter run -d chrome"
