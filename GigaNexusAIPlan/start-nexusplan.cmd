@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (call npm install)
if not exist dist (call npm run build)
call npm start
pause
