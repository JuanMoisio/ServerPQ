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
function pqCaptureCmd(defaultLabel) {
  const DEF = (defaultLabel||'').replace(/"/g, '');
  return `@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT=%~dp0pq-capture.ps1"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

rem Optional first argument is a friendly label for the image
set "LABEL=%~1"
if "!LABEL!"=="" (
  set /p LABEL=Ingrese nombre para la imagen (enter para usar timestamp): 
)

rem sanitize LABEL to remove dangerous chars that break batch parsing
set "LABEL=!LABEL:"=!"
set "LABEL=!LABEL::=-!"
set "LABEL=!LABEL:/=-!"
set "LABEL=!LABEL:\=-!"
set "LABEL=!LABEL:*=-!"
set "LABEL=!LABEL:?=-!"
set "LABEL=!LABEL:|=-!"
set "LABEL=!LABEL:(=-!"
set "LABEL=!LABEL:)=-!"

if "!LABEL!"=="" set "LABEL=${DEF}"

echo [*] Script: "%SCRIPT%"
  whoami /groups | find "S-1-5-32-544" >nul 2>&1
  if not errorlevel 1 (
    rem already admin — just run the script
    echo [DEBUG] LABEL=!LABEL!
    echo [DEBUG] Running PowerShell: "%PS%" -NoProfile -ExecutionPolicy Bypass -NoLogo -File "%SCRIPT%" -Label "!LABEL!"
    "%PS%" -NoProfile -ExecutionPolicy Bypass -NoLogo -File "%SCRIPT%" -Label "!LABEL!"
  ) else (
    rem not admin — invoke PowerShell which will self-elevate
    echo [DEBUG] LABEL=!LABEL!
    echo [DEBUG] Running PowerShell (will attempt elevation): "%PS%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Label "!LABEL!"
    "%PS%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Label "!LABEL!"
  )
set EC=%ERRORLEVEL%
echo.
echo [*] Salida con código %EC%
pause
exit /b %EC%
`;
}

// Capturador con estimación de espacio (60% del usado en C:)
function pqCapturePs1() {
  return `# PowerShell capture script (compatible with older PS versions)
$ErrorActionPreference='Stop'
# label may be passed as first argument ($args[0])
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
  # Try to self-elevate using Start-Process -Verb RunAs (works on Win7+)
  try {
    # prepare args: -NoProfile -ExecutionPolicy Bypass -File <scriptPath> [label]
    $psiArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',$scriptPath)
    if ($args.Count -gt 0) { $psiArgs += $args[0] }
    Start-Process -FilePath 'powershell.exe' -ArgumentList $psiArgs -Verb RunAs -WorkingDirectory $scriptRoot -WindowStyle Normal
    exit 0
  } catch {
    Err "Debe ejecutarse como Administrador y la elevación falló."; Read-Host "Enter para salir"; exit 1
  }
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

# determine label from first arg or prompt
$Label = $null
if ($args.Count -gt 0 -and $args[0]) { $Label = $args[0] }
if (-not $Label) { $Label = Read-Host "Ingrese nombre para la imagen (enter para usar timestamp)" }
if ($Label) {
  # replace invalid path chars with '-'
  $safe = $Label -replace '[\\/:\*\?"<>|]','-' -replace '\\s+','-'
  if ($safe.Length -gt 50) { $safe = $safe.Substring(0,50) }
  $safe = $safe.Trim('- ')
  $destDir = Join-Path $usbRoot ("Capturas\\{0}-{1}-{2}" -f $comp,$stamp,$safe)
} else {
  $destDir = Join-Path $usbRoot ("Capturas\\{0}-{1}" -f $comp,$stamp)
}

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

export async function installPQTools({ driveLetter, srcDir, defaultLabel } = {}) {
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
  await fsp.writeFile(path.win32.join(target, 'pq-capture.cmd'), pqCaptureCmd(defaultLabel), 'utf8');
  // prepend UTF-8 BOM to help older PowerShell interpreters on Windows 7 detect encoding
  const ps1 = '\uFEFF' + pqCapturePs1();
  await fsp.writeFile(path.win32.join(target, 'pq-capture.ps1'), ps1, 'utf8');

  // Try to copy optional wimlib-imagex.exe from bundled vendor directories
  let hasWimlib = false;
  const candidates = [
    path.resolve(process.cwd(), 'vendor', 'pqtools', 'win', 'wimlib-imagex.exe'),
    path.resolve(process.cwd(), 'vendor', 'winpe', 'wimlib-imagex.exe'),
  ];
  for (const cand of candidates) {
    try {
      await fsp.access(cand);
      // copy into target root (next to pq-capture.ps1)
      await copyRecursive(cand, path.win32.join(target, 'wimlib-imagex.exe'));
      hasWimlib = true;
      break;
    } catch (err) {
      // ignore and try next
    }
  }

  if (!hasWimlib) {
    const help = `Falta wimlib-imagex.exe

El script de captura requiere el ejecutable 'wimlib-imagex.exe'. Opciones para solucionarlo:

1) Copiar manualmente 'wimlib-imagex.exe' en la carpeta 'PQTools' del USB (junto a pq-capture.ps1).
2) Colocar 'wimlib-imagex.exe' en este repositorio en 'vendor/pqtools/win/' o 'vendor/winpe/' y volver a ejecutar la acción "Instalar PQTools" desde la app. El instalador copiará el binario al USB.
3) Si preferís, puedo añadir una opción para que la app descargue automáticamente el binario durante la instalación (necesitaría confirmar la URL y permiso para descargar).

Mientras no exista 'wimlib-imagex.exe', el capturador no puede crear WIMs y mostrará el mensaje de error.`;
    try { await fsp.writeFile(path.win32.join(target, 'README-MISSING-WIMLIB.txt'), help, 'utf8'); } catch {}
  }

  return { targetDir: target, hasWimlib };
}

export default { installPQTools };
