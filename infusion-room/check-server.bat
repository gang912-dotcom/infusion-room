@echo off
REM Quick health check for the infusion-room server (no admin needed).
echo ============================================
echo  iv-app service state:
sc query iv-app | find "STATE"
echo ============================================
echo Opening http://localhost:4000 in your browser ...
start "" "http://localhost:4000"
echo.
echo If the login page appears, the server is up.
pause
