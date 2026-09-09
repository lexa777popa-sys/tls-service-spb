# Профиль белых пикселей: помогает найти границы знака и текстовых строк.
param(
  [string]$Source = "public/images/hero-tls.png",
  [int]$Threshold = 235,
  [int]$MaxChannelSpread = 26
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

$rowCount = New-Object int[] $h
$colCount = New-Object int[] $w
for ($y = 0; $y -lt $h; $y++) {
  $row = $y * $stride
  for ($x = 0; $x -lt $w; $x++) {
    $i = $row + $x * 4
    $b = $bytes[$i]
    $g = $bytes[$i + 1]
    $r = $bytes[$i + 2]
    $min = [Math]::Min($r, [Math]::Min($g, $b))
    $max = [Math]::Max($r, [Math]::Max($g, $b))
    if ($min -ge $Threshold -and ($max - $min) -le $MaxChannelSpread) {
      $rowCount[$y]++
      $colCount[$x]++
    }
  }
}

Write-Output "-- строки с белым (y: count) --"
for ($y = 0; $y -lt $h; $y++) {
  if ($rowCount[$y] -gt 0) { Write-Output "$y : $($rowCount[$y])" }
}
Write-Output "-- столбцы с белым (x: count) --"
for ($x = 0; $x -lt $w; $x++) {
  if ($colCount[$x] -gt 0) { Write-Output "$x : $($colCount[$x])" }
}
