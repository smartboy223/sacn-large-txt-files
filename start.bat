@echo off
title Advanced Search Tool
cd /d "%~dp0"

set API_PORT=3000
set PORT=5174

echo ============================================
echo  Advanced Search Tool (runs locally on PC)
echo  Default path = this folder (where code runs)
echo ============================================
echo.

echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo Failed to install dependencies.
  pause
  exit /b 1
)

echo.
echo Starting local server (port %API_PORT%) and app (port %PORT%)...
echo You can change the search folder in the app via Map directory or Browse.
echo.
start /B "" node server/index.cjs
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%"
call npm run dev

pause
