<#
Eris — levantar, pausar y revisar sus servicios (lo mismo que dice el runbook de AXS:
"40-49 Standards & SOPs/41 Runbooks/Levantar los Servicios de Eris.md").

Uso (PowerShell):
  powershell -NoProfile -ExecutionPolicy Bypass -File C:\Proyectos\eris\scripts\servicios.ps1 <acción>

Acciones:
  estado             qué está corriendo: puertos, procesos, modelo cargado, GPU y RAM
  levantar           todo: Ollama (con FLASH_ATTENTION y KV q8_0) → Whisper → Piper → backend (si no está)
  solo-registro      pausa el chat para liberar RAM y GPU: descarga el modelo y apaga Ollama, Whisper y Piper.
                     El backend sigue: la app registra, sincroniza y manda avisos; el chat responde que está en pausa.
  reanudar-chat      igual que levantar; el backend NO se reinicia (carga el modelo con el primer mensaje)
  reiniciar-backend  detiene el backend y lo vuelve a crear (arranca con o sin Ollama)
  iniciar | detener | reiniciar <servicio>
                     un servicio solo: ollama, whisper, piper, backend, o chat (los tres del chat juntos).
                     Es lo que usan los botones de Sistema en el Modo AXS de la app (services/ServiceControl.ts).

Todo se crea con WMI (Win32_Process Create): así no muere cuando se cierra o reinicia la sesión que lo lanzó
(incidente del 2026-10-06). Solo toca procesos de Eris (Ollama, whisper-server, Piper y el backend de Bun).
El log del backend queda en %USERPROFILE%\.eris\logs\servidor.log.
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('estado', 'levantar', 'solo-registro', 'reanudar-chat', 'reiniciar-backend', 'iniciar', 'detener', 'reiniciar')]
  [string]$Accion = 'estado',
  [Parameter(Position = 1)]
  [ValidateSet('ollama', 'whisper', 'piper', 'backend', 'chat')]
  [string]$Servicio = 'chat'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$LogDir = Join-Path $env:USERPROFILE '.eris\logs'
$Log = Join-Path $LogDir 'servidor.log'
$OllamaApp = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama app.exe'
$Ports = [ordered]@{ 'Ollama (modelo)' = 11434; 'Whisper (dictado)' = 8081; 'Piper (voz)' = 5001; 'Backend Eris' = 3000 }

function Listening([int]$port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }

function Wait-Port([int]$port, [int]$seconds, [string]$name) {
  for ($t = 0; $t -lt $seconds; $t++) { if (Listening $port) { Write-Host "  ✓ $name escucha en $port"; return $true }; Start-Sleep -Seconds 1 }
  Write-Host "  ✗ $name no respondió en $seconds s (puerto $port)"; return $false
}

function Start-Wmi([string]$commandLine) {
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $commandLine; CurrentDirectory = $Root }
  if ($r.ReturnValue -ne 0) { throw "WMI no pudo crear el proceso (código $($r.ReturnValue)): $commandLine" }
}

function Eris-Processes {
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'ollama app.exe' -or $_.Name -eq 'ollama.exe' -or
    ($_.Name -eq 'whisper-server.exe') -or
    ($_.Name -eq 'python.exe' -and $_.CommandLine -match 'piper\.http_server') -or
    ($_.Name -eq 'bun.exe' -and $_.CommandLine -match 'src[\\/]server\.ts')
  }
}

function Show-Estado {
  Write-Host "`nServicios de Eris"
  foreach ($k in $Ports.Keys) { Write-Host ("  {0,-20} {1}" -f $k, $(if (Listening $Ports[$k]) { "arriba ($($Ports[$k]))" } else { 'apagado' })) }
  try {
    $ps = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3
    if ($ps.models) { $ps.models | ForEach-Object { Write-Host ("  Modelo cargado: {0} ({1:N0} MB en GPU)" -f $_.name, ($_.size_vram / 1MB)) } }
    else { Write-Host '  Modelo cargado: ninguno (se carga con el primer mensaje del chat)' }
  } catch { Write-Host '  Modelo cargado: — (Ollama apagado: el chat está en pausa)' }
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    $g = (& nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader) -join ' '
    Write-Host "  GPU en uso: $g"
  }
  $os = Get-CimInstance Win32_OperatingSystem
  Write-Host ("  RAM libre: {0:N1} de {1:N1} GB" -f ($os.FreePhysicalMemory / 1MB), ($os.TotalVisibleMemorySize / 1MB))
  Eris-Processes | ForEach-Object { Write-Host ("  · {0,-16} pid {1,-6} {2,6:N0} MB" -f $_.Name, $_.ProcessId, ($_.WorkingSetSize / 1MB)) }
}

