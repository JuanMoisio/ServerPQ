// services/pqtools.js — instala "PQTools" (capturador) en el USB seleccionado
import { promises as fsp } from 'node:fs';
import path from 'node:path';

function isRootDir(p) {
  // E:\  — evita mkdir en raíz
  return /^[A-Za-z]:\\$/.test(p);
}
async function ensureDirSafe(p) {
  const dir = path.win32.normalize(p);
  if (isRootDir(dir)) return; // no crear raíz
  await fsp.mkdir(dir, { recursive: true });
}
async function copyRecursive(src, dst) {
  const st = await fsp.stat(src);
  if (st.isDirectory()) {
    await ensureDirSafe(dst);
    const items = await fsp.readdir(src);
    for (const it of items) {
      await copyRecursive(path.win32.join(src, it), path.win32.join(dst, it));
    }
  } else {
    await ensureDirSafe(path.win32.dirname(dst));
    await fsp.copyFile(src, dst);
  }
}

// === Lanzador robusto (no se cierra, pide UAC, muestra código de salida) ===
function pqCaptureCmd() {
  return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT=%~dp0pq-capture.ps1"
set "PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"

echo [*] Script: "%SCRIPT%"

:: ¿somos admin?
whoami /groups | find "S-1-5-32-544" >nul 2>&1
if not errorlevel 1 goto :isAdmin

echo [*] Elevando privilegios (UAC)...
"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process -Verb RunAs -FilePath '%PS%' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\\"%SCRIPT%\\"'"
if errorlevel 1 (
  echo [X] No se pudo solicitar elevacion (UAC cancelado?).
  pause
) else (
  echo [*] Se abrió una ventana elevada. Si no la ves, revisá la barra de tareas.
)
exit /b

:isAdmin
"%PS%" -NoProfile -ExecutionPolicy Bypass -NoLogo -File "%SCRIPT%"
set EC=%ERRORLEVEL%
echo.
echo [*] Salida de pq-capture.ps1 con código %EC%
pause
exit /b %EC%
`;
}

// === Capturador con VSS (chequeo PREVIO: 60% + tolerancia opcional) ===
function pqCapturePs1() {
  return `#requires -version 2
$ErrorActionPreference = 'Stop'
function W($c,$m){ Write-Host $m -ForegroundColor $c }
function Info($m){ W 'Cyan'  "[*] $m" }
function Ok($m)  { W 'Green' "[OK] $m" }
function Warn($m){ W 'Yellow' "[!] $m" }
function Err($m) { W 'Red'   "[X] $m" }

# --- Resolver ruta del script (robusto para PS viejas) ---
$scriptPath = $PSCommandPath
if (-not $scriptPath) { $scriptPath = $MyInvocation.MyCommand.Path }
if (-not $scriptPath) { Err "No pude resolver la ruta del script."; Read-Host "Enter para salir"; exit 1 }
$scriptRoot = Split-Path -Path $scriptPath -Parent
$usbRoot    = [System.IO.Path]::GetPathRoot($scriptRoot)
$usbLetter  = $usbRoot.TrimEnd('\\')

# --- Admin? ---
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Err "Debe ejecutarse como Administrador."; Read-Host "Enter para salir"; exit 1
}
if (-not (Test-Path $usbRoot)) { Err "No pude resolver la raíz del USB."; Read-Host "Enter para salir"; exit 1 }

# --- wimlib ---
$wimlib = Join-Path $scriptRoot 'wimlib-imagex.exe'
if (-not (Test-Path $wimlib)) {
  Err "Falta wimlib-imagex.exe en $scriptRoot"
  Warn "Copiá wimlib para Windows (x64) a esta carpeta."
  Read-Host "Enter para salir"; exit 1
}

# --- Estimar tamaño necesario (60% de lo usado en C:) y chequear espacio ANTES de capturar ---
$srcDrive = 'C:'
$factor   = 0.60          # ← estimación conservadora
$softGapMB = 512          # ← tolerancia “blanda”: permití seguir si faltan <= 512 MB
$minSoftMB = 50           # ← y nunca menos de 50 MB de margen

