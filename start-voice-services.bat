@echo off
REM Levanta whisper-server (STT) y el servidor de Piper (TTS, voz Daniela) que
REM Eris necesita para dictado y respuesta por voz. Corré esto ANTES de
REM "bun run src/server.ts" — cada uno abre en su propia ventana.
start "Whisper (STT)" cmd /k "%~dp0whisper\start-whisper-server.bat"
start "Piper - Daniela (AR)" cmd /k python -m piper.http_server -m es_AR-daniela-high --data-dir "%~dp0piper\voices" --port 5001
