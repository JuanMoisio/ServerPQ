// services/pqtools.js — instala "PQTools" (capturador) en el USB
import { promises as fsp } from 'node:fs';
import path from 'node:path';

async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function copyRecursive(src, dst) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await ensureDir(dst);
    for (const it of await fsp.readdir(src)) {
      await copyRecursive(path.join(src, it), path.join(dst, it));
    }
  } else {
    await ensureDir(path.dirname(dst));
    await fsp.copyFile(src, dst);
  }
}

// Lanzador robusto
function pqCaptureCmd() {
  return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT=%~dp0pq-capture.ps1"
set "PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"

echo [*] Script: "%SCRIPT%"
whoami /groups | find "S-1-5-32-544" >nul 2>&1
if not errorlevel 1 goto :isAdmin

echo [*] Elevando privilegios (UAC)...
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -Verb RunAs -FilePath '%PS%' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\\"%SCRIPT%\\"'"
if errorlevel 1 (
  echo [X] UAC cancelado.
  pause
) else (
  echo [*] Se abrió ventana elevada. Revisá la barra de tareas.
)
exit /b

:isAdmin
"%PS%" -NoProfile -ExecutionPolicy Bypass -NoLogo -File "%SCRIPT%"
set EC=%ERRORLEVEL%
echo.
echo [*] Salida con código %EC%
pause
exit /b %EC%
`;
}

// Capturador con estimación de espacio (60% del usado en C:)
function pqCapturePs1() {
  return `#requires -version 2
$ErrorActionPreference='Stop'
function W($c,$m){ Write-Host $m -ForegroundColor $c }
function Info($m){ W 'Cyan'  "[*] $m" }
function Ok($m)  { W 'Green' "[OK] $m" }
function Warn($m){ W 'Yellow' "[!] $m" }
function Err($m) { W 'Red'   "[X] $m" }

$scriptPath = $PSCommandPath; if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Path }
if (-not $scriptPath) { Err "No pude resolver la ruta del script."; Read-Host "Enter para salir"; exit 1 }
$scriptRoot = Split-Path -Path $scriptPath -Parent
$usbRoot    = [System.IO.Path]::GetPathRoot($scriptRoot)
$usbLetter  = $usbRoot.TrimEnd('\\')

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Err "Debe ejecutarse como Administrador."; Read-Host "Enter para salir"; exit 1
}

$wimlib = Join-Path $scriptRoot 'wimlib-imagex.exe'
if (-not (Test-Path $wimlib)) { Err "Falta wimlib-imagex.exe"; Read-Host "Enter para salir"; exit 1 }

$srcDrive = 'C:'
$factor   = 0.60
$softGapMB = 512
$minSoftMB = 50

