# Stop anything on port 53100, then start release server (PC + iPhone).
Set-Location $PSScriptRoot

$port = 53100
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($conn in $listeners) {
  $processId = $conn.OwningProcess
  if ($processId) {
    Write-Host "Stopping process on port $port (PID $processId)..." -ForegroundColor Yellow
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

Start-Sleep -Seconds 2

$still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($still) {
  Write-Host "Port $port is still busy. Close other Flutter terminals and try again." -ForegroundColor Red
  exit 1
}

Write-Host "Starting dev server..." -ForegroundColor Green
Write-Host "Keep this window open. Press q here to stop the server." -ForegroundColor Gray
Write-Host ""
& (Join-Path $PSScriptRoot "run-dev-phone.ps1")
