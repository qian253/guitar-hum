# mic-diag5.ps1 - get default capture device via COM MMDeviceEnumerator (authoritative name)
$ErrorActionPreference = 'SilentlyContinue'

Write-Output '===== Default audio capture device (via MMDeviceEnumerator) ====='
try {
    $e = New-Object -ComObject MMDeviceEnumerator
    $d = $e.GetDefaultAudioEndpoint(1, 1)   # eCapture=1, eConsole=1
    $props = $d.OpenPropertyStore(0)        # STGM_READ
    $desc = $props.GetValue([guid]'{A45C254E-DF1C-4EFD-8020-67D146A850E0}')   # PKEY_Device_DeviceDesc
    $fname = $props.GetValue([guid]'{B3F8FA53-0004-438E-9003-51A46E139BFC}')  # PKEY_Device_FriendlyName
    Write-Output ("  DEFAULT CAPTURE: {0}" -f $fname)
    Write-Output ("  DeviceDesc: {0}" -f $desc)
    Write-Output ("  State: {0}" -f $d.GetState())   # 1=active, 2=disabled
    Write-Output ("  Format: {0}" -f $d.GetDeviceFormat())
} catch {
    Write-Output ("  COM query failed: {0}" -f $_.Exception.Message)
}

Write-Output ''
Write-Output '===== Opening classic sound control panel (Recording tab) for you ====='
Start-Process control.exe -ArgumentList 'mmsys.cpl,,1'
Write-Output '  (opened)'
