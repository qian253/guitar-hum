# mic-diag4.ps1 - inspect Windows registry MMDevices capture endpoints (authoritative)
$ErrorActionPreference = 'SilentlyContinue'

Write-Output '===== Windows MMDevices Audio/Capture endpoints ====='
$capPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Capture'
if (-not (Test-Path $capPath)) {
    Write-Output '  Capture registry path does NOT exist -> no microphone endpoints registered'
} else {
    $guids = Get-ChildItem $capPath
    if (-not $guids) {
        Write-Output '  Capture path exists but has NO endpoint entries'
    }
    foreach ($g in $guids) {
        $state = (Get-ItemProperty -Path $g.PSPath -Name DeviceState -ErrorAction SilentlyContinue).DeviceState
        # DeviceState: 1=Active, 2=Disabled, 4=NotPresent, 8=Unplugged
        $stateName = switch ($state) { 1 { 'ACTIVE' } 2 { 'DISABLED' } 4 { 'NOT PRESENT' } 8 { 'UNPLUGGED' } default { "state=$state" } }
        # get device friendly name from Properties -> DeviceDescription
        $props = (Get-ItemProperty -Path "$($g.PSPath)\Properties" -ErrorAction SilentlyContinue)
        $name = ''
        foreach ($prop in $props.PSObject.Properties) {
            if ($prop.Name -match '^\{a45c254e') { $name = $prop.Value }
        }
        Write-Output ("  [{0}] {1}" -f $stateName, $name)
    }
}

Write-Output ''
Write-Output '===== Default capture device (registry default endpoint) ====='
$defPath = 'HKCU:\Software\Microsoft\Multimedia\Audio'
$def = Get-ItemProperty -Path $defPath -Name CaptureDevice -ErrorAction SilentlyContinue
if ($def) {
    Write-Output ("  Default capture: {0}" -f $def.CaptureDevice)
} else {
    Write-Output '  (no explicit default capture set in HKCU)'
}

Write-Output ''
Write-Output '===== Last accessed: any apps holding microphone via Process Explorer style ====='
# Check if any app currently has an open handle to capture - approximate by checking audio capture-related
Write-Output '  (see process list in previous step; 360 browser + WeChat are running)'