try {
  $sys = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='$($srcDrive)'" -ErrorAction Stop
} catch { $sys = $null }
if ($null -eq $sys) {
  try { $sys = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($srcDrive)'" -ErrorAction Stop } catch { $sys = $null }
}
if ($null -eq $sys) {
  Warn "No pude leer métricas de $srcDrive. Continuaré sin chequeo de espacio."
} else {
  $usedBytes = [int64]$sys.Size - [int64]$sys.FreeSpace
  $needBytes = [int64]([math]::Ceiling($usedBytes * $factor))   # 60% del usado

  # espacio libre en el USB
  try {
    $usbInfo = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='$($usbLetter)'" -ErrorAction Stop
  } catch { $usbInfo = $null }
  if ($null -eq $usbInfo) {
    try { $usbInfo = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($usbLetter)'" -ErrorAction Stop } catch { $usbInfo = $null }
  }

  if ($usbInfo) {
    $freeBytes = [int64]$usbInfo.FreeSpace

    $usedMB = [math]::Round($usedBytes/1MB, 0)
    $needMB = [math]::Round($needBytes/1MB, 0)
    $freeMB = [math]::Round($freeBytes/1MB, 0)

    Info ("Uso en {0}: {1:N0} MB" -f $srcDrive, $usedMB)
    Info ("Estimado WIM (60%): {0:N0} MB" -f $needMB)
    Info ("Libre en {0}: {1:N0} MB" -f $usbLetter, $freeMB)

    if ($freeBytes -lt $needBytes) {
      $gapBytes = $needBytes - $freeBytes
      $gapMB    = [math]::Round($gapBytes/1MB, 0)
      $softMB   = [math]::Max($softGapMB, $minSoftMB)  # umbral en MB

      if ($gapMB -le $softMB) {
        Warn ("Puede faltar ~{0:N0} MB según el estimado. Podría alcanzar igual." -f $gapMB)
        $ans = Read-Host "¿Querés continuar de todos modos? [S/N]"
        if ($ans -notmatch '^(s|S|y|Y)$') {
          Err "Cancelado por usuario (espacio justo)."
          exit 3
        } else {
          Info "Continuando por pedido del usuario..."
        }
      } else {
        Err ("No hay espacio suficiente en {0}. Necesario ~{1:N0} MB, disponible {2:N0} MB." -f $usbLetter, $needMB, $freeMB)
        Write-Host ""
        Write-Host "Sugerencias:" -ForegroundColor Yellow
        Write-Host " - Usá un USB/disco más grande." -ForegroundColor Yellow
        Write-Host " - Capturá a una ruta de red: mapeá con 'net use Z: \\\\SERVIDOR\\share' y guardá allí." -ForegroundColor Yellow
        Read-Host "Enter para salir"
        exit 2
      }
    }
  } else {
    Warn "No pude leer el espacio libre del USB. Continuaré sin chequeo."
  }
}

# --- VSS ---
try { Start-Service -Name 'VSS' -ErrorAction SilentlyContinue } catch {}

# --- Parámetros de captura / destino en USB ---
$comp  = $env:COMPUTERNAME
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$destDir = Join-Path $usbRoot ("Capturas\\{0}-{1}" -f $comp,$stamp)
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$destWim = Join-Path $destDir 'install.wim'
$destSha = "$destWim.sha256"

Info "Origen:  $srcDrive\\"
Info "Destino: $destWim"

# --- Exclusiones para achicar ---
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

# --- Captura (VSS + LZX) ---
$arguments = @('capture', "$srcDrive\\", "$destWim", "Snapshot-$comp", '--snapshot', '--compress=LZX', '--check', "--config=$cfgPath")
Info ("Ejecutando: wimlib-imagex {0}" -f ($arguments -join ' '))
Write-Host ""

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
  Err ("wimlib terminó con código {0}" -f $proc.ExitCode)
  Read-Host "Enter para salir"
  exit $proc.ExitCode
}

# --- Hash ---
Info "Calculando SHA-256..."
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

  // 1) crear carpeta destino
  await ensureDirSafe(target);

  // 2) copiar binarios si existe srcDir (vendor/pqtools/win)
  let copied = [];
  let usedSrc = '';
  if (srcDir) {
    usedSrc = srcDir;
    try {
      const st = await fsp.stat(srcDir);
      if (st.isDirectory()) {
        await copyRecursive(srcDir, target);
        const arr = await fsp.readdir(srcDir);
        copied = arr;
      }
    } catch {
      // si falla, seguimos con los scripts embebidos
    }
  }

  // 3) escribir/actualizar scripts embebidos (siempre sobreescribe para dejar la versión robusta)
  await fsp.writeFile(path.win32.join(target, 'pq-capture.cmd'), pqCaptureCmd(), 'utf8');
  await fsp.writeFile(path.win32.join(target, 'pq-capture.ps1'), pqCapturePs1(), 'utf8');

  // 4) verificar presencia de wimlib en destino
  let hasWimlib = false;
  try {
    await fsp.access(path.win32.join(target, 'wimlib-imagex.exe'));
    hasWimlib = true;
  } catch {}

  return { targetDir: target, copiedFrom: usedSrc, filesCopied: copied, hasWimlib };
}

export default { installPQTools };
