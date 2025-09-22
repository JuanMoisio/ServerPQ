// services/ventoy.js — lanzar Ventoy2Disk.exe elevado (no bloquea)
import { spawn } from 'node:child_process';
import path from 'node:path';

function makeArgs(payload) {
  const parts = [];
  const mode = payload?.mode === 'update' ? '/Update' : '/Install';
  parts.push(mode);
  const gpt = payload?.flags && payload.flags.gpt !== false;
  parts.push(gpt ? '-g' : '-m');
  if (payload?.target) {
    const drive = payload.target.endsWith(':') ? payload.target : `${payload.target}:`;
    parts.push(drive.toUpperCase());
  }
  return parts;
}

export function startVentoy(payload) {
  if (!payload?.exePath) throw new Error('Falta exePath (Ventoy2Disk.exe)');
  const exe = path.normalize(payload.exePath);
  const args = makeArgs(payload);
  const esc = (s) => String(s).replace(/'/g, "''");
  const psArgList = args.length ? `-ArgumentList @('${args.map(esc).join("','")}')` : '';

  const psCmd = [
    "$ErrorActionPreference='Stop';",
    "Start-Process",
    "-FilePath", `'${esc(exe)}'`,
    psArgList,
    "-Verb", "RunAs",
    "-WindowStyle", "Normal"
  ].filter(Boolean).join(' ');

  const child = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', psCmd],
    { windowsHide: false, stdio: 'ignore', detached: true });

  try { child.unref?.(); } catch {}
  return { ok: true, launcherPid: child.pid ?? -1, note: 'Ventoy elevándose (aceptá el UAC y dale Start en su GUI)' };
}

export default { startVentoy };
