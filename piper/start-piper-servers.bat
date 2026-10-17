@echo off
start "Piper - Daniela (AR)" python -m piper.http_server -m es_AR-daniela-high --data-dir "%~dp0voices" --port 5001
