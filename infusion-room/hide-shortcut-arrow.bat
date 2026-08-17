@echo off
REM ============================================================
REM  Hide the shortcut arrow overlay on this PC.
REM  Run once per PC. Double-click this file.
REM
REM  Affects EVERY shortcut on this PC, not just the app one.
REM  Needs admin rights - the script asks for them by itself.
REM  Undo with restore-shortcut-arrow.bat
REM
REM  Logic lives in shortcut-arrow.ps1 (kept separate so Korean
REM  text survives - .bat files here are ASCII).
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0shortcut-arrow.ps1"
