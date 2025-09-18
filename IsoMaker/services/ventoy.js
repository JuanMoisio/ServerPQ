// services/ventoy.js — ejecución con UAC y polling robusto de estado (ESM puro)
import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function mkWorkdir() {
  const p = path.join(os.tmpdir(), `ventoy-${Date.now()}`);
  await fsp.mkdir(p, { recursive: true });
  return p;
}

function makeArgs(payload) {
  const drive = payload.target.endsWith(':') ? payload.target : `${payload.target}:`;
  const gpt = payload.flags && payload.flags.gpt !== false;
  const mode = payload.mode === 'update' ? '/Update' : '/Install';
  const table = gpt ? '-g' : '-m';
  const tgt = drive.toUpperCase();
  return [mode, table, tgt];
}

async function readFileNum(p) {
  try {
    const s = await fsp.readFile(p, 'utf8');
    const n = parseInt(String(s).trim(), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  } catch {
    return null;
  }
}

export async function startVentoy(payload) {
  const workdir = await mkWorkdir();
  const args = makeArgs(payload); // ej: ['/Install','-g','E:']

  // Armamos ArgumentList como array PowerShell: @('/Install','-g','E:')
  const esc = (s) => String(s).replace(/'/g, "''"); // escape de comillas simples para PS
  const psArgList = `@('${args.map(esc).join("','")}')`;

  const psCmd = [
    "$ErrorActionPreference='Stop';",
    "Start-Process",
    "-FilePath", `'${esc(payload.exePath)}'`,
    "-ArgumentList", psArgList,
    "-WorkingDirectory", `'${esc(workdir)}'`,
    "-Verb", "RunAs"
  ].join(' ');

  await new Promise((resolve, reject) => {
    const p = spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`],
      { windowsHide: true }
    );
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`Start-Process exit ${code}`))));
  });

  return { workdir };
}


export async function readVentoyStatus(workdir) {
  const fPercent = path.join(workdir, 'cli_percent.txt');
  const fDone    = path.join(workdir, 'cli_done.txt');
  const fLog     = path.join(workdir, 'Ventoy2Disk.log');

  const percent = await readFileNum(fPercent);
  let state = 'waiting_uac'; // 'waiting_uac' | 'running' | 'success' | 'failure'
  if (percent !== null && percent > 0) state = 'running';

  let doneTxt = '';
  try { doneTxt = (await fsp.readFile(fDone, 'utf8')).toLowerCase(); } catch {}

  if (doneTxt.includes('success') || doneTxt.includes('ok') || doneTxt.includes('exit code: 0')) {
    state = 'success';
  } else if (doneTxt.includes('fail') || doneTxt.includes('error') || doneTxt.includes('exit code')) {
    state = 'failure';
  }

  let logTail = '';
  try {
    const buf = await fsp.readFile(fLog, 'utf8');
    logTail = buf.split(/\r?\n/).slice(-20).join('\n');
  } catch {}

  return { state, percent: percent ?? 0, logTail };
}

export async function runVentoy(payload) {
  const { workdir } = await startVentoy(payload);
  const t0 = Date.now();
  while (Date.now() - t0 < 10 * 60_000) { // 10 min
    const s = await readVentoyStatus(workdir);
    if (s.state === 'success' || s.state === 'failure') return { status: s.state, percent: s.percent };
    await new Promise(r => setTimeout(r, 1000));
  }
  return { status: 'failure', percent: 0 };
}

export default { startVentoy, readVentoyStatus, runVentoy };
