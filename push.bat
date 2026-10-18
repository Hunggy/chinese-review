@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where pwsh >nul 2>nul
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push.ps1" %*
) else (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0push.ps1" %*
)

set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (
  echo Done.
) else (
  echo Failed - see the error above. exit code: %CODE%
)
pause
exit /b %CODE%
