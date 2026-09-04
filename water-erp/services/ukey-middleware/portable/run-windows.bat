@echo off
chcp 65001 >nul
rem ═══ CA盾(USB)一键启动 · Windows 免环境版 ═══
set "DIR=%~dp0"
set "UKEY_SLOT_DIR=%DIR%slots"
set "UKEY_MW_ALLOW_ORIGIN=http://localhost:3004,http://127.0.0.1:3004,http://192.168.1.111:3004"
curl -s -m 2 http://127.0.0.1:17999/health >nul 2>&1
if %errorlevel%==0 (
  echo 中间件已在运行:
  curl -s http://127.0.0.1:17999/health
  echo.
  pause
  exit /b 0
)
echo 启动 mock U盾中间件 :17999 —— 关闭本窗口即停止
"%DIR%runtime\win\node.exe" "%DIR%middleware\src\cli.mjs" serve
pause