try { $sys = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='$($srcDrive)'" -EA Stop } catch { $sys=$null }
if (-not $sys) { try { $sys = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($srcDrive)'" -EA Stop } catch { $sys=$null } }

if ($sys) {
  $usedBytes = [int64]$sys.Size - [int64]$sys.FreeSpace
  $needBytes = [int64]([math]::Ceiling($usedBytes * $factor))

  try { $usbInfo = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='$($usbLetter)'" -EA Stop } catch { $usbInfo=$null }
  if (-not $usbInfo) { try { $usbInfo = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($usbLetter)'" -EA Stop } catch { $usbInfo=$null } }

  if ($usbInfo) {
    $freeBytes = [int64]$usbInfo.FreeSpace
    $usedMB = [math]::Round($usedBytes/1MB,0)
    $needMB = [math]::Round($needBytes/1MB,0)
    $freeMB = [math]::Round($freeBytes/1MB,0)

    Info ("Uso en {0}: {1:N0} MB" -f $srcDrive,$usedMB)
    Info ("Estimado WIM (60%): {0:N0} MB" -f $needMB)
    Info ("Libre en {0}: {1:N0} MB" -f $usbLetter,$freeMB)

    if ($freeBytes -lt $needBytes) {
      $gapMB = [math]::Round(($needBytes - $freeBytes)/1MB,0)
      $softMB = [math]::Max($softGapMB,$minSoftMB)
      if ($gapMB -le $softMB) {
        Warn ("Puede faltar ~{0:N0} MB. Intentar igual? [S/N]" -f $gapMB)
        $ans = Read-Host
        if ($ans -notmatch '^(s|S|y|Y)$') { Err "Cancelado por usuario."; exit 3 }
      } else {
        Err ("No hay espacio: necesita ~{0:N0} MB, libre {1:N0} MB." -f $needMB,$freeMB)
        Read-Host "Enter para salir"; exit 2
      }
    }
  }
} else {
  Warn "No pude leer métricas de $srcDrive. Continuaré sin chequeo."
}

try { Start-Service -Name 'VSS' -EA SilentlyContinue } catch {}

$comp  = $env:COMPUTERNAME
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destDir = Join-Path $usbRoot ("Capturas\\{0}-{1}" -f $comp,$stamp)
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$destWim = Join-Path $destDir 'install.wim'
$destSha = "$destWim.sha256"

$cfg = @"
[ExclusionList]
\\pagefile.sys
\\hiberfil.sys
\\swapfile.sys
\\System Volume Information
\\$Recycle.Bin
\\Windows\\Temp
\\Windows\\SoftwareDistribution\\Download
\\Windows\\WinSxS\\Temp
\\Windows\\Logs
\\Windows\\Prefetch
\\ProgramData\\Microsoft\\Windows Defender\\Scans\\History\\Service
"@
$cfgPath = Join-Path $env:TEMP ("wimlib-exclude-{0}.ini" -f $stamp)
$cfg | Out-File -Encoding ASCII -FilePath $cfgPath

$arguments = @('capture', "$srcDrive\\", "$destWim", "Snapshot-$comp", '--snapshot', '--compress=LZX', '--check', "--config=$cfgPath")
Write-Host "wimlib-imagex $($arguments -join ' ')"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $wimlib
$psi.Arguments = [string]::Join(' ', $arguments)
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError  = $true
$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi
$null = $proc.Start()

while (-not $proc.HasExited) {
  $line = $proc.StandardOutput.ReadLine()
  if ($line -ne $null) { Write-Host $line }
}

$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
if ($stdout) { Write-Host $stdout }
if ($stderr) { Write-Host $stderr -ForegroundColor DarkYellow }

if ($proc.ExitCode -ne 0) {
  Write-Host ""
  Err ("wimlib terminó con código {0}" -f $proc.ExitCode)
  Read-Host "Enter para salir"
  exit $proc.ExitCode
}

Write-Host ""
Write-Host "Calculando SHA-256..."
$sha = Get-FileHash -Algorithm SHA256 -LiteralPath $destWim
"$($sha.Hash)  $(Split-Path -Leaf $destWim)" | Out-File -Encoding ASCII -FilePath $destSha
Ok "Captura completa."
Write-Host "Archivo: $destWim"
Write-Host "SHA256:  $($sha.Hash)"
Read-Host "Enter para salir"
`;
}

export async function installPQTools({ driveLetter, srcDir }) {
  if (!driveLetter) throw new Error('driveLetter requerido');
  const root = driveLetter.endsWith('\\') ? driveLetter : driveLetter + '\\';
  const target = path.win32.join(root, 'PQTools');
  await ensureDir(target);

  // copia opcional de binarios (vendor/pqtools/win)
  if (srcDir) {
    try { await copyRecursive(srcDir, target); } catch {/* continúa igual */}
  }

  // aseguramos subcarpetas
  await ensureDir(path.win32.join(target, 'scripts'));

  // scripts
  await fsp.writeFile(path.win32.join(target, 'pq-capture.cmd'), pqCaptureCmd(), 'utf8');
  await fsp.writeFile(path.win32.join(target, 'pq-capture.ps1'), pqCapturePs1(), 'utf8');

  let hasWimlib = false;
  try { await fsp.access(path.win32.join(target, 'wimlib-imagex.exe')); hasWimlib = true; } catch {}

  return { targetDir: target, hasWimlib };
}

export default { installPQTools };
