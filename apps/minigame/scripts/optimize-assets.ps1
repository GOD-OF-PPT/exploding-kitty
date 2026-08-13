$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$repository = Resolve-Path (Join-Path $root "..\..")
$source = Join-Path $repository "prototype\public\assets"
$output = Join-Path $root "assets"

$assets = @(
  @{ File = "cat-cast.png"; Geometry = "960x300>" },
  @{ File = "cards/attack.png"; Geometry = "220x520>" },
  @{ File = "cards/card-back.png"; Geometry = "300x700>" },
  @{ File = "cards/danger.png"; Geometry = "300x700>" },
  @{ File = "cards/defuse.png"; Geometry = "220x520>" },
  @{ File = "cards/peek.png"; Geometry = "220x520>" },
  @{ File = "cards/reverse.png"; Geometry = "220x520>" },
  @{ File = "cards/shuffle.png"; Geometry = "220x520>" },
  @{ File = "cards/skip.png"; Geometry = "220x520>" },
  @{ File = "cats/a-ju.png"; Geometry = "220x400>" },
  @{ File = "cats/player.png"; Geometry = "220x400>" },
  @{ File = "cats/tuan-zi.png"; Geometry = "240x300>" },
  @{ File = "cats/xiao-hui.png"; Geometry = "240x300>" }
)

foreach ($asset in $assets) {
  $inputPath = Join-Path $source $asset.File
  $outputPath = Join-Path $output $asset.File
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath) | Out-Null
  & magick $inputPath -resize $asset.Geometry -strip -define png:compression-level=9 -define png:compression-filter=5 $outputPath
  if ($LASTEXITCODE -ne 0) { throw "ImageMagick failed for $($asset.File)" }
}

Write-Host "Optimized $($assets.Count) mini-game assets without modifying prototype sources."
