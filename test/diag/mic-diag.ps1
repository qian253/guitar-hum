# mic-diag.ps1 — 诊断 Windows 麦克风链路（只读，不改任何设置）
$ErrorActionPreference = 'SilentlyContinue'

Write-Output '===== [1] 系统检测到的录音设备 ====='
$devices = Get-PnpDevice -Class AudioEndpoint -Status OK | Where-Object { $_.FriendlyName -match 'Microphone|麦克风|Mic|录音|Stereo Mix' }
if ($devices) {
    $devices | ForEach-Object { Write-Output ("  状态: {0}  | 设备: {1}" -f $_.Status, $_.FriendlyName) }
} else {
    Write-Output '  （未找到任何录音设备，或全部被禁用/未接入）'
}

Write-Output ''
Write-Output '===== [2] Windows 麦克风隐私开关 ====='
$path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
$val = (Get-ItemProperty -Path $path -Name Value -ErrorAction SilentlyContinue).Value
Write-Output ("  所有应用访问麦克风: {0}" -f $(if ($val -eq 'Allow') { '允许' } elseif ($val -eq 'Deny') { '拒绝!' } else { '未设置(' + $val + ')' }))
$np = (Get-ItemProperty -Path ($path + '\NonPackaged') -Name Value -ErrorAction SilentlyContinue).Value
Write-Output ("  桌面应用(浏览器属于此类)访问麦克风: {0}" -f $(if ($np -eq 'Allow') { '允许' } elseif ($np -eq 'Deny') { '拒绝!' } else { '未设置(' + $np + ')' }))

Write-Output ''
Write-Output '===== [3] 音频服务状态 ====='
$svc = Get-Service Audiosrv -ErrorAction SilentlyContinue
if ($svc) { Write-Output ("  Windows Audio 服务: {0}" -f $svc.Status) }
