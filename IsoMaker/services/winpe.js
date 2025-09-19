// services/winpe.js — copia el pack de WinPE (ISO + scripts) al USB
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { app } from 'electron'; // solo disponible cuando se importa desde main (ESM)

function isRootDir(p) { return /^[A-Za-z]:\\$/.test(path.win32.normalize(p)); }
async function ensureDirSafe(p) { const n = path.win32.normalize(p); if (isRootDir(n)) return; await fsp.mkdir(n, { recursive: true }); }
async function copyRecursive(src, dst) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await ensureDirSafe(dst);
    for (const it of await fsp.readdir(src)) {
      await copyRecursive(path.win32.join(src, it), path.win32.join(dst, it));
    }
  } else {
    await ensureDirSafe(path.win32.dirname(dst));
    await fsp.copyFile(src, dst);
  }
}

// === scripts embebidos mínimos ===
function script_restore_cmd() {
  return `@echo off
setlocal
title PQS Restore
echo =========================================
echo   PQS Restore Menu
echo =========================================
echo [1] Restaurar UEFI/GPT (recomendado)
echo [2] Restaurar BIOS/MBR
echo [X] Salir
set /p CH=Seleccione opcion: 
if "%CH%"=="1" goto UEFI
if "%CH%"=="2" goto BIOS
goto END
:UEFI
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-uefi.ps1"
goto END
:BIOS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-bios.ps1"
:END
pause
`;
}

function script_common_ps1() {
  return `# common.ps1 — utilidades compartidas
$ErrorActionPreference = 'Stop'
function Log($m){ $ts=(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'); Write-Host "[${ts}] $m" }
function FindUsbRoot() {
  # Buscamos la unidad que contiene \\PQTools\\WinPE\\scripts\\common.ps1
  foreach ($d in Get-PSDrive -PSProvider FileSystem) {
    $p = Join-Path $d.Root 'PQTools\\WinPE\\scripts\\common.ps1'
    if (Test-Path $p) { return $d.Root }
  }
  return $null
}
function FindLatestWim($usbRoot) {
  $caps = Join-Path $usbRoot 'Capturas'
  if (-not (Test-Path $caps)) { return $null }
  $list = Get-ChildItem -Path $caps -Recurse -Filter 'install.wim' -ErrorAction SilentlyContinue
  if (!$list) { return $null }
  $sel = $list | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  return $sel.FullName
}
function EnsureTool($name) {
  $p1 = Join-Path $PSScriptRoot $name
  $p2 = $name
  if (Test-Path $p1) { return $p1 }
  if (Get-Command $p2 -ErrorAction SilentlyContinue) { return $p2 }
  throw "No se encontró herramienta: $name"
}
`;
}

function script_restore_uefi_ps1() {
  return `# restore-uefi.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\\common.ps1"

$usbRoot = FindUsbRoot
if (-not $usbRoot) { Write-Host "No encuentro el USB con PQTools."; pause; exit 2 }
$wim = FindLatestWim $usbRoot
if (-not $wim) { Write-Host "No encuentro install.wim en $usbRoot\\Capturas"; pause; exit 3 }

Write-Host "WIM: $wim"
$ans = Read-Host "Esto BORRARÁ el Disco 0 y restaurará UEFI/GPT. Continuar? [S/N]"
if ($ans -notmatch '^(s|S|y|Y)$') { Write-Host "Cancelado"; exit 10 }

# Disk 0 UEFI layout
$dp = @"
select disk 0
clean
convert gpt
create partition efi size=100
format quick fs=fat32 label=SYSTEM
assign letter=S
create partition msr size=16
create partition primary
format quick fs=ntfs label=Windows
assign letter=C
list volume
exit
"@
$dpPath = Join-Path $env:TEMP 'uefi.diskpart.txt'
$dp | Out-File -Encoding ASCII -FilePath $dpPath
diskpart /s "$dpPath"

# Aplicar imagen
$wimlib = EnsureTool 'wimlib-imagex.exe'
& "$wimlib" apply "$wim" 1 C:\\ --check
if ($LASTEXITCODE -ne 0) { Write-Host "Error aplicando WIM"; pause; exit 20 }

# BCD
bcdboot C:\\Windows /s S: /f UEFI
if ($LASTEXITCODE -ne 0) { Write-Host "Error en bcdboot"; pause; exit 21 }

Write-Host "Restauración UEFI completa."
pause
exit 0
`;
}

