param([string]$Archivo, [string]$Salida, [string]$CarpetaPng = "", [int]$Ancho = 1280)
# Inventario de un .pptx por COM: cada lámina con sus formas (nombre, tipo, posición, texto, grupos) y cuántas animaciones tiene.
# Si se da CarpetaPng, exporta cada lámina como imagen para revisarla.
$ErrorActionPreference = 'Stop'
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open($Archivo, $true, $false, $false)  # solo lectura, sin ventana
try {
  $out = New-Object System.Collections.ArrayList
  function Formas($shapes, $prefijo) {
    $r = New-Object System.Collections.ArrayList
    foreach ($s in $shapes) {
      $t = ''
      try { if ($s.HasTextFrame -and $s.TextFrame.HasText) { $t = $s.TextFrame.TextRange.Text } } catch {}
      $o = [ordered]@{ n = $prefijo + $s.Name; id = $s.Id; tipo = [int]$s.Type; x = [math]::Round($s.Left); y = [math]::Round($s.Top); w = [math]::Round($s.Width); h = [math]::Round($s.Height); t = $t }
      [void]$r.Add($o)
      if ($s.Type -eq 6) { foreach ($x in (Formas $s.GroupItems ($prefijo + $s.Name + '/'))) { [void]$r.Add($x) } }
      if ($s.HasTable) {
        $tb = $s.Table
        for ($i = 1; $i -le $tb.Rows.Count; $i++) { for ($j = 1; $j -le $tb.Columns.Count; $j++) {
          [void]$r.Add([ordered]@{ n = "$($prefijo)$($s.Name)[$i,$j]"; t = $tb.Cell($i, $j).Shape.TextFrame.TextRange.Text }) } }
      }
    }
    return $r
  }
  foreach ($sl in $pres.Slides) {
    $anim = 0; try { $anim = $sl.TimeLine.MainSequence.Count } catch {}
    [void]$out.Add([ordered]@{ lamina = $sl.SlideIndex; layout = $sl.CustomLayout.Name; anim = $anim; transicion = [int]$sl.SlideShowTransition.EntryEffect; formas = (Formas $sl.Shapes '') })
    if ($CarpetaPng) { $sl.Export((Join-Path $CarpetaPng ("{0:D2}.png" -f $sl.SlideIndex)), 'PNG', $Ancho, [int]($Ancho * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)) }
  }
  [ordered]@{ ancho = $pres.PageSetup.SlideWidth; alto = $pres.PageSetup.SlideHeight; laminas = $out } | ConvertTo-Json -Depth 8 | Out-File -FilePath $Salida -Encoding utf8
} finally {
  $pres.Close()
  $pp.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp)
}
