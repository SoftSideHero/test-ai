@echo off
cd /d "%~dp0"

echo Starting TTS server...
where py >nul 2>&1
if errorlevel 1 (
  start "YukiTTS" cmd /k "python tts_server.py"
) else (
  start "YukiTTS" cmd /k "py tts_server.py"
)

timeout /t 2 /nobreak >nul

echo Starting Yuki...
call npm start
if errorlevel 1 (
  echo [!] npm start failed. Run SETUP.bat first.
  pause
)
