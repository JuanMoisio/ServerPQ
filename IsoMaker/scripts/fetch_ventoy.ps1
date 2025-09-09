# scripts/fetch-ventoy.ps1
param([string]$Version = $env:VENTOY_WIN_VERSION)
if (-not $Version) { $Version = '1.0.99' }
$zip = "ventoy-$Version-windows.zip"
$dst = "vendor/ventoy/win"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Invoke-WebRequest "https://downloads.sourceforge.net/project/ventoy/Ventoy-$Version/$zip" -OutFile "$dst/$zip"
Expand-Archive -Path "$dst/$zip" -DestinationPath $dst -Force
if (Test-Path "$dst/altexe") { Copy-Item "$dst/altexe/*" $dst -Force }
Write-Host "Ventoy $Version listo en $dst"