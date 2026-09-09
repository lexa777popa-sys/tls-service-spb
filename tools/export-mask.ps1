# Выгружает бинарную маску знака (0/1 по пикселю) в текстовый файл для векторизации.
param(
  [string]$Source = "public/images/hero-tls.png",
  [int]$Threshold = 235,
  [int]$MaxChannelSpread = 26,
  [int]$Top = 236,
  [int]$Bottom = 371,
  [int]$Pad = 2,
  [string]$Out = "tools/mask.txt"
)

Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap((Join-Path (Get-Location) $Source))
$w = $bmp.Width
$h = $bmp.Height
$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)
$bmp.Dispose()

function Test-White([int]$x, [int]$y) {
  $i = $y * $stride + $x * 4
  $b = $script:bytes[$i]
  $g = $script:bytes[$i + 1]
  $r = $script:bytes[$i + 2]
  $min = [Math]::Min($r, [Math]::Min($g, $b))
  $max = [Math]::Max($r, [Math]::Max($g, $b))
  return ($min -ge $script:Threshold -and ($max - $min) -le $script:MaxChannelSpread)
}

$minX = $w
$maxX = -1
for ($y = $Top; $y -le $Bottom; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    if (Test-White $x $y) {
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
    }
  }
}

$x0 = [Math]::Max($minX - $Pad, 0)
$x1 = [Math]::Min($maxX + $Pad, $w - 1)
$y0 = [Math]::Max($Top - $Pad, 0)
$y1 = [Math]::Min($Bottom + $Pad, $h - 1)
$cw = $x1 - $x0 + 1
$ch = $y1 - $y0 + 1

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine("$cw $ch")
for ($y = $y0; $y -le $y1; $y++) {
  $line = New-Object System.Text.StringBuilder
  for ($x = $x0; $x -le $x1; $x++) {
    [void]$line.Append((&{ if (Test-White $x $y) { "1" } else { "0" } }))
  }
  [void]$sb.AppendLine($line.ToString())
}
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $Out), $sb.ToString())

Write-Output "bbox: x=$x0..$x1 y=$y0..$y1 size=${cw}x${ch} -> $Out"
