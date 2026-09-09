# Извлекает белый знак TLS из фирменного фото в альфа-маску PNG.
param(
  [string]$Source = "public/images/hero-tls.png",
  [int]$Threshold = 235,
  [int]$MaxChannelSpread = 26,
  [string]$PreviewOut = "",
  [string]$MaskOut = "",
  [int]$CropX = -1,
  [int]$CropY = -1,
  [int]$CropW = -1,
  [int]$CropH = -1
)

Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path (Get-Location) $Source
$bmp = New-Object System.Drawing.Bitmap($srcPath)
$w = $bmp.Width
$h = $bmp.Height

$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$bytes = New-Object byte[] ($stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)
$bmp.Dispose()

# mask[y * w + x] = 1, если пиксель почти белый (нейтральный и яркий)
$mask = New-Object byte[] ($w * $h)
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
      $mask[$y * $w + $x] = 1
    }
  }
}

# Текстовая карта: где именно попадают белые пиксели
$cols = 64
$rows = 32
$cellW = [Math]::Ceiling($w / $cols)
$cellH = [Math]::Ceiling($h / $rows)
$chars = " .:-=+*#%@"
$lines = @()
for ($ry = 0; $ry -lt $rows; $ry++) {
  $line = ""
  for ($rx = 0; $rx -lt $cols; $rx++) {
    $hit = 0
    $total = 0
    for ($y = $ry * $cellH; $y -lt [Math]::Min(($ry + 1) * $cellH, $h); $y++) {
      for ($x = $rx * $cellW; $x -lt [Math]::Min(($rx + 1) * $cellW, $w); $x++) {
        $total++
        $hit += $mask[$y * $w + $x]
      }
    }
    $ratio = if ($total -gt 0) { $hit / $total } else { 0 }
    $idx = [Math]::Min([int][Math]::Floor($ratio * ($chars.Length - 1) * 1.6), $chars.Length - 1)
    $line += $chars[$idx]
  }
  $lines += $line
}
Write-Output "size: ${w}x${h}  cell: ${cellW}x${cellH}"
$lines | ForEach-Object { Write-Output $_ }

if ($PreviewOut -ne "") {
  $out = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $on = $mask[$y * $w + $x] -eq 1
      $c = if ($on) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::White }
      $out.SetPixel($x, $y, $c)
    }
  }
  $out.Save((Join-Path (Get-Location) $PreviewOut), [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Output "preview: $PreviewOut"
}

if ($MaskOut -ne "" -and $CropW -gt 0) {
  $out = New-Object System.Drawing.Bitmap($CropW, $CropH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $CropH; $y++) {
    for ($x = 0; $x -lt $CropW; $x++) {
      $sx = $CropX + $x
      $sy = $CropY + $y
      $on = $false
      if ($sx -ge 0 -and $sx -lt $w -and $sy -ge 0 -and $sy -lt $h) {
        $on = $mask[$sy * $w + $sx] -eq 1
      }
      $c = if ($on) {
        [System.Drawing.Color]::FromArgb(255, 0, 0, 0)
      }
      else {
        [System.Drawing.Color]::FromArgb(0, 0, 0, 0)
      }
      $out.SetPixel($x, $y, $c)
    }
  }
  $out.Save((Join-Path (Get-Location) $MaskOut), [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  Write-Output "mask: $MaskOut (${CropW}x${CropH})"
}
