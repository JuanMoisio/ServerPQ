import { spawn } from 'node:child_process';
// PowerShell elevation with Start-Process -Verb RunAs so UAC prompts
const ps = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath ${toPS(exePath)} -ArgumentList ${toPS(argumentList)} -WorkingDirectory ${toPS(workdir)} -Verb RunAs -Wait
`;
await execPowerShell(ps);
// Read result files created by Ventoy CLI in workdir
const donePath = path.join(workdir, 'cli_done.txt');
const percPath = path.join(workdir, 'cli_percent.txt');
const logPath = path.join(workdir, 'cli_log.txt');
let status = 'unknown';
try {
    const done = (await fsp.readFile(donePath, 'utf8')).trim();
    status = done === '0' ? 'success' : 'failure';
}
catch { }
let percent = null;
try {
    percent = parseInt((await fsp.readFile(percPath, 'utf8')).trim(), 10);
}
catch { }
let log = '';
try {
    log = await fsp.readFile(logPath, 'utf8');
}
catch { }
return { workdir, status, percent, log };
/** Copy an ISO onto the Ventoy data partition (drive letter like 'D:'). */
export async function copyIsoToDrive({ isoPath, driveLetter, destName }) {
    const src = path.resolve(isoPath);
    const dstDir = `${driveLetter.replace(/\\$/, '')}`; // like D:
    const dst = path.join(dstDir, destName || path.basename(src));
    await streamCopy(src, dst);
    return { dst };
}
async function streamCopy(src, dst) {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    // Using PowerShell for progress-insensitive copy to avoid long path quirks
    const ps = `Copy-Item -LiteralPath ${toPS(src)} -Destination ${toPS(dst)} -Force`;
    await execPowerShell(ps);
}
function toPS(str) {
    // Quote for PowerShell -ArgumentList; handles embedded quotes
    const s = String(str).replace('`', '``').replace('"', '\"');
    return `'${s.replace(/'/g, "''")}'`;
}
function execPowerShell(script) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
        let err = '';
        child.stderr.on('data', (d) => (err += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => { code === 0 ? resolve() : reject(new Error(err || `PowerShell exited with code ${code}`)); });
    });
}
export default { runVentoy, copyIsoToDrive };