function script_restore_bios_ps1() {
  return `# restore-bios.ps1
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\\common.ps1"

$usbRoot = FindUsbRoot
if (-not $usbRoot) { Write-Host "No encuentro el USB con PQTools."; pause; exit 2 }
$wim = FindLatestWim $usbRoot
if (-not $wim) { Write-Host "No encuentro install.wim en $usbRoot\\Capturas"; pause; exit 3 }

Write-Host "WIM: $wim"
$ans = Read-Host "Esto BORRARÁ el Disco 0 y restaurará BIOS/MBR. Continuar? [S/N]"
if ($ans -notmatch '^(s|S|y|Y)$') { Write-Host "Cancelado"; exit 10 }

# Disk 0 BIOS layout
$dp = @"
select disk 0
clean
convert mbr
create partition primary
format quick fs=ntfs label=Windows
assign letter=C
active
list volume
exit
"@
$dpPath = Join-Path $env:TEMP 'bios.diskpart.txt'
$dp | Out-File -Encoding ASCII -FilePath $dpPath
diskpart /s "$dpPath"

# Aplicar imagen
$wimlib = EnsureTool 'wimlib-imagex.exe'
& "$wimlib" apply "$wim" 1 C:\\ --check
if ($LASTEXITCODE -ne 0) { Write-Host "Error aplicando WIM"; pause; exit 20 }

# BCD
bcdboot C:\\Windows /s C: /f BIOS
if ($LASTEXITCODE -ne 0) { Write-Host "Error en bcdboot"; pause; exit 21 }

Write-Host "Restauración BIOS completa."
pause
exit 0
`;
}

function resolveVendorWinpeDir() {
  // buscamos el ISO y scripts en vendor/winpe/*
  const dev = path.resolve(process.cwd(), 'vendor', 'winpe');
  const prod = path.resolve(app.getAppPath(), 'vendor', 'winpe');
  return { dev, prod };
}

export async function installWinPEPack({ driveLetter, srcIsoPath }) {
  if (!driveLetter) throw new Error('driveLetter requerido');
  const root = driveLetter.endsWith('\\') ? driveLetter : driveLetter + '\\';
  const isoTargetDir = path.win32.join(root, 'ISOs');
  const scriptsDir = path.win32.join(root, 'PQTools', 'WinPE', 'scripts');

  await ensureDirSafe(isoTargetDir);
  await ensureDirSafe(scriptsDir);

  // 1) Copiar ISO
  let srcIso = srcIsoPath || '';
  if (!srcIso) {
    const { dev, prod } = resolveVendorWinpeDir();
    const tryPaths = [
      path.join(dev, 'PQS_WinPE.iso'),
      path.join(prod, 'PQS_WinPE.iso')
    ];
    for (const p of tryPaths) {
      try { await fsp.access(p); srcIso = p; break; } catch {}
    }
  }
  if (!srcIso) {
    throw new Error('No se encontró vendor/winpe/PQS_WinPE.iso. Copialo a vendor/winpe primero.');
  }
  const isoDest = path.win32.join(isoTargetDir, 'PQS_WinPE.iso');
  await fsp.copyFile(srcIso, isoDest);

  // 2) Copiar scripts embebidos (siempre actualizamos)
  await fsp.writeFile(path.win32.join(scriptsDir, 'restore.cmd'), script_restore_cmd(), 'utf8');
  await fsp.writeFile(path.win32.join(scriptsDir, 'common.ps1'), script_common_ps1(), 'utf8');
  await fsp.writeFile(path.win32.join(scriptsDir, 'restore-uefi.ps1'), script_restore_uefi_ps1(), 'utf8');
  await fsp.writeFile(path.win32.join(scriptsDir, 'restore-bios.ps1'), script_restore_bios_ps1(), 'utf8');

  // 3) README
  const readme = `PQS Restore
1) Bootea el USB con Ventoy.
2) Elegí "PQS_WinPE.iso".
3) En WinPE abrí X:\\PQTools\\WinPE\\scripts\\restore.cmd y seguí el menú.
   - El script busca el último Capturas\\*\\install.wim del propio USB.
   - UEFI/GPT para equipos modernos, BIOS/MBR para viejos.`;
  await fsp.writeFile(path.win32.join(root, 'README-RESTORE.txt'), readme, 'utf8');

  return { ok: true, isoPath: isoDest, scriptsDir };
}

export default { installWinPEPack };
