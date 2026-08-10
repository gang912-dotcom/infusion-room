@echo off
REM ============================================================
REM  Infusion-room - create app shortcut on a staff PC
REM  Run once per PC. Double-click this file.
REM
REM  This is only a launcher. All logic lives in setup-pc-app.ps1
REM  (kept separate so Korean text survives - .bat files here are ASCII).
REM  Windows blocks double-clicking .ps1, hence this wrapper.
REM
REM  To change the server address, edit $Url in setup-pc-app.ps1
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-pc-app.ps1"
pause
