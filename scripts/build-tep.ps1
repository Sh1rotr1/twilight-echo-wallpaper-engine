# Build a plugin-only .tep package.
#
#   pwsh ./scripts/build-tep.ps1
#
# The resulting package contains the plugin runtime plus patch/we-background.js
# and docs/TE-PATCH.md for the Twilight Echo maintainer. It does not modify
# Twilight Echo's app.asar by itself.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$plugin = [IO.File]::ReadAllText((Join-Path $root 'plugin.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$version = [string]$plugin.version
$stage = Join-Path $env:TEMP ('te-tep-' + [guid]::NewGuid().ToString('N'))
$dist = Join-Path $root 'dist'
$zip = Join-Path $env:TEMP ('te-tep-' + [guid]::NewGuid().ToString('N') + '.zip')
$tep = Join-Path $dist ("com.twilightecho.tool.wallpaper-engine-$version.tep")

New-Item -ItemType Directory -Force $stage | Out-Null
New-Item -ItemType Directory -Force $dist | Out-Null

$exclude = @('bridge', 'dist', 'node_modules', '.git', '.github')
Get-ChildItem $root -Force | ForEach-Object {
  if ($exclude -contains $_.Name) { return }
  Copy-Item $_.FullName (Join-Path $stage $_.Name) -Recurse -Force
}

# The app author needs the exact renderer bridge. It is reference material
# inside the package; the plugin itself does not import it.
New-Item -ItemType Directory -Force (Join-Path $stage 'patch') | Out-Null
Copy-Item (Join-Path $root 'bridge\we-background.js') (Join-Path $stage 'patch\we-background.js') -Force

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
if (Test-Path $tep) { Remove-Item $tep -Force }
Move-Item $zip $tep -Force
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "TEP: $tep"
Write-Host ("SHA256: " + (Get-FileHash $tep -Algorithm SHA256).Hash)
