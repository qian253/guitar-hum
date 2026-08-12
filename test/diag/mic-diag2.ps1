# mic-diag2.ps1 - ASCII only to avoid encoding issues
$ErrorActionPreference = 'SilentlyContinue'

Write-Output '===== [A] ALL audio endpoints (incl disabled) ====='
$all = Get-PnpDevice -Class AudioEndpoint
$inputs = $all | Where-Object { $_.FriendlyName -match 'Microphone|Mic|Stereo Mix|Input' }
if ($inputs) {
    $inputs | ForEach-Object { Write-Output ("  [{0}] {1}" -f $_.Status, $_.FriendlyName) }
} else {
    Write-Output '  NO microphone/input endpoints at all'
}

Write-Output ''
Write-Output '===== [B] ALL audio endpoints (first 30) ====='
$all | ForEach-Object { Write-Output ("  [{0}] {1}" -f $_.Status, $_.FriendlyName) } | Select-Object -First 30

Write-Output ''
Write-Output '===== [C] Sound card / audio drivers ====='
$cards = Get-CimInstance Win32_SoundDevice
if ($cards) {
    $cards | ForEach-Object { Write-Output ("  name: {0} | status: {1}" -f $_.Name, $_.Status) }
} else {
    Write-Output '  NO sound card found'
}

Write-Output ''
Write-Output '===== [D] Disabled/Problem devices related to audio ====='
$problem = Get-PnpDevice | Where-Object { $_.Status -ne 'OK' -and ($_.Class -eq 'AudioEndpoint' -or $_.FriendlyName -match 'Audio|Sound|Microphone|Mic') }
if ($problem) {
    $problem | ForEach-Object { Write-Output ("  [{0}] {1} ({2})" -f $_.Status, $_.FriendlyName, $_.InstanceId) }
} else {
    Write-Output '  no disabled/problem audio devices'
}
