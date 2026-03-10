@echo off
title Advanced Search Tool
cd /d "%~dp0"

set API_PORT=3000
set VITE_PORT=5174

echo.
echo ============================================
echo   Advanced Search Tool
echo   Run on any PC - just double-click this file
echo ============================================
echo.

:: Check Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo.
  echo Install Node.js 18+ from: https://nodejs.org
  echo Then run this file again.
  echo.
  pause
  exit /b 1
)

echo Node.js found.
echo.

:: Install dependencies (safe to run every time; fast if already installed)
if not exist "node_modules" (
  echo Installing dependencies (first run on this PC)
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
) else (
  echo Dependencies found. Starting
  echo.
)

:: Start API and frontend together (one window; closing it stops both)
echo Starting API (port %API_PORT%) and app (port %VITE_PORT%)
echo Open in browser: http://localhost:%VITE_PORT%
echo.
echo Press Ctrl+C or close this window to stop.
echo.

:: Open browser after a short delay (non-blocking)
start /B cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:%VITE_PORT%"

:: Run both server and Vite in foreground so closing the window stops everything
call npm run dev:all

pause
