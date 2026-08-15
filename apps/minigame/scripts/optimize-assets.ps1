param(
  [string] $AssetsRoot = "",
  [switch] $CardsOnly
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$resolvedAssetsRoot = if ([string]::IsNullOrWhiteSpace($AssetsRoot)) {
  Join-Path $root "assets"
} else {
  [IO.Path]::GetFullPath($AssetsRoot)
}
if (-not (Test-Path -LiteralPath $resolvedAssetsRoot -PathType Container)) {
  throw "Asset root does not exist: $resolvedAssetsRoot"
}
$magick = (Get-Command magick -ErrorAction Stop).Source
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$staging = Join-Path $tempRoot ("exploding-kitty-assets-" + [guid]::NewGuid().ToString("N"))
$stagingFullPath = [IO.Path]::GetFullPath($staging)
if (-not $stagingFullPath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Asset staging directory escaped the system temp directory."
}
New-Item -ItemType Directory -Force -Path $stagingFullPath | Out-Null

function Invoke-Magick([string[]] $Arguments, [string] $Description) {
  & $magick @Arguments
  if ($LASTEXITCODE -ne 0) { throw "ImageMagick failed while $Description." }
}

function Get-RasterGeometry([string] $Path) {
  $actual = (& $magick identify -format "%w %h" $Path).Trim()
  if ($LASTEXITCODE -ne 0 -or $actual -notmatch "^(\d+) (\d+)$") {
    throw "ImageMagick could not read raster geometry for $Path."
  }
  $width = [long]$Matches[1]
  $height = [long]$Matches[2]
  return [pscustomobject]@{ Width = $width; Height = $height; Text = "$($width)x$($height)" }
}

function Assert-Geometry([string] $Path, [string] $Expected) {
  $actual = Get-RasterGeometry $Path
  if ($actual.Text -ne $Expected) {
    throw "Unexpected geometry for $Path`: expected $Expected, received $($actual.Text)."
  }
}

function Assert-CardSourceGeometry([string] $Path, $Geometry) {
  if ($Geometry.Width -lt 658 -or $Geometry.Height -lt 940) {
    throw "CARD_SOURCE_DENSITY_INSUFFICIENT:$Path`:$($Geometry.Text):658x940"
  }
  if ($Geometry.Width * 10 -ne $Geometry.Height * 7) {
    throw "CARD_SOURCE_ASPECT_INVALID:$Path`:$($Geometry.Text):7x10"
  }
}

try {
  # The high-resolution mini-game assets are now the source of truth. Never
  # import the legacy prototype files, whose 220px card derivatives are too
  # small for the production DPR contract.
  $cardFiles = @(Get-ChildItem -LiteralPath (Join-Path $resolvedAssetsRoot "cards") -Filter "*.png" -File)
  if ($cardFiles.Count -eq 0) { throw "No card PNG files found in $resolvedAssetsRoot." }
  foreach ($card in $cardFiles) {
    $sourceGeometry = Get-RasterGeometry $card.FullName
    Assert-CardSourceGeometry $card.FullName $sourceGeometry
    if ($sourceGeometry.Text -eq "658x940") { continue }

    $target = Join-Path $stagingFullPath $card.Name
    Invoke-Magick @(
      $card.FullName,
      "-filter", "Lanczos",
      "-resize", "658x940",
      "-dither", "Riemersma",
      "-colors", "64",
      "-strip",
      "-define", "png:compression-level=9",
      "-define", "png:compression-filter=5",
      $target
    ) "downscaling $($card.Name) to the DPR3 card contract"

    $outputGeometry = Get-RasterGeometry $target
    if ($outputGeometry.Text -ne "658x940" -or $outputGeometry.Width * 10 -ne $outputGeometry.Height * 7) {
      throw "CARD_OUTPUT_GEOMETRY_INVALID:$($card.Name):$($outputGeometry.Text):658x940"
    }
    if ($outputGeometry.Width -gt $sourceGeometry.Width -or $outputGeometry.Height -gt $sourceGeometry.Height) {
      throw "CARD_OUTPUT_UPSCALE_FORBIDDEN:$($card.Name):$($sourceGeometry.Text):$($outputGeometry.Text)"
    }
    Move-Item -LiteralPath $target -Destination $card.FullName -Force
  }

  if (-not $CardsOnly) {
  $background = Join-Path $resolvedAssetsRoot "ui\backgrounds\comic-bg-390x844.jpg"
  Assert-Geometry $background "1170x2532"
  $backgroundQuality = [int]((& $magick identify -format "%Q" $background).Trim())
  if ($LASTEXITCODE -ne 0) { throw "ImageMagick could not inspect background quality." }
  if ($backgroundQuality -gt 82) {
    $target = Join-Path $stagingFullPath "comic-bg-390x844.jpg"
    Invoke-Magick @(
      $background,
      "-strip",
      "-quality", "82",
      "-sampling-factor", "4:4:4",
      "-interlace", "Plane",
      $target
    ) "encoding the comic background at q82 and 4:4:4"
    Assert-Geometry $target "1170x2532"
    Move-Item -LiteralPath $target -Destination $background -Force
  }

  foreach ($name in @("check-hero.png", "device-mobile-hero.png")) {
    $hero = Join-Path $resolvedAssetsRoot "ui\icons\cream\$name"
    Assert-Geometry $hero "320x320"
    $depth = [int]((& $magick identify -format "%z" $hero).Trim())
    if ($LASTEXITCODE -ne 0) { throw "ImageMagick could not inspect $name bit depth." }
    if ($depth -gt 8) {
      $target = Join-Path $stagingFullPath $name
      Invoke-Magick @(
        $hero,
        "-depth", "8",
        "-strip",
        "-define", "png:color-type=6",
        "-define", "png:compression-level=9",
        $target
      ) "normalizing $name to an 8-bit PNG"
      Assert-Geometry $target "320x320"
      Move-Item -LiteralPath $target -Destination $hero -Force
    }
  }

  foreach ($tone in @("cream", "ink")) {
    $cap = Join-Path $resolvedAssetsRoot "ui\icons\$tone\graduation-cap.png"
    $geometry = Get-RasterGeometry $cap
    if ($geometry.Text -eq "68x68") { continue }
    if ($geometry.Text -ne "64x64") { throw "Unexpected geometry for $cap`: $($geometry.Text)." }

    $target = Join-Path $stagingFullPath "graduation-cap-$tone.png"
    Invoke-Magick @(
      $cap,
      "-gravity", "center",
      "-background", "none",
      "-extent", "68x68",
      "-depth", "8",
      "-strip",
      "-define", "png:compression-level=9",
      "-define", "png:compression-filter=5",
      $target
    ) "adding a transparent safety margin to $tone graduation-cap.png"
    Assert-Geometry $target "68x68"
    Move-Item -LiteralPath $target -Destination $cap -Force
  }
  }
} finally {
  if (Test-Path -LiteralPath $stagingFullPath) {
    Remove-Item -LiteralPath $stagingFullPath -Recurse -Force
  }
}

Write-Host "Mini-game raster assets satisfy the high-resolution production contract."
