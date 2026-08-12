@echo off
rem ============================================
rem  唱一句·定调子 —— 一键启动
rem  方法1（推荐）：双击 index.html，Chrome/Edge 直接用
rem  方法2：跑本脚本启动本地服务器，手机可扫码访问
rem ============================================
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  ============================================
echo   唱一句 · 定调子  吉他新手定调器
echo  ============================================
echo.
echo  两种打开方式：
echo    1. 直接双击 index.html（本机最快）
echo    2. 本脚本启动本地服务器，手机也能开
echo.

set /p ans=输入 1 直接开文件，或 2 启动服务器 [1/2]：
if "%ans%"=="2" goto server
start "" "index.html"
echo 已打开 index.html，在浏览器里长按麦克风按钮唱一句吧！
exit /b

:server
echo 正在启动本地服务器（端口 8017）...
echo 手机连同一 Wi-Fi 后，访问 http://本机IP:8017
python -m http.server 8017 2>nul
if errorlevel 1 (
  echo 未检测到 python，尝试 node...
  node server.mjs
)
