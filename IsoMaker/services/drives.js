// services/drives.js — lista unidades USB / removibles con letra
import { spawn } from 'node:child_process';

function runPS(ps) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy','Bypass',
      '-Command', ps
    ], { windowsHide: true });

    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('exit', code => code === 0 ? resolve(out) : reject(new Error(err || `powershell exit ${code}`)));
  });
}

export async function listRemovableDrives() {
  // Sin juegos de comillas: usamos asociaciones CIM/WMI para mapear DiskDrive -> Partition -> LogicalDisk
  const ps = `
$ErrorActionPreference='SilentlyContinue'

# Preferimos CIM moderno; si no está, caemos a WMI clásico
$useCim = $true
try { Get-Command Get-CimAssociatedInstance -EA Stop | Out-Null } catch { $useCim = $false }

$result = @()

if ($useCim) {
  $diskDrives = Get-CimInstance Win32_DiskDrive | Where-Object { $_.InterfaceType -eq 'USB' -or $_.MediaType -like '*Removable*' }
  foreach ($d in $diskDrives) {
    $parts = Get-CimAssociatedInstance -InputObject $d -Association Win32_DiskDriveToDiskPartition
    $letters = @()
    $label = $null
    foreach ($p in $parts) {
      $lds = Get-CimAssociatedInstance -InputObject $p -Association Win32_LogicalDiskToPartition
      foreach ($l in $lds) {
        if ($null -ne $l.DeviceID) {
          $letters += $l.DeviceID
          if (-not $label) { $label = $l.VolumeName }
        }
      }
    }
    $letter = if ($letters.Count -gt 0) { $letters[0] } else { $null }
    $obj = [PSCustomObject]@{
      physIndex   = [int]$d.Index
      model       = [string]$d.Model
      sizeBytes   = [int64]$d.Size
      sizeDisplay = [Math]::Round(([double]$d.Size)/1GB,0)
      letter      = $letter
      volumeLabel = $label
    }
    $result += $obj
  }
}
else {
  # WMI clásico
  $diskDrives = Get-WmiObject Win32_DiskDrive | Where-Object { $_.InterfaceType -eq 'USB' -or $_.MediaType -like '*Removable*' }
  foreach ($d in $diskDrives) {
    $parts = @(ASSOCIATORS OF \\ROOT\\cimv2:Win32_DiskDrive.DeviceID="$($d.DeviceID.Replace('\\','\\\\"'))" WHERE AssocClass=Win32_DiskDriveToDiskPartition)
    $letters = @()
    $label = $null
    foreach ($p in $parts) {
      $lds = @(ASSOCIATORS OF \\ROOT\\cimv2:Win32_DiskPartition.DeviceID="$($p.DeviceID)" WHERE AssocClass=Win32_LogicalDiskToPartition)
      foreach ($l in $lds) {
        if ($null -ne $l.DeviceID) {
          $letters += $l.DeviceID
          if (-not $label) { $label = $l.VolumeName }
        }
      }
    }
    $letter = if ($letters.Count -gt 0) { $letters[0] } else { $null }
    $obj = [PSCustomObject]@{
      physIndex   = [int]$d.Index
      model       = [string]$d.Model
      sizeBytes   = [int64]$d.Size
      sizeDisplay = [Math]::Round(([double]$d.Size)/1GB,0)
      letter      = $letter
      volumeLabel = $label
    }
    $result += $obj
  }
}

# Devolvemos JSON (filtrando los que no tienen letra)
$result | Where-Object { $_.letter } | ConvertTo-Json -Depth 4
`.trim();

  const out = await runPS(ps);
  try {
    const arr = JSON.parse(out);
    return Array.isArray(arr) ? arr : (arr ? [arr] : []);
  } catch {
    return [];
  }
}

export default { listRemovableDrives };
