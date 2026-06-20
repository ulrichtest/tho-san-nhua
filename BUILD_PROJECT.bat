@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js hoac Node.js chua co trong PATH.
  pause
  exit /b 1
)

if not exist "build.js" (
  echo [LOI] Thieu file build.js trong thu muc hien tai.
  pause
  exit /b 1
)

node build.js
if errorlevel 1 (
  echo Build that bai.
  pause
  exit /b 1
)

echo Build thanh cong. Thu muc deploy: dist
pause
