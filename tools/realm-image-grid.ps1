param(
  [Parameter(Mandatory = $true)][ValidateSet('Crop4x4', 'Compose4x4', 'HasAlpha', 'ResizeSquare')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$InputPath,
  [string]$Items = '',
  [int]$Size = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Canvas([int]$width, [int]$height) {
  return [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

if ($Mode -eq 'HasAlpha') {
  $img = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $InputPath).Path)
  try {
    $hasAlphaFormat = (($img.PixelFormat -band [System.Drawing.Imaging.PixelFormat]::Alpha) -ne 0)
    $samples = @(
      $img.GetPixel(0, 0).A,
      $img.GetPixel($img.Width - 1, 0).A,
      $img.GetPixel(0, $img.Height - 1).A,
      $img.GetPixel($img.Width - 1, $img.Height - 1).A,
      $img.GetPixel([Math]::Min(8, $img.Width - 1), [Math]::Min(8, $img.Height - 1)).A
    )
    $hasTransparentSample = ($samples | Where-Object { $_ -lt 250 }).Count -gt 0
    Write-Output (($hasAlphaFormat -and $hasTransparentSample).ToString().ToLowerInvariant())
  } finally { $img.Dispose() }
  return
}

if ($Mode -eq 'ResizeSquare') {
  if ($Size -lt 32) { throw 'ResizeSquare requires -Size of at least 32.' }
  $resolved = (Resolve-Path -LiteralPath $InputPath).Path
  $src = [System.Drawing.Bitmap]::FromFile($resolved)
  try {
    $dst = New-Canvas $Size $Size
    try {
      $g = [System.Drawing.Graphics]::FromImage($dst)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.DrawImage($src, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size))
      } finally { $g.Dispose() }
      $tmp = "$resolved.resize.png"
      $dst.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $dst.Dispose() }
  } finally { $src.Dispose() }
  Move-Item -LiteralPath $tmp -Destination $resolved -Force
  return
}

$paths = @($Items -split '\|' | Where-Object { $_ })
if ($paths.Count -gt 16) { throw 'A 4x4 grid accepts at most 16 paths.' }

if ($Mode -eq 'Crop4x4') {
  $src = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $InputPath).Path)
  try {
    for ($i = 0; $i -lt $paths.Count; $i++) {
      $row = [Math]::Floor($i / 4); $col = $i % 4
      $x0 = [Math]::Floor($col * $src.Width / 4); $x1 = [Math]::Floor(($col + 1) * $src.Width / 4)
      $y0 = [Math]::Floor($row * $src.Height / 4); $y1 = [Math]::Floor(($row + 1) * $src.Height / 4)
      $inset = 2
      $rect = [System.Drawing.Rectangle]::new($x0 + $inset, $y0 + $inset, ($x1 - $x0) - 2 * $inset, ($y1 - $y0) - 2 * $inset)
      $dst = New-Canvas 768 768
      try {
        $g = [System.Drawing.Graphics]::FromImage($dst)
        try {
          $g.Clear([System.Drawing.Color]::Transparent)
          $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
          $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
          $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
          $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
          $g.DrawImage($src, [System.Drawing.Rectangle]::new(0, 0, 768, 768), $rect, [System.Drawing.GraphicsUnit]::Pixel)
        } finally { $g.Dispose() }
        $target = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $paths[$i]))
        [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
        $dst.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $dst.Dispose() }
    }
  } finally { $src.Dispose() }
  return
}

if ($Mode -eq 'Compose4x4') {
  $target = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $InputPath))
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
  $dst = New-Canvas 1256 1256
  try {
    $g = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $g.Clear([System.Drawing.Color]::FromArgb(255, 16, 18, 30))
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      for ($i = 0; $i -lt $paths.Count; $i++) {
        $img = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $paths[$i]).Path)
        try {
          $row = [Math]::Floor($i / 4); $col = $i % 4
          $g.DrawImage($img, [System.Drawing.Rectangle]::new($col * 314 + 2, $row * 314 + 2, 310, 310))
        } finally { $img.Dispose() }
      }
    } finally { $g.Dispose() }
    $dst.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $dst.Dispose() }
}
