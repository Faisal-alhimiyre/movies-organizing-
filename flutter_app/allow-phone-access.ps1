# Run ONCE as Administrator: right-click -> Run with PowerShell (as Admin)
# Allows your iPhone (same Wi-Fi) to reach the Flutter dev server on your PC.

$ruleName = "Our Movie Nights Flutter Dev"

$existing = netsh advfirewall firewall show rule name="$ruleName" 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Firewall rule already exists: $ruleName"
  exit 0
}

netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=53100-53110 profile=private

if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "Done. Your phone can now connect to ports 53100-53110 on this PC." -ForegroundColor Green
  Write-Host "Next: run .\run-dev-phone.ps1 (normal terminal, not admin)."
} else {
  Write-Error "Could not add firewall rule. Make sure you run this script as Administrator."
  exit 1
}
