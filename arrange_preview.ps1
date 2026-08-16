# arrange_preview.ps1 — VSCode 左半屏,预览浏览器窗口右半屏
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$W = $screen.Width; $H = $screen.Height
$flags = 0x0040

$code = Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($code) {
  if ([Win32]::IsIconic($code.MainWindowHandle)) { [Win32]::ShowWindow($code.MainWindowHandle, 9) | Out-Null }
  [Win32]::SetWindowPos($code.MainWindowHandle, [IntPtr]::Zero, 0, 0, [int]($W * 0.55), $H, $flags) | Out-Null
  Write-Host "VSCode -> left 55%"
}

# 预览窗口:优先按标题匹配(360/Edge/Chrome 通用),找不到则取浏览器主窗口
$target = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match '定调子|唱一句|手机实时预览' } | Select-Object -First 1
if (-not $target) {
  $target = Get-Process 360se, msedge, chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
}
if ($target) {
  if ([Win32]::IsIconic($target.MainWindowHandle)) { [Win32]::ShowWindow($target.MainWindowHandle, 9) | Out-Null }
  [Win32]::SetWindowPos($target.MainWindowHandle, [IntPtr]::Zero, [int]($W * 0.55), 0, [int]($W * 0.45), $H, $flags) | Out-Null
  Write-Host ("Preview -> right 45% (" + $target.ProcessName + ")")
}
