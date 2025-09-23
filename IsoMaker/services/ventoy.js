// ESM: services/ventoy.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function dbg(...a){ try{ console.log('[ventoy]', ...a) }catch{} }

function normStr(x){ return (x ?? '').toString().trim() }

// Parser hiper-tolerante del parámetro "drive"
function toDriveArg(drive) {
  dbg('toDriveArg input =', JSON.stringify(drive));

  // Caso { phy: n } o { DiskNumber: n } o { diskNumber: n }
  if (drive && typeof drive === 'object') {
    if (Number.isInteger(drive.phy)) return `/PhyDrive:${drive.phy}`;
    if (Number.isInteger(drive.DiskNumber)) return `/PhyDrive:${drive.DiskNumber}`;
    if (Number.isInteger(drive.diskNumber)) return `/PhyDrive:${drive.diskNumber}`;

    // Si vino de tu services/drives.js: puede ser { Volumes: [{ DriveLetter: 'E', Path:'E:\\' }] }
    const vol = Array.isArray(drive.Volumes) && drive.Volumes.length ? drive.Volumes[0] : null;
    const candidate =
      drive.letter ?? drive.driveLetter ?? drive.drive ?? drive.path ?? drive.mount ?? drive.root ??
      (vol ? (vol.Path ?? vol.DriveLetter) : null);

    if (candidate) return toDriveArg(candidate); // recursivo con la string
  }

  // Strings varias: "E", "E:", "E:\", "E:\algo\..."
  if (typeof drive === 'string') {
    let s = normStr(drive);
    if (!s) throw new Error('drive argument inválido');

    // Si es ruta completa, dame la letra antes de ':'
    // Match ordenados para cubrir "E:\", "E:", "E"
    let m = s.match(/^[A-Za-z](?=:\\)/) || s.match(/^[A-Za-z](?=:)/) || s.match(/^[A-Za-z]$/);
    if (!m && /^[A-Za-z]/.test(s)) m = [s[0]]; // último intento

    if (m && m[0]) {
      const L = m[0].toUpperCase();
      return `/Drive:${L}:`;
    }
  }

  throw new Error('drive argument inválido');
}

async function ensureDir(dir) { await fsp.mkdir(dir, { recursive: true }) }

async function runVentoyCli({ ventoyExe, action, drive, opts = [], onPercent, window, workingDir }) {
  if (!ventoyExe || !fs.existsSync(ventoyExe)) throw new Error(`Ventoy2Disk.exe no encontrado en: ${ventoyExe}`);
  const cwd = workingDir || await fsp.mkdtemp(path.join(os.tmpdir(), 'ventoy-cli-'));
  await ensureDir(cwd);

  const percentPath = path.join(cwd, 'cli_percent.txt');
  const donePath = path.join(cwd, 'cli_done.txt');
  const logPath = path.join(cwd, 'cli_log.txt');
  for (const f of [percentPath, donePath, logPath]) { try { await fsp.unlink(f) } catch {} }

  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `& '${ventoyExe}' VTOYCLI ${action === 'install' ? '/I' : '/U'} ${toDriveArg(drive)} ${opts.join(' ')}`];

  dbg('spawn powershell:', args.join(' '), 'cwd=', cwd);
  const child = spawn('powershell.exe', args, { cwd, windowsHide: true });

  let last = -1;
  const timer = setInterval(() => {
    try {
      if (fs.existsSync(percentPath)) {
        const pctText = fs.readFileSync(percentPath, 'utf8').trim();
        const pct = Math.max(0, Math.min(100, parseInt(pctText || '0', 10)));
        if (pct !== last) {
          last = pct;
          onPercent?.(pct);
          window?.webContents?.send('ventoy:progress', { percent: pct });
        }
      }
    } catch {}
  }, 350);

  const exitCode = await new Promise((resolve) => child.on('exit', resolve));
  clearInterval(timer);

  let ok = false;
  try { ok = (await fsp.readFile(donePath, 'utf8')).trim() === '0' } catch { ok = exitCode === 0 }

  if (!ok) {
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const err = new Error('Ventoy CLI falló');
    err.log = log;
    dbg('CLI LOG:', log);
    throw err;
  }
  return { ok: true };
}

function resolveVentoyExe({ exePath }) {
  const tries = [
    exePath,
    path.resolve(process.cwd(), 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe'),
    path.resolve(process.cwd(), 'IsoMaker', 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe'),
    'C:\\ventoy\\Ventoy2Disk.exe',
  ].filter(Boolean);
  for (const t of tries) { try { if (t && fs.existsSync(t)) return t } catch {} }
  return exePath || '';
}

export async function startVentoy({ drive, exePath, gpt = true, nosb = true, nousbcheck = false, window } = {}) {
  dbg('startVentoy payload =', JSON.stringify({ drive, exePath, gpt, nosb, nousbcheck }));
  const ventoyExe = resolveVentoyExe({ exePath });
  const opts = [];
  if (gpt) opts.push('/GPT');
  if (nosb) opts.push('/NOSB');
  if (nousbcheck) opts.push('/NOUSBCheck');

  try {
    await runVentoyCli({ ventoyExe, action: 'update', drive, opts, window });
    return { action: 'update', ok: true };
  } catch {
    await runVentoyCli({ ventoyExe, action: 'install', drive, opts, window });
    return { action: 'install', ok: true };
  }
}

export const installOrUpdate = startVentoy;
export default { startVentoy, installOrUpdate };
