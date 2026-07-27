@echo off
REM ============================================================
REM  Infusion-room DB auto backup - run daily by Task Scheduler
REM  Output is appended to D:\iv-backup\backup.log
REM ============================================================
cd /d C:\iv-app\infusion-room
echo [%date% %time%] backup start >> D:\iv-backup\backup.log
node server\backup.js >> D:\iv-backup\backup.log 2>&1
echo [%date% %time%] backup end (exit=%errorlevel%) >> D:\iv-backup\backup.log

REM prune rotated service logs older than 7 days (nssm rotation leaves old files)
forfiles /P C:\iv-app\logs /M *.log /D -7 /C "cmd /c del @path" >nul 2>&1

echo. >> D:\iv-backup\backup.log
