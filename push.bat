@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "PS=pwsh"
where pwsh >nul 2>nul
if errorlevel 1 set "PS=powershell"

%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0push.ps1" %*
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo 完成。
) else (
  echo 失敗（exit %CODE%），請看上方的錯誤訊息。
)
pause
exit /b %CODE%
