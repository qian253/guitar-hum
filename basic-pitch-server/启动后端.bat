@echo off
rem ============================================
rem  basic-pitch 高精度后端 —— 一键启动
rem  启动后 App 诊断面板里填 http://127.0.0.1:8000
rem ============================================
chcp 65001 >nul
cd /d "%~dp0"

if not exist "venv\Scripts\python.exe" (
  echo [错误] 没找到 venv，请先让 Claude 帮你执行一次安装。
  pause
  exit /b
)

echo.
echo  启动 basic-pitch 后端：http://127.0.0.1:8000
echo  保持这个窗口开着，App 里填 http://127.0.0.1:8000
echo  按 Ctrl+C 停止。
echo.
venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
