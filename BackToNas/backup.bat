@echo off
title GigaNexusAI - Backup to NAS
pushd "%~dp0" 2>nul
if exist ".\backup.ps1" (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\backup.ps1"
) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup.ps1"
)
set SCRIPT_EXIT_CODE=%ERRORLEVEL%
popd 2>nul
if %SCRIPT_EXIT_CODE% NEQ 0 (
    echo.
    echo [ERROR] Backup script exited with code %SCRIPT_EXIT_CODE%
    pause
)
