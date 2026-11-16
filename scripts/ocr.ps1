<#
  Eris — leer el texto de una imagen con el OCR que trae Windows (Windows.Media.Ocr), sin internet ni descargas.
  Lo usa el servidor para la foto de la boleta (src/services/ReceiptOcr.ts). Escribe JSON por la salida estándar:
    { "ok": true, "lang": "es-ES", "angle": 0.4, "lines": [ { "text": "...", "words": [ { "t": "...", "x": 1, "y": 2, "w": 3, "h": 4 } ] } ] }
  La imagen la borra el servidor apenas termina.
#>
param([Parameter(Mandatory = $true)][string]$Path, [switch]$Mejorar)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
  # -Mejorar (2026-11-16): la segunda lectura, en gris, con más contraste y a 2000 px de ancho. Con la foto de la app (grande y
  # comprimida) el OCR leía mal el pie de la boleta del Jumbo; mejorada, cuadró en 5 de 8 variantes donde la original no.
  # La copia queda junto a la original (en la carpeta temporal que el servidor borra al terminar).
  if ($Mejorar) {
    Add-Type -AssemblyName System.Drawing
    $src = [System.Drawing.Image]::FromFile((Resolve-Path $Path).Path)
    $f = 2000 / $src.Width
    $w = [int]($src.Width * $f); $h = [int]($src.Height * $f)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $c = 1.5; $t = (1 - $c) / 2
    $m = New-Object System.Drawing.Imaging.ColorMatrix
    $m.Matrix00 = 0.299 * $c; $m.Matrix01 = 0.299 * $c; $m.Matrix02 = 0.299 * $c
    $m.Matrix10 = 0.587 * $c; $m.Matrix11 = 0.587 * $c; $m.Matrix12 = 0.587 * $c
    $m.Matrix20 = 0.114 * $c; $m.Matrix21 = 0.114 * $c; $m.Matrix22 = 0.114 * $c
    $m.Matrix33 = 1; $m.Matrix40 = $t; $m.Matrix41 = $t; $m.Matrix42 = $t; $m.Matrix44 = 1
    $ia = New-Object System.Drawing.Imaging.ImageAttributes
    $ia.SetColorMatrix($m)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
    $g.Dispose(); $src.Dispose()
    $Path = Join-Path (Split-Path (Resolve-Path $Path).Path) 'mejorada.png'
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
  }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

  # Esperar una operación asíncrona de WinRT desde PowerShell 5.1
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  function Await($op, [Type]$type) {
    $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
  }

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Path).Path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $lang = $null
  foreach ($tag in @('es-CL', 'es-ES', 'es-MX', 'es-419')) {
    $l = New-Object Windows.Globalization.Language $tag
    if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($l)) { $lang = $l; break }
  }
  $engine = if ($lang) { [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) } else { [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { throw 'sin motor de OCR en español' }

  $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($ln in $res.Lines) {
    $words = @()
    foreach ($w in $ln.Words) {
      $r = $w.BoundingRect
      $words += [ordered]@{ t = $w.Text; x = [math]::Round($r.X, 1); y = [math]::Round($r.Y, 1); w = [math]::Round($r.Width, 1); h = [math]::Round($r.Height, 1) }
    }
    $lines += [ordered]@{ text = $ln.Text; words = $words }
  }
  $angle = if ($res.TextAngle -ne $null) { [double]$res.TextAngle } else { 0 }
  $out = [ordered]@{ ok = $true; lang = $engine.RecognizerLanguage.LanguageTag; angle = $angle; width = $bitmap.PixelWidth; height = $bitmap.PixelHeight; lines = $lines }
  $stream.Dispose()
  [Console]::Out.Write(($out | ConvertTo-Json -Depth 6 -Compress))
} catch {
  [Console]::Out.Write((@{ ok = $false; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress))
}
