@echo off
REM ============================================================
REM  Infusion-room deploy / update
REM  Run this after code changes to update the running server.
REM  (nssm service name: iv-app)
REM ============================================================
cd /d C:\iv-app\infusion-room

echo [1/4] git pull ...
git pull || goto :err

echo [2/4] npm install ...
REM npm install (not npm ci): ci wipes node_modules and fails with EPERM because the
REM running iv-app service locks better_sqlite3.node. install only fills missing deps.
call npm install || goto :err

echo [3/4] build ...
call npm run build || goto :err

echo [4/4] restart service ...
REM full path on purpose: C:\iv-app\tools may not be in PATH on a fresh server PC
"C:\iv-app\tools\nssm.exe" restart iv-app || goto :err

echo.
echo === Deploy done. ===
goto :eof

:err
echo.
echo *** Deploy FAILED (see message above). Server was NOT restarted if build failed. ***
exit /b 1
