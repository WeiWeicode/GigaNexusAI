@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 架構圖網站(只看架構,不含甘特圖進度與編輯;不需要資料庫)
if not exist node_modules (call npm install)
call npm run arch
pause
