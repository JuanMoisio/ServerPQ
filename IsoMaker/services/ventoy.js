// services/ventoy.js — UAC + progreso por archivos CLI (cli_percent/done/log)
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function psQuote(str) { return `'${String(str).replace(/'/g, "''")}'`; }

function execPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => { code === 0 ? resolve() : reject(new Error(err || `PowerShell exited with code ${code}`)); });
  });
}

async function makeWorkdir() {
  if (process.platform === 'win32') {
    const pub = process.env.PUBLIC || path.join(os.homedir(), 'Public');
    const base = path.join(pub, 'VentoyCLI');
    await fsp.mkdir(base, { recursive: true });
    return await fsp.mkdtemp(path.join(base, 'run-'));
  }
  return await fsp.mkdtemp(path.join(os.tmpdir(), 'ventoy-cli-'));
}

// === API 1: startVentoy (no bloquea) + readVentoyStatus (snapshot)
export async function startVentoy(opts) {
  const { exePath, mode, targetType, target, flags = {} } = opts || {};
  if (!exePath || !mode || !targetType || (target == null)) throw new Error('Missing Ventoy parameters');

  const workdir = await makeWorkdir();

  const cmd = 'VTOYCLI';
  const action = mode === 'install' ? '/I' : '/U';
  const diskArg = targetType === 'PhyDrive' ? `/PhyDrive:${target}` : `/Drive:${String(target).toUpperCase()}`;
  const extra = [];
  if (flags.gpt) extra.push('/GPT');
  if (flags.nosb) extra.push('/NOSB');
  if (flags.nousbcheck) extra.push('/NOUSBCheck');
  if (flags.reserveMB) extra.push(`/R:${flags.reserveMB}`);
  if (flags.fs) extra.push(`/FS:${flags.fs}`);
  if (flags.nondest) extra.push('/NonDest');

  const argumentList = `${cmd} ${action} ${diskArg} ${extra.join(' ')}`.trim();

  // Lanzamos como admin SIN -Wait para poder poller los archivos de progreso
  const ps = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath ${psQuote(exePath)} -ArgumentList ${psQuote(argumentList)} -WorkingDirectory ${psQuote(workdir)} -Verb RunAs
`;
  await execPowerShell(ps);
  return { workdir };
}

export async function readVentoyStatus(workdir) {
  const donePath = path.join(workdir, 'cli_done.txt');
  const percPath = path.join(workdir, 'cli_percent.txt');
  const logPath  = path.join(workdir, 'cli_log.txt');

  let percent = null;
  try {
    const raw = await fsp.readFile(percPath, 'utf8');
    const v = parseInt(raw.trim(), 10);
    if (!Number.isNaN(v)) percent = Math.max(0, Math.min(100, v));
  } catch {}

  let state = 'running';
  let exitCode = null;
  try {
    const raw = await fsp.readFile(donePath, 'utf8');
    exitCode = parseInt(raw.trim(), 10);
    state = exitCode === 0 ? 'success' : 'failure';
  } catch {}

  let logTail = '';
  try {
    const log = await fsp.readFile(logPath, 'utf8');
    logTail = log.length > 4000 ? log.slice(-4000) : log;
  } catch {}

  return { state, percent, exitCode, logTail };
}

// === API 2 (bloqueante, por compat)
export async function runVentoy(opts) {
  const { exePath, mode, targetType, target, flags = {} } = opts || {};
  if (!exePath || !mode || !targetType || (target == null)) throw new Error('Missing Ventoy parameters');

  const workdir = await makeWorkdir();
  const cmd = 'VTOYCLI';
  const action = mode === 'install' ? '/I' : '/U';
  const diskArg = targetType === 'PhyDrive' ? `/PhyDrive:${target}` : `/Drive:${String(target).toUpperCase()}`;
  const extra = [];
  if (flags.gpt) extra.push('/GPT');
  if (flags.nosb) extra.push('/NOSB');
  if (flags.nousbcheck) extra.push('/NOUSBCheck');
  if (flags.reserveMB) extra.push(`/R:${flags.reserveMB}`);
  if (flags.fs) extra.push(`/FS:${flags.fs}`);
  if (flags.nondest) extra.push('/NonDest');
  const argumentList = `${cmd} ${action} ${diskArg} ${extra.join(' ')}`.trim();

  const ps = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath ${psQuote(exePath)} -ArgumentList ${psQuote(argumentList)} -WorkingDirectory ${psQuote(workdir)} -Verb RunAs -Wait
`;
  await execPowerShell(ps);

  const donePath = path.join(workdir, 'cli_done.txt');
  const percPath = path.join(workdir, 'cli_percent.txt');
  const logPath  = path.join(workdir, 'cli_log.txt');

  let status = 'unknown';
  try {
    const done = (await fsp.readFile(donePath, 'utf8')).trim();
    status = done === '0' ? 'success' : 'failure';
  } catch {}
  let percent = null;
  try { percent = parseInt((await fsp.readFile(percPath, 'utf8')).trim(), 10); } catch {}
  let log = '';
  try { log = await fsp.readFile(logPath, 'utf8'); } catch {}
  return { workdir, status, percent, log };
}

export async function copyIsoToDrive({ isoPath, driveLetter, destName }) {
  const src = path.resolve(isoPath);
  const root = String(driveLetter).endsWith('\\') ? String(driveLetter) : String(driveLetter) + '\\';
  const dst = path.join(root, destName || path.basename(src));
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  const ps = `Copy-Item -LiteralPath ${psQuote(src)} -Destination ${psQuote(dst)} -Force`;
  await execPowerShell(ps);
  return { dst };
}

export default { startVentoy, readVentoyStatus, runVentoy, copyIsoToDrive };
