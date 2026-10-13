# Zeichnet die Oregano-Icons (PNG) nach. Auf dem Rechner gibt es keinen SVG-Renderer, deshalb
# wird das Logo (siehe www/icons/icon.svg) hier mit System.Drawing nachgebaut.
# Aufruf:  powershell -ExecutionPolicy Bypass -File tools/icons.ps1
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$green = [System.Drawing.ColorTranslator]::FromHtml('#2e7d32')
$cream = [System.Drawing.ColorTranslator]::FromHtml('#f4fbf4')

# Blatt-Geometrie im 64er-Raster: Mittelpunkt x, y, Radien rx, ry, Drehwinkel
$leaves = @(
  @(22, 41, 9, 5, -38), @(43, 39, 9, 5, 38), @(23, 28, 8, 4.4, -38), @(42, 26, 8, 4.4, 38), @(33, 14, 4.2, 7.5, 8)
)

function Draw-Leaf($g, [float]$cx, [float]$cy, [float]$s, [float]$ox, [float]$oy, $brush, $penColor) {
  # $s = Pixel je Rasterpunkt; ($ox,$oy) = Verschiebung des Rasters in Pixeln
  $pen = New-Object System.Drawing.Pen($penColor, [float](2.6 * $s))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $g.DrawBezier($pen, [float]($ox + 31 * $s), [float]($oy + 54 * $s), [float]($ox + 31 * $s), [float]($oy + 44 * $s), [float]($ox + 31.6 * $s), [float]($oy + 32 * $s), [float]($ox + 32.8 * $s), [float]($oy + 20 * $s))
  foreach ($l in $leaves) {
    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.RotateAt([float]$l[4], (New-Object System.Drawing.PointF([float]($ox + $l[0] * $s), [float]($oy + $l[1] * $s))))
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddEllipse([float]($ox + ($l[0] - $l[2]) * $s), [float]($oy + ($l[1] - $l[3]) * $s), [float](2 * $l[2] * $s), [float](2 * $l[3] * $s))
    $gp.Transform($m)
    $g.FillPath($brush, $gp)
  }
}

function New-Icon([string]$path, [int]$size, [string]$mode, [double]$scale, $bg, $fg) {
  # mode: round = abgerundetes Quadrat, full = randlos, transparent = nur Blatt auf Transparenz, splash = Fläche mit zentriertem Logo
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $brushBg = New-Object System.Drawing.SolidBrush($bg)
  if ($mode -eq 'round') {
    $r = $size * 14 / 64
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90); $gp.AddArc($size - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
    $gp.AddArc($size - 2 * $r, $size - 2 * $r, 2 * $r, 2 * $r, 0, 90); $gp.AddArc(0, $size - 2 * $r, 2 * $r, 2 * $r, 90, 90); $gp.CloseFigure()
    $g.FillPath($brushBg, $gp)
  } elseif ($mode -eq 'full' -or $mode -eq 'splash') { $g.Clear($bg) }
  $unit = $size / 64.0
  if ($mode -eq 'splash') { $unit = ($size * 0.22) / 64.0 }
  $s = $unit * $scale
  $ox = ($size - 64 * $s) / 2; $oy = ($size - 64 * $s) / 2
  if ($mode -eq 'splash') {   # kleines Logo-Quadrat in der Mitte
    $box = 64 * $s; $r = $box * 14 / 64
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc($ox, $oy, 2 * $r, 2 * $r, 180, 90); $gp.AddArc($ox + $box - 2 * $r, $oy, 2 * $r, 2 * $r, 270, 90)
    $gp.AddArc($ox + $box - 2 * $r, $oy + $box - 2 * $r, 2 * $r, 2 * $r, 0, 90); $gp.AddArc($ox, $oy + $box - 2 * $r, 2 * $r, 2 * $r, 90, 90); $gp.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush($green)), $gp)
  }
  Draw-Leaf $g 0 0 $s $ox $oy (New-Object System.Drawing.SolidBrush($fg)) $fg
  $g.Dispose()
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "OK $path"
}

$ic = Join-Path $root 'www/icons'
New-Icon "$ic/icon-192.png" 192 round 1.0 $green $cream
New-Icon "$ic/icon-512.png" 512 round 1.0 $green $cream
New-Icon "$ic/icon-maskable-512.png" 512 full 0.9 $green $cream
New-Icon "$ic/apple-touch-icon.png" 180 full 0.96 $green $cream
New-Icon "$ic/favicon-32.png" 32 round 1.0 $green $cream

$as = Join-Path $root 'assets'
New-Icon "$as/icon-only.png" 1024 full 0.92 $green $cream
New-Icon "$as/icon-foreground.png" 1024 transparent 0.78 $green $cream
New-Icon "$as/icon-background.png" 1024 full 0.0001 $green $green
New-Icon "$as/splash.png" 2732 splash 1.0 ([System.Drawing.ColorTranslator]::FromHtml('#f4f6f4')) $cream
New-Icon "$as/splash-dark.png" 2732 splash 1.0 ([System.Drawing.ColorTranslator]::FromHtml('#131514')) $cream
