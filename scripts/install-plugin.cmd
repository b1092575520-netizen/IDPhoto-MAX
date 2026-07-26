@echo off
title Install IDPhoto MAX
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-plugin.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" echo Installation did not complete. See the message above.
pause
exit /b %EXIT_CODE%
