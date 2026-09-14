@echo off
cd /d "%~dp0"

echo === Yuki Neurona SETUP (Cloud Gemini) ===

if not exist "secrets.json" (
  if exist "secrets.json.example" copy /Y "secrets.json.example" "secrets.json" >nul
  echo.
  echo [!] Created secrets.json — paste your Gemini API key inside.
  echo     Get key: https://aistudio.google.com/apikey
  echo     See CLOUD.md
  echo.
)

if not exist "Yuki.vrm" (
  if exist "D:\Project_Yuki\Yuki.vrm" (
    echo Copying Yuki.vrm ...
    copy /Y "D:\Project_Yuki\Yuki.vrm" "Yuki.vrm"
  ) else (
    echo [!] Put Yuki.vrm in this folder later.
  )
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [!] npm not found. Install Node.js: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo Installing Electron...
  call npm install
)

where py >nul 2>&1
if errorlevel 1 (
  where python >nul 2>&1
  if errorlevel 1 (
    echo [!] Python not found for TTS.
  ) else (
    python -m pip install -r requirements.txt
  )
) else (
  py -m pip install -r requirements.txt
)

echo.
echo DONE. Next:
echo   1. Put Gemini key in secrets.json
echo   2. Run START.bat
echo   LM Studio is NOT required anymore.
echo.
pause
