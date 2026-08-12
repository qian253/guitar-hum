# mic-diag3.ps1 - authoritative capture-device enumeration via WinRT MMDevice API
$ErrorActionPreference = 'SilentlyContinue'

Write-Output '===== [1] Windows MMDevice API: ALL capture (microphone) devices ====='
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
    Function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
    }
    [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Enumeration.DeviceClass, Windows.Devices.Enumeration, ContentType = WindowsRuntime] | Out-Null
    $capture = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::AudioCapture)) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Enumeration.DeviceInformation]])
    if ($capture.Count -gt 0) {
        $capture | ForEach-Object { Write-Output ("  FOUND: {0}  [id={1}]" -f $_.Name, $_.Id) }
    } else {
        Write-Output '  NONE - no capture devices at all (hardware missing, disabled, or driver issue)'
    }
    # default capture device
    [Windows.Media.Devices.MediaDevice, Windows.Media.Devices, ContentType = WindowsRuntime] | Out-Null
    $def = [Windows.Media.Devices.MediaDevice]::GetDefaultAudioCaptureId([Windows.Media.Devices.AudioDeviceRole]::Default)
    Write-Output ("  Default capture device id: {0}" -f $(if ($def) { $def } else { '(none)' }))
} catch {
    Write-Output ("  WinRT enumeration failed: {0}" -f $_.Exception.Message)
}

Write-Output ''
Write-Output '===== [2] Disabled / hidden audio devices (device manager) ====='
$disabled = Get-PnpDevice -Class AudioEndpoint -Status Unknown, Error, Degraded 2>$null
$any = $false
$disabled | ForEach-Object {
    if ($_.FriendlyName -match 'Microphone|Mic|Audio|Sound|耳机|麦克风|扬声器|Audio') {
        $any = $true
        Write-Output ("  [{0}] {1}  ({2})" -f $_.Status, $_.FriendlyName, $_.InstanceId)
    }
}
if (-not $any) { Write-Output '  (no disabled/unknown audio endpoints found via PnP)' }

Write-Output ''
Write-Output '===== [3] Processes possibly holding the microphone / security software ====='
$procs = Get-Process | Where-Object { $_.ProcessName -match '360|QQ|WeChat|WeMeet|TencentMeeting|Zoom|dingtalk|feishu|svchost|Teamviewer|Sunlogin|obs|discord' }
if ($procs) {
    $procs | ForEach-Object { Write-Output ("  running: {0} (pid {1})" -f $_.ProcessName, $_.Id) } | Select-Object -Unique
} else {
    Write-Output '  (no obvious call/security apps currently running)'
}

Write-Output ''
Write-Output '===== [4] Sound cards present (Win32) ====='
Get-CimInstance Win32_SoundDevice | ForEach-Object { Write-Output ("  {0}  [{1}]" -f $_.Name, $_.Status) }
