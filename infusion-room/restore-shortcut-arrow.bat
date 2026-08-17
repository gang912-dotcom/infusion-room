@echo off
REM ============================================================
REM  Put the shortcut arrow overlay back (Windows default).
REM  Double-click this file. Needs admin rights.
REM ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0shortcut-arrow.ps1" -Restore