function Start-Ollama {
  if (Listening 11434) { Write-Host '  Ollama ya estaba arriba (si se lanzó solo con Windows, corre sin los ajustes de memoria)'; return }
  # Los ajustes valen solo para este proceso: se pierden si Ollama o el PC se reinician
  Start-Wmi ('cmd /c "set "OLLAMA_FLASH_ATTENTION=1" && set "OLLAMA_KV_CACHE_TYPE=q8_0" && start "" "' + $OllamaApp + '""')
  [void](Wait-Port 11434 40 'Ollama')
}

function Start-Whisper {
  if (Listening 8081) { Write-Host '  Whisper ya estaba arriba'; return }
  Start-Wmi ('cmd /c "' + (Join-Path $Root 'whisper\start-whisper-server.bat') + '"')
  [void](Wait-Port 8081 90 'Whisper')
}

function Start-Piper {
  if (Listening 5001) { Write-Host '  Piper ya estaba arriba'; return }
  Start-Wmi ('cmd /c python -m piper.http_server -m es_AR-daniela-high --data-dir "' + (Join-Path $Root 'piper\voices') + '" --port 5001')
  [void](Wait-Port 5001 60 'Piper')
}

function Start-Backend {
  if (Listening 3000) { Write-Host '  El backend ya estaba arriba'; return }
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Start-Wmi ('cmd /c "bun run src/server.ts > "' + $Log + '" 2>&1"')
  if (Wait-Port 3000 60 'Backend') {
    $ready = Select-String -Path $Log -Pattern 'Modelo precargado|chat queda en pausa' -ErrorAction SilentlyContinue | Select-Object -Last 1
    if ($ready) { Write-Host "  log: $($ready.Line.Trim())" }
  } else { Write-Host "  Revisa el log: $Log" }
}

function Stop-Backend {
  $b = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'bun.exe' -and $_.CommandLine -match 'src[\\/]server\.ts' }
  foreach ($p in $b) { Stop-Process -Id $p.ProcessId -Force; Write-Host "  backend detenido (pid $($p.ProcessId))" }
  for ($t = 0; $t -lt 10 -and (Listening 3000); $t++) { Start-Sleep -Seconds 1 }
}

function Stop-Matching([scriptblock]$filter, [int]$port) {
  $procs = Get-CimInstance Win32_Process | Where-Object $filter
  foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host "  detenido: $($p.Name) (pid $($p.ProcessId))" } catch {} }
  for ($t = 0; $t -lt 10 -and (Listening $port); $t++) { Start-Sleep -Seconds 1 }
}

function Stop-Ollama {
  # Descargar el modelo de la GPU de forma ordenada
  try {
    $ps = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/ps' -TimeoutSec 3
    foreach ($m in $ps.models) {
      Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -TimeoutSec 30 `
        -Body (@{ model = $m.name; keep_alive = 0 } | ConvertTo-Json) | Out-Null
      Write-Host "  modelo descargado: $($m.name)"
    }
  } catch {}
  # Primero el ícono de la bandeja: si no, vuelve a levantar el servidor
  Stop-Matching { $_.Name -eq 'ollama app.exe' } 0
  Stop-Matching { $_.Name -eq 'ollama.exe' } 11434
}
function Stop-Whisper { Stop-Matching { $_.Name -eq 'whisper-server.exe' } 8081 }
function Stop-Piper { Stop-Matching { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'piper\.http_server' } 5001 }

function Pause-Chat {
  # Apagar Ollama, Whisper y Piper; el backend sigue (o se levanta): el registro no depende del modelo
  Stop-Ollama; Stop-Whisper; Stop-Piper
  Start-Backend
}

function Invoke-Servicio([string]$verbo, [string]$cual) {
  $start = @{ ollama = { Start-Ollama }; whisper = { Start-Whisper }; piper = { Start-Piper }; backend = { Start-Backend }; chat = { Start-Ollama; Start-Whisper; Start-Piper } }
  $stop = @{ ollama = { Stop-Ollama }; whisper = { Stop-Whisper }; piper = { Stop-Piper }; backend = { Stop-Backend }; chat = { Stop-Ollama; Stop-Whisper; Stop-Piper } }
  if ($verbo -in 'detener', 'reiniciar') { & $stop[$cual] }
  if ($verbo -in 'iniciar', 'reiniciar') { & $start[$cual] }
}

switch ($Accion) {
  'estado' { Show-Estado }
  { $_ -in 'levantar', 'reanudar-chat' } {
    Write-Host 'Levantando (orden: Ollama → Whisper → Piper → backend)…'
    Start-Ollama; Start-Whisper; Start-Piper; Start-Backend
    Show-Estado
  }
  'solo-registro' { Write-Host 'Pausando el chat (el registro sigue)…'; Pause-Chat; Show-Estado }
  'reiniciar-backend' { Write-Host 'Reiniciando el backend…'; Stop-Backend; Start-Backend; Show-Estado }
  { $_ -in 'iniciar', 'detener', 'reiniciar' } { Write-Host "$Accion $Servicio…"; Invoke-Servicio $Accion $Servicio; Show-Estado }
}
