$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "optimize-assets.ps1"
$magick = (Get-Command magick -ErrorAction Stop).Source
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixtureRoot = Join-Path $tempRoot ("exploding-kitty-optimize-test-" + [guid]::NewGuid().ToString("N"))
$fixtureFullPath = [IO.Path]::GetFullPath($fixtureRoot)
if (-not $fixtureFullPath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Optimizer test fixture escaped the system temp directory."
}

function New-CardFixture([string] $Name, [int] $Width, [int] $Height) {
  $assets = Join-Path $fixtureFullPath "$Name\assets"
  $cards = Join-Path $assets "cards"
  New-Item -ItemType Directory -Force -Path $cards | Out-Null
  $card = Join-Path $cards "attack.png"
  & $magick -size "$($Width)x$($Height)" "xc:#c7352d" -depth 8 $card
  if ($LASTEXITCODE -ne 0) { throw "Could not create $Name optimizer fixture." }
  return [pscustomobject]@{ Assets = $assets; Card = $card }
}

function Get-Geometry([string] $Path) {
  $geometry = (& $magick identify -format "%wx%h" $Path).Trim()
  if ($LASTEXITCODE -ne 0) { throw "Could not inspect optimizer fixture $Path." }
  return $geometry
}

function Assert-RejectedWithoutMutation([string] $Name, [int] $Width, [int] $Height, [string] $ErrorCode) {
  $fixture = New-CardFixture $Name $Width $Height
  $before = (Get-FileHash -LiteralPath $fixture.Card -Algorithm SHA256).Hash
  $caught = $null
  try {
    & $scriptPath -AssetsRoot $fixture.Assets -CardsOnly
  } catch {
    $caught = $_.Exception.Message
  }
  if ($null -eq $caught -or $caught -notmatch [regex]::Escape($ErrorCode)) {
    throw "Expected $Name to fail with $ErrorCode; received: $caught"
  }
  $after = (Get-FileHash -LiteralPath $fixture.Card -Algorithm SHA256).Hash
  if ($before -ne $after) { throw "Rejected fixture $Name was modified before validation completed." }
}

New-Item -ItemType Directory -Force -Path $fixtureFullPath | Out-Null
try {
  $compliant = New-CardFixture "compliant-840x1200" 840 1200
  & $scriptPath -AssetsRoot $compliant.Assets -CardsOnly
  if ((Get-Geometry $compliant.Card) -ne "658x940") {
    throw "Compliant 840x1200 source did not downscale to 658x940."
  }
  $firstHash = (Get-FileHash -LiteralPath $compliant.Card -Algorithm SHA256).Hash
  & $scriptPath -AssetsRoot $compliant.Assets -CardsOnly
  $secondHash = (Get-FileHash -LiteralPath $compliant.Card -Algorithm SHA256).Hash
  if ($firstHash -ne $secondHash) { throw "Optimizer is not idempotent for an already compliant card." }

  Assert-RejectedWithoutMutation "legacy-220x513" 220 513 "CARD_SOURCE_DENSITY_INSUFFICIENT"
  Assert-RejectedWithoutMutation "legacy-300x700" 300 700 "CARD_SOURCE_DENSITY_INSUFFICIENT"
  Assert-RejectedWithoutMutation "wrong-aspect-700x950" 700 950 "CARD_SOURCE_ASPECT_INVALID"
} finally {
  if (Test-Path -LiteralPath $fixtureFullPath) {
    Remove-Item -LiteralPath $fixtureFullPath -Recurse -Force
  }
}

Write-Host "OPTIMIZE_ASSETS_REGRESSION_OK"
