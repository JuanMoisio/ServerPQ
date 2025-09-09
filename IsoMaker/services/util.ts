import { spawn } from 'node:child_process';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';

export function run(cmd: string, args: string[], opts: any = {}): Promise<void> {
return new Promise((resolve, reject) => {
const p = spawn(cmd, args, { stdio: 'inherit', shell: false, ...opts });
p.on('error', reject);
p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
});
}

export function sha256File(filePath: string): Promise<string> {
return new Promise((resolve, reject) => {
const hash = crypto.createHash('sha256');
const rs = fs.createReadStream(filePath);
rs.on('error', reject);
rs.on('data', (chunk) => hash.update(chunk));
rs.on('end', () => resolve(hash.digest('hex')));
});
}

export const isMac = process.platform === 'darwin';
export const isWin = process.platform === 'win32';
export const homedir = os.homedir();