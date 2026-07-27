@echo off
REM ==================================================================
REM  Infusion-room server: one-time ADMIN setup
REM  RIGHT-CLICK this file -> "Run as administrator"
REM
REM  Does 3 things:
REM   1) open firewall TCP 4000 (private + domain profiles)
REM   2) register node as a Windows service via nssm (auto-start + auto-restart + log rotation)
REM   3) register daily DB backup in Task Scheduler (03:00)
REM ==================================================================

REM --- must be elevated ---
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Not running as administrator.
  echo Right-click admin-setup.bat and choose "Run as administrator".
  pause
  exit /b 1
)

set "NSSM=C:\iv-app\tools\nssm.exe"
set "NODE=C:\Program Files\nodejs\node.exe"
set "APPDIR=C:\iv-app\infusion-room"

echo.
echo === [1/3] Firewall: allow TCP 4000 (private,domain) ===
netsh advfirewall firewall delete rule name="IVApp-Port4000" >nul 2>&1
netsh advfirewall firewall add rule name="IVApp-Port4000" dir=in action=allow protocol=TCP localport=4000 profile=private,domain
if errorlevel 1 ( echo [ERROR] firewall rule failed & goto :err )

echo.
echo === [2/3] nssm service: iv-app ===
REM remove old one if this script is re-run
"%NSSM%" stop iv-app >nul 2>&1
"%NSSM%" remove iv-app confirm >nul 2>&1

"%NSSM%" install iv-app "%NODE%" "server\index.js"
if errorlevel 1 ( echo [ERROR] nssm install failed & goto :err )
"%NSSM%" set iv-app AppDirectory "%APPDIR%"
"%NSSM%" set iv-app AppEnvironmentExtra PORT=4000
"%NSSM%" set iv-app DisplayName "Infusion-room server (iv-app / suaeksil)"
"%NSSM%" set iv-app Description "Infusion-room monitor server - node/express on port 4000"
REM start automatically at boot
"%NSSM%" set iv-app Start SERVICE_AUTO_START
REM restart if it crashes
"%NSSM%" set iv-app AppExit Default Restart
"%NSSM%" set iv-app AppRestartDelay 3000
"%NSSM%" set iv-app AppThrottle 3000
REM logs + rotation (rotate at 10MB, while running); old rotated logs are pruned by backup.bat (7 days)
"%NSSM%" set iv-app AppStdout C:\iv-app\logs\out.log
"%NSSM%" set iv-app AppStderr C:\iv-app\logs\err.log
"%NSSM%" set iv-app AppRotateFiles 1
"%NSSM%" set iv-app AppRotateOnline 1
"%NSSM%" set iv-app AppRotateBytes 10485760

echo Starting service ...
"%NSSM%" start iv-app
if errorlevel 1 ( echo [ERROR] service start failed & goto :err )

echo.
echo === [3/3] Task Scheduler: daily DB backup at 03:00 ===
schtasks /Create /TN "IVApp-DB-Backup" /TR "C:\iv-app\infusion-room\backup.bat" /SC DAILY /ST 03:00 /RU SYSTEM /RL HIGHEST /F
if errorlevel 1 ( echo [ERROR] schtasks create failed & goto :err )

echo.
echo ==================================================================
echo  DONE. Service "iv-app" installed and started.
echo  - Open http://localhost:4000 to check.
echo  - Service status:  sc query iv-app
echo ==================================================================
pause
goto :eof

:err
echo.
echo *** SETUP FAILED. See the error above. Nothing was rebooted. ***
pause
exit /b 1
