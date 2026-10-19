@echo off
rem Double-click to run Chemtech ERP on this PC (no Docker needed). See start-windows.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1" %*
pause
