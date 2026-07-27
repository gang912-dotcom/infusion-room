@echo off
REM ============================================================
REM  Infusion-room DB auto backup - run daily by Task Scheduler
REM  Output is appended to D:\iv-backup\backup.log
REM ============================================================
cd /d C:\iv-app\infusion-room
echo [%date% %time%] backup start >> D:\iv-backup\backup.log
node server\backup.js >> D:\iv-backup\backup.log 2>&1
echo [%date% %time%] backup end (exit=%errorlevel%) >> D:\iv-backup\backup.log
echo. >> D:\iv-backup\backup.log
