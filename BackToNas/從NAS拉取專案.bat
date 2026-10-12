@echo off
title GigaNexusAI - Pull from NAS
pushd "%~dp0" 2>nul
if exist ".\pull.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\pull.ps1"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pull.ps1"
)
set SCRIPT_EXIT_CODE=%ERRORLEVEL%
popd 2>nul
if %SCRIPT_EXIT_CODE% NEQ 0 (
    echo.
    echo [ERROR] Pull script exited with code %SCRIPT_EXIT_CODE%
    pause
)
