// services/drives.js (ESM, sin deps nativas)
import { spawn } from 'node:child_process';

export async function listRemovableDrives() {
  const ps = `
$ErrorActionPreference = 'Stop'
$drives = Get-CimInstance Win32_DiskDrive |
  Where-Object { ($_.InterfaceType -eq 'USB') -or ($_.MediaType -like 'Removable*') }

$result = @()
foreach ($d in $drives) {
  try {
    $parts = @(Get-CimAssociatedInstance -InputObject $d -ResultClassName Win32_DiskPartition)
    foreach ($p in $parts) {
      $ldisks = @(Get-CimAssociatedInstance -InputObject $p -ResultClassName Win32_LogicalDisk)
      foreach ($l in $ldisks) {
        $obj = [pscustomobject]@{
          letter        = $l.DeviceID
          volumeLabel   = $l.VolumeName
          fileSystem    = $l.FileSystem
          sizeBytes     = [int64]$d.Size
          sizeDisplay   = [Math]::Round(($d.Size/1GB),2)
          model         = $d.Model
          serial        = $d.SerialNumber
          deviceId      = $d.DeviceID
          physIndex     = $d.Index
          mediaType     = $d.MediaType
          interfaceType = $d.InterfaceType
        }
        $result += $obj
      }
    }
  } catch {
    # discos sin letra: ignorar
  }
}
$result | ConvertTo-Json -Depth 3
`;

  const json = await execPowerShell(ps);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch {
    return [];
  }
}

function execPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err || `PowerShell exited with code ${code}`));
    });
  });
}

export default { listRemovableDrives };
