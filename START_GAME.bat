@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo       THO SAN NHUA - LOCAL SERVER
echo ========================================

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js hoac Node.js chua co trong PATH.
  echo Hay cai Node.js 18 tro len, sau do mo lai file nay.
  pause
  exit /b 1
)

if not exist "server.js" (
  echo [LOI] Thieu file server.js trong thu muc hien tai.
  echo Hay giai nen TOAN BO file ZIP truoc khi chay.
  pause
  exit /b 1
)

echo Dang kiem tra asset ban do...
call npm run dev
pause
