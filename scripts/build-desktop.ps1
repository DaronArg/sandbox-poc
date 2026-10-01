# Construye el instalador de la app desktop (Windows, Node 22): desktop/dist/Assessment-Setup-<version>.exe
$ErrorActionPreference = 'Stop'
$desktop = Join-Path $PSScriptRoot '..\desktop'
Push-Location $desktop
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci fallo' }
  npm run dist
  if ($LASTEXITCODE -ne 0) { throw 'npm run dist fallo' }
  Get-ChildItem dist -Filter 'Assessment-Setup-*.exe' | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}
} finally { Pop-Location }
