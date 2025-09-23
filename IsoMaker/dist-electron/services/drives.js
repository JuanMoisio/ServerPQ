import { spawn } from 'node:child_process';
const action = mode === 'install' ? '/I' : '/U';
const diskArg = targetType === 'PhyDrive' ? `/PhyDrive:${target}` : `/Drive:${String(target).toUpperCase()}`;
const extra = [];
if (flags.gpt)
    extra.push('/GPT');
if (flags.nosb)
    extra.push('/NOSB');
if (flags.nousbcheck)
    extra.push('/NOUSBCheck');
if (flags.reserveMB)
    extra.push(`/R:${flags.reserveMB}`);
if (flags.fs)
    extra.push(`/FS:${flags.fs}`);
if (flags.nondest)
    extra.push('/NonDest');
const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ventoy-cli-'));
const argumentList = `${cmd} ${action} ${diskArg} ${extra.join(' ')}`.trim();
const ps = `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath ${psQuote(exePath)} -ArgumentList ${psQuote(argumentList)} -WorkingDirectory ${psQuote(workdir)} -Verb RunAs -Wait
`;
await execPowerShell(ps);
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
export async function copyIsoToDrive({ isoPath, driveLetter, destName }) {
    const src = path.resolve(isoPath);
    const dstDir = `${String(driveLetter).replace(/\\$/, '')}`; // e.g. D:\
    const dst = path.join(dstDir, destName || path.basename(src));
    await streamCopy(src, dst);
    return { dst };
}
async function streamCopy(src, dst) {
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    const ps = `Copy-Item -LiteralPath ${psQuote(src)} -Destination ${psQuote(dst)} -Force`;
    await execPowerShell(ps);
}
function psQuote(str) {
    const s = String(str).replace(/'/g, "''");
    return `'${s}'`;
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
