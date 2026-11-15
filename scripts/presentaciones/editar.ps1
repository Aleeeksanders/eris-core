param([string]$Entrada, [string]$Plan, [string]$Salida, [string]$CarpetaPng = "")
# Edits a .pptx through PowerPoint COM following a JSON plan (UTF-8). Keeps animations: duplicated slides keep their timeline.
# References: "oN" = original slide N (resolved by SlideID before any change); any other name = alias from a "dup" op.
$ErrorActionPreference = 'Stop'
$planObj = Get-Content -Raw -Encoding UTF8 $Plan | ConvertFrom-Json
if (-not $planObj.ops) { throw "el plan no tiene operaciones" }
Copy-Item $Entrada $Salida -Force
$pp = New-Object -ComObject PowerPoint.Application
$pres = $pp.Presentations.Open($Salida, $false, $false, $false)
$ids = @{}
foreach ($s in $pres.Slides) { $ids["o$($s.SlideIndex)"] = $s.SlideID }
function L($ref) { if (-not $ids.ContainsKey($ref)) { throw "referencia desconocida: $ref" }; return $pres.Slides.FindBySlideID($ids[$ref]) }
function F($ref, $name) { $sl = L $ref; try { return $sl.Shapes.Item($name) } catch { throw "no existe la forma '$name' en $ref" } }
function CopiarFuente($src, $dst) {
  # El color de todo el rango puede venir «mezclado»: se toma el del primer carácter
  $a = $src.TextFrame.TextRange.Characters(1, 1).Font; $b = $dst.TextFrame.TextRange.Font
  $b.Name = $a.Name; $b.Size = [single]$a.Size; $b.Bold = $a.Bold; $b.Color.RGB = [int]$a.Color.RGB
  # Y el interlineado del párrafo
  $pa = $src.TextFrame.TextRange.Paragraphs(1).ParagraphFormat; $pb = $dst.TextFrame.TextRange.ParagraphFormat
  try { $pb.LineRuleWithin = $pa.LineRuleWithin; $pb.SpaceWithin = [single]$pa.SpaceWithin } catch {}
}
$log = New-Object System.Collections.ArrayList
try {
  $paso = 0
  foreach ($op in $planObj.ops) {
    $paso++
    $donde = "paso $paso ($($op.op) $($op.ref) $($op.forma))"
    try {
    switch ($op.op) {
      'texto' {
        $s = F $op.ref $op.forma
        $s.TextFrame.TextRange.Text = $op.t
      }
      'reemplazar' {
        $s = F $op.ref $op.forma
        $r = $s.TextFrame.TextRange.Replace($op.de, $op.a)
        if ($null -eq $r) { [void]$log.Add("no encontre '$($op.de)' en $($op.ref)/$($op.forma)") }
      }
      'dup' {
        $src = L $op.de
        $nueva = $src.Duplicate()
        $ids[$op.como] = $nueva.Item(1).SlideID
      }
      'pos' {
        $s = F $op.ref $op.forma
        if ($null -ne $op.left) { $s.Left = [single]$op.left }
        if ($null -ne $op.top) { $s.Top = [single]$op.top }
        if ($null -ne $op.width) { $s.Width = [single]$op.width }
        if ($null -ne $op.height) { $s.Height = [single]$op.height }
        if ($null -ne $op.rotacion) { $s.Rotation = [single]$op.rotacion }
      }
      'clonar' {
        # Copia una forma en la misma lámina, con nombre y posición nuevos
        $s = F $op.ref $op.forma
        $c = $s.Duplicate().Item(1)
        $c.Name = $op.como
        # PowerPoint copia también la animación del original: la copia parte sin ninguna
        $seq = (L $op.ref).TimeLine.MainSequence
        for ($i = $seq.Count; $i -ge 1; $i--) { if ($seq.Item($i).Shape.Name -eq $c.Name) { $seq.Item($i).Delete() } }
        if ($null -ne $op.left) { $c.Left = [single]$op.left }
        if ($null -ne $op.top) { $c.Top = [single]$op.top }
        if ($null -ne $op.width) { $c.Width = [single]$op.width }
        if ($null -ne $op.height) { $c.Height = [single]$op.height }
        if ($null -ne $op.rotacion) { $c.Rotation = [single]$op.rotacion }
        if ($null -ne $op.t) { $c.TextFrame.TextRange.Text = $op.t }
      }
      'tiempo' {
        # Cambia cuándo aparece una forma que ya tiene animación
        $seq = (L $op.ref).TimeLine.MainSequence
        for ($i = 1; $i -le $seq.Count; $i++) { $e = $seq.Item($i); if ($e.Shape.Name -eq $op.forma) { $e.Timing.TriggerDelayTime = [single]$op.retraso } }
      }
      'alinear' {
        $s = F $op.ref $op.forma
        $s.TextFrame.TextRange.ParagraphFormat.Alignment = [int]$op.valor   # 1 izquierda, 2 centro, 3 derecha
      }
      'tamano' {
        $s = F $op.ref $op.forma
        $s.TextFrame.TextRange.Font.Size = [double]$op.valor
      }
      'borrar' {
        foreach ($n in $op.formas) { (F $op.ref $n).Delete() }
      }
      'desplazar' {
        $sl = L $op.ref
        foreach ($s in $sl.Shapes) { if ($s.Top -ge $op.desde -and $s.Top -lt $op.hasta) { $s.Top = [single]($s.Top + $op.dy) } }
      }
      'fuente' {
        $src = F $op.ref $op.de
        foreach ($n in $op.a) { CopiarFuente $src (F $op.ref $n) }
      }
      'linea' {
        $refDe = $op.ref; if ($op.deRef) { $refDe = $op.deRef }
        $a = F $refDe $op.de; $b = F $op.ref $op.a
        $b.Line.Visible = $a.Line.Visible; $b.Line.ForeColor.RGB = [int]$a.Line.ForeColor.RGB; $b.Line.Weight = [single]$a.Line.Weight
        $b.Line.Transparency = [single]$a.Line.Transparency
        $b.Fill.ForeColor.RGB = [int]$a.Fill.ForeColor.RGB; $b.Fill.Transparency = [single]$a.Fill.Transparency
      }
      'nota' {
        # Un texto nuevo con el formato de otro (de cualquier lámina): se copia la forma y se cambia el texto
        $src = F $op.copiarDe.ref $op.copiarDe.forma
        $dst = L $op.ref
        $nueva = $null
        try {
          $src.Copy()
          Start-Sleep -Milliseconds 150
          $nueva = $dst.Shapes.Paste().Item(1)
        } catch {
          $nueva = $dst.Shapes.AddTextbox(1, $src.Left, $src.Top, $src.Width, $src.Height)
          CopiarFuente $src $nueva
        }
        $nueva.TextFrame.TextRange.Text = $op.t
        $nueva.Left = [single]$op.left; $nueva.Top = [single]$op.top
        if ($null -ne $op.width) { $nueva.Width = [single]$op.width }
        if ($op.nombre) { $nueva.Name = $op.nombre }
      }
      'tabla' {
        $tb = (F $op.ref $op.forma).Table
        for ($i = 0; $i -lt $op.celdas.Count; $i++) {
          for ($j = 0; $j -lt $op.celdas[$i].Count; $j++) { $tb.Cell($i + 1, $j + 1).Shape.TextFrame.TextRange.Text = $op.celdas[$i][$j] }
        }
        if ($op.anchos) { for ($j = 0; $j -lt $op.anchos.Count; $j++) { $tb.Columns.Item($j + 1).Width = [single]$op.anchos[$j] } }
      }
      'tablaFilas' {
        # Deja la tabla con `total` filas (agrega al final copiando el formato de la última, o quita desde el final)
        $tb = (F $op.ref $op.forma).Table
        while ($tb.Rows.Count -lt [int]$op.total) { [void]$tb.Rows.Add() }
        while ($tb.Rows.Count -gt [int]$op.total) { $tb.Rows.Item($tb.Rows.Count).Delete() }
      }
      'tablaMargen' {
        # Aire dentro de cada celda (en puntos), para que el texto no quede pegado a los bordes
        $tb = (F $op.ref $op.forma).Table
        for ($i = 1; $i -le $tb.Rows.Count; $i++) { for ($j = 1; $j -le $tb.Columns.Count; $j++) {
          $tf = $tb.Cell($i, $j).Shape.TextFrame
          $tf.MarginLeft = [single]$op.izq; $tf.MarginRight = [single]$op.der; $tf.MarginTop = [single]$op.arr; $tf.MarginBottom = [single]$op.aba
        } }
      }
      'animar' {
        # Agrega una animación a una forma (efecto 10 = desvanecer; disparo 2 = con la anterior, 3 = después de la anterior)
        $sl = L $op.ref; $s = F $op.ref $op.forma
        $e = $sl.TimeLine.MainSequence.AddEffect($s, [int]$op.efecto, 0, [int]$op.disparo)
        if ($null -ne $op.retraso) { $e.Timing.TriggerDelayTime = [single]$op.retraso }
        if ($null -ne $op.duracion) { $e.Timing.Duration = [single]$op.duracion }
      }
      'debajo' {
        # Pone formas debajo de otra (p. ej. las viñetas bajo una tabla que creció)
        $ref = F $op.ref $op.de
        $y = $ref.Top + $ref.Height + $op.espacio
        $base = (F $op.ref $op.formas[0]).Top
        $tops = @{}
        foreach ($n in $op.formas) { $tops[$n] = (F $op.ref $n).Top }
        foreach ($n in $op.formas) { (F $op.ref $n).Top = [single]($y + ($tops[$n] - $base)) }
      }
      'orden' {
        for ($i = 0; $i -lt $op.refs.Count; $i++) { (L $op.refs[$i]).MoveTo($i + 1) }
      }
      'pies' {
        foreach ($sl in $pres.Slides) {
          foreach ($s in $sl.Shapes) {
            if ($s.HasTextFrame -and $s.TextFrame.HasText -and ($null -eq $op.minTop -or $s.Top -ge $op.minTop)) {
              $t = $s.TextFrame.TextRange.Text
              if ($t -match $op.regex) { $s.TextFrame.TextRange.Text = ($op.formato -f $sl.SlideIndex) }
            }
          }
        }
      }
      default { throw "operacion desconocida: $($op.op)" }
    }
    } catch { throw "$donde : $($_.Exception.Message)" }
  }
  $pres.Save()
  if ($CarpetaPng) {
    New-Item -ItemType Directory -Force $CarpetaPng | Out-Null
    Get-ChildItem $CarpetaPng -Filter *.png | Remove-Item -Force
    foreach ($sl in $pres.Slides) { $sl.Export((Join-Path $CarpetaPng ("{0:D2}.png" -f $sl.SlideIndex)), 'PNG', 1280, 720) }
  }
  $resumen = foreach ($sl in $pres.Slides) { "{0:D2} anim {1}" -f $sl.SlideIndex, $sl.TimeLine.MainSequence.Count }
  "laminas: $($pres.Slides.Count)"
  $resumen -join ' | '
  if ($log.Count) { "avisos:"; $log }
} finally {
  $pres.Close()
  $pp.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pp)
}
