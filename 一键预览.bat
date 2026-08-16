@echo off
rem ============================================
rem  One-click preview: start server + open phone-frame preview
rem  Double-click me -> browser shows phone preview (auto-refresh every 2s)
rem ============================================
cd /d "%~dp0"

echo.
echo  Starting preview server (port 8017)...
echo.

netstat -ano | findstr ":8017" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
  start /b python -m http.server 8017 >nul 2>nul
  timeout /t 2 /nobreak >nul
)

echo  Ready! Browser will open the phone-frame preview page.
echo  Phone preview: same WiFi, visit http://THIS-PC-IP:8017
echo.

start "" "http://localhost:8017/%E6%89%8B%E6%9C%BA%E9%A2%84%E8%A7%88.html"
exit /b
