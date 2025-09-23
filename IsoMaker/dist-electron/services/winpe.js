// services/winpe.js — copia ISO de WinPE + scripts de restauración al USB
import { promises as fs } from 'node:fs';
import path from 'node:path';
async function ensureDir(p) {
    await fs.mkdir(p, { recursive: true });
}
async function exists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function copyFile(src, dst) {
    await ensureDir(path.dirname(dst));
    await fs.copyFile(src, dst);
}
function usbRootFromLetter(letter) {
    const L = letter.endsWith(':') ? letter : `${letter}:`;
    return `${L}\\`; // "E:\" por ejemplo
}
// --- Scripts embebidos ---
const RESTORE_CMD = `@echo off
setlocal ENABLEDELAYEDEXPANSION
title PQS Restore

set "SCRIPTDIR=%~dp0"
if "%SCRIPTDIR:~-1%"=="\\" set "SCRIPTDIR=%SCRIPTDIR:~0,-1%"

echo Scripts en: "%SCRIPTDIR%"
echo.
echo =========================================
echo   PQS Restore Menu
echo =========================================
echo [1] UEFI/GPT (recomendado)
echo [2] BIOS/MBR
echo [X] Salir
set /p CH=Seleccione opcion: 

if /I "%CH%"=="1" goto UEFI
if /I "%CH%"=="2" goto BIOS
exit /b 0

:UEFI
if exist X:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe if exist "%SCRIPTDIR%\\restore-uefi.ps1" (
  X:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPTDIR%\\restore-uefi.ps1"
) else (
  call "%SCRIPTDIR%\\restore-uefi.cmd"
)
exit /b %errorlevel%

:BIOS
if exist X:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe if exist "%SCRIPTDIR%\\restore-bios.ps1" (
  X:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPTDIR%\\restore-bios.ps1"
) else (
  call "%SCRIPTDIR%\\restore-bios.cmd"
)
exit /b %errorlevel%
`;
const RESTORE_UEFI_PS1 = `$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$usbRoot = Split-Path -Qualifier $ScriptDir

$wim = Get-ChildItem -Path (Join-Path $usbRoot 'Capturas') -Recurse -Filter install.wim -EA SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $wim) {
  $wim = Get-ChildItem -Path (Join-Path $usbRoot 'Capturas') -Recurse -Filter install.swm -EA SilentlyContinue |
         Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $wim) { throw "No se encontró install.wim / .swm en $usbRoot\\Capturas" }
}
Write-Host "Usando imagen:" $wim.FullName

$ans = Read-Host "ESTO BORRA EL DISCO 0. Continuar? (S/N)"
if ($ans -notin @('S','s','Y','y')) { exit 10 }

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
exit
"@
$dp | Out-File "$env:TEMP\\uefi.diskpart.txt" -Encoding ASCII
diskpart /s "$env:TEMP\\uefi.diskpart.txt"

$wimlib = Join-Path $ScriptDir 'wimlib-imagex.exe'
if (Test-Path $wimlib) {
  & $wimlib apply $wim.FullName 1 C:\\ --check
} else {
  if ($wim.Extension -ieq '.swm') {
    dism /Apply-Image /ImageFile:$($wim.FullName) /ApplyDir:C:\\ /Index:1
  } else {
    dism /Apply-Image /ImageFile:$($wim.FullName) /ApplyDir:C:\\ /Index:1 /CheckIntegrity
  }
}
bcdboot C:\\Windows /s S: /f UEFI
Write-Host "Restauracion UEFI completa."
pause
`;
const RESTORE_BIOS_PS1 = `$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$usbRoot = Split-Path -Qualifier $ScriptDir

$wim = Get-ChildItem -Path (Join-Path $usbRoot 'Capturas') -Recurse -Filter install.wim -EA SilentlyContinue |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $wim) {
  $wim = Get-ChildItem -Path (Join-Path $usbRoot 'Capturas') -Recurse -Filter install.swm -EA SilentlyContinue |
         Sort-Object -Property LastWriteTime -Descending | Select-Object -First 1
  if (-not $wim) { throw "No se encontró install.wim / .swm en $usbRoot\\Capturas" }
}
Write-Host "Usando imagen:" $wim.FullName

$ans = Read-Host "ESTO BORRA EL DISCO 0. Continuar? (S/N)"
if ($ans -notin @('S','s','Y','y')) { exit 10 }

$dp = @"
select disk 0
clean
convert mbr
create partition primary
format quick fs=ntfs label=Windows
assign letter=C
active
exit
"@
$dp | Out-File "$env:TEMP\\bios.diskpart.txt" -Encoding ASCII
diskpart /s "$env:TEMP\\bios.diskpart.txt"

$wimlib = Join-Path $ScriptDir 'wimlib-imagex.exe'
if (Test-Path $wimlib) {
  & $wimlib apply $wim.FullName 1 C:\\ --check
} else {
  if ($wim.Extension -ieq '.swm') {
    dism /Apply-Image /ImageFile:$($wim.FullName) /ApplyDir:C:\\ /Index:1
  } else {
    dism /Apply-Image /ImageFile:$($wim.FullName) /ApplyDir:C:\\ /Index:1 /CheckIntegrity
  }
}
bcdboot C:\\Windows /s C: /f BIOS
Write-Host "Restauracion BIOS completa."
pause
`;
const RESTORE_UEFI_CMD = `@echo off
setlocal
set WIM=%~1
if not defined WIM (
  for /f "delims=" %%F in ('dir /b /s "%~d0\\Capturas\\install.wim" 2^>nul') do set "WIM=%%F"
  if not defined WIM for /f "delims=" %%F in ('dir /b /s "%~d0\\Capturas\\install.swm" 2^>nul') do set "WIM=%%F"
)
if not exist "%WIM%" ( echo No existe WIM & exit /b 2 )

echo Esto BORRARA el Disco 0 y restaurara UEFI/GPT. Continuar? (S/N)
set /p OK=
if /I not "%OK%"=="S" if /I not "%OK%"=="Y" exit /b 10

set TMP=%TEMP%\\uefi.diskpart.txt
> "%TMP%" echo select disk 0
>>"%TMP%" echo clean
>>"%TMP%" echo convert gpt
>>"%TMP%" echo create partition efi size=100
>>"%TMP%" echo format quick fs=fat32 label=SYSTEM
>>"%TMP%" echo assign letter=S
>>"%TMP%" echo create partition msr size=16
>>"%TMP%" echo create partition primary
>>"%TMP%" echo format quick fs=ntfs label=Windows
>>"%TMP%" echo assign letter=C
>>"%TMP%" echo exit

diskpart /s "%TMP%" || exit /b 11

set WIMLIB=%~dp0wimlib-imagex.exe
if exist "%WIMLIB%" (
  "%WIMLIB%" apply "%WIM%" 1 C:\\ --check || exit /b 20
) else (
  dism /Apply-Image /ImageFile:"%WIM%" /Index:1 /ApplyDir:C:\\ || exit /b 20
)

bcdboot C:\\Windows /s S: /f UEFI || exit /b 21
echo Restauracion UEFI completa.
pause
`;
const RESTORE_BIOS_CMD = `@echo off
setlocal
set WIM=%~1
if not defined WIM (
  for /f "delims=" %%F in ('dir /b /s "%~d0\\Capturas\\install.wim" 2^>nul') do set "WIM=%%F"
  if not defined WIM for /f "delims=" %%F in ('dir /b /s "%~d0\\Capturas\\install.swm" 2^>nul') do set "WIM=%%F"
)
if not exist "%WIM%" ( echo No existe WIM & exit /b 2 )

echo Esto BORRARA el Disco 0 y restaurara BIOS/MBR. Continuar? (S/N)
set /p OK=
if /I not "%OK%"=="S" if /I not "%OK%"=="Y" exit /b 10

set TMP=%TEMP%\\bios.diskpart.txt
> "%TMP%" echo select disk 0
>>"%TMP%" echo clean
>>"%TMP%" echo convert mbr
>>"%TMP%" echo create partition primary
>>"%TMP%" echo format quick fs=ntfs label=Windows
>>"%TMP%" echo assign letter=C
>>"%TMP%" echo active
>>"%TMP%" echo exit

diskpart /s "%TMP%" || exit /b 11

set WIMLIB=%~dp0wimlib-imagex.exe
if exist "%WIMLIB%" (
  "%WIMLIB%" apply "%WIM%" 1 C:\\ --check || exit /b 20
) else (
  dism /Apply-Image /ImageFile:"%WIM%" /Index:1 /ApplyDir:C:\\ || exit /b 20
)

bcdboot C:\\Windows /s C: /f BIOS || exit /b 21
echo Restauracion BIOS completa.
pause
`;
// API
export async function installPackToUSB(args, opts) {
    if (!args || !args.driveLetter)
        throw new Error('driveLetter requerido');
    const root = usbRootFromLetter(args.driveLetter);
    const dirISOs = path.join(root, 'ISOs');
    const dirScripts = path.join(root, 'PQTools', 'WinPE', 'scripts');
    const dirCapturas = path.join(root, 'Capturas');
    await ensureDir(dirISOs);
    await ensureDir(dirScripts);
    await ensureDir(dirCapturas);
    // ISO fuente: prioridad al parámetro, luego vendor/winpe en appPath, luego en cwd
    let isoSrc = args.srcIsoPath;
    if (!isoSrc) {
        const base = (opts && opts.appPath) ? opts.appPath : process.cwd();
        const cand1 = path.resolve(base, 'vendor', 'winpe', 'PQS_WinPE.iso');
        const cand2 = path.resolve(process.cwd(), 'vendor', 'winpe', 'PQS_WinPE.iso');
        isoSrc = (await exists(cand1)) ? cand1 : cand2;
    }
    if (!(await exists(isoSrc))) {
        throw new Error(`No encuentro ISO fuente en: ${isoSrc}`);
    }
    const isoDst = path.join(dirISOs, 'PQS_WinPE.iso');
    await copyFile(isoSrc, isoDst);
    // Scripts
    await fs.writeFile(path.join(dirScripts, 'restore.cmd'), RESTORE_CMD, 'ascii');
    await fs.writeFile(path.join(dirScripts, 'restore-uefi.ps1'), RESTORE_UEFI_PS1, 'ascii');
    await fs.writeFile(path.join(dirScripts, 'restore-bios.ps1'), RESTORE_BIOS_PS1, 'ascii');
    await fs.writeFile(path.join(dirScripts, 'restore-uefi.cmd'), RESTORE_UEFI_CMD, 'ascii');
    await fs.writeFile(path.join(dirScripts, 'restore-bios.cmd'), RESTORE_BIOS_CMD, 'ascii');
    // wimlib opcional: si lo tenés en vendor/winpe/wimlib-imagex.exe lo copiamos a scripts
    let wimlibCopied = false;
    let wl = args.srcWimlibPath;
    if (!wl) {
        const base = (opts && opts.appPath) ? opts.appPath : process.cwd();
        const c1 = path.resolve(base, 'vendor', 'winpe', 'wimlib-imagex.exe');
        const c2 = path.resolve(process.cwd(), 'vendor', 'winpe', 'wimlib-imagex.exe');
        wl = (await exists(c1)) ? c1 : c2;
    }
    if (await exists(wl)) {
        await copyFile(wl, path.join(dirScripts, 'wimlib-imagex.exe'));
        wimlibCopied = true;
    }
    // README
    const readme = `PQS USB – WinPE + Scripts

ISOs\\PQS_WinPE.iso   -> booteá esto desde Ventoy
PQTools\\WinPE\\scripts\\restore.cmd  -> menú de restauración
Capturas\\  -> dejá acá las carpetas con tus install.wim / .swm

Notas:
- UEFI = opción 1, BIOS = opción 2.
- BORRA el Disco 0 del equipo destino.
- Si el USB es FAT32 y el WIM > 4 GB, dividir en .SWM antes de restaurar (o usar exFAT/NTFS).
`;
    await fs.writeFile(path.join(root, 'README-RESTORE.txt'), readme, 'utf8');
    return {
        ok: true,
        root,
        isoDst,
        scriptsDir: dirScripts,
        copied: { iso: true, scripts: true, wimlib: wimlibCopied },
    };
}
export default { installPackToUSB };
