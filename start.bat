@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
python scanner\scan_brain.py --home "%LOCALAPPDATA%\hermes" --out public\brain.windows.json --label "Windows Hermes home" --host "this PC"
echo.
echo Cortex is the Windows copy until you run scan-droplet.ps1
echo Open http://localhost:5173
echo.
npm run dev
