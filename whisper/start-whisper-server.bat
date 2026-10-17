@echo off
set "PATH=%~dp0bin\Release;%PATH%"
cd /d "%~dp0bin\Release"
whisper-server.exe -m "%~dp0models\ggml-small.bin" -l es --port 8081 --convert -t 8
