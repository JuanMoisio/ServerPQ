// electron/main.ts — imports dinámicos robustos (ESM/CJS) + IPC
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import * as url from 'node:url';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
let win: BrowserWindow | null = null;
const isDev = !!process.env.ELECTRON_START_URL;

// Unwrap: si viene CJS como default, mezclo default + namespace
function unwrap<T extends object = any>(mod: any): T {
  if (mod && typeof mod === 'object' && 'default' in mod && mod.default && typeof mod.default === 'object') {
    return { ...mod.default, ...mod } as T;
  }
  return mod as T;
}

function hrefFrom(rel: string): string {
  const abs = isDev ? path.resolve(process.cwd(), rel) : path.resolve(__dirname2, '../', rel);
  return pathToFileURL(abs).href;
}

async function loadServices() {
  const drives = unwrap(await import(hrefFrom('services/drives.js')));
  const ventoy = unwrap(await import(hrefFrom('services/ventoy.js')));
  const repo   = unwrap(await import(hrefFrom('services/repo.js')));
  return { drives, ventoy, repo };
}

async function createWindow() {
  const preloadPath = isDev
    ? path.resolve(process.cwd(), 'electron', 'preload.js')
    : path.resolve(__dirname2, 'preload.js');

  win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: preloadPath }
  });

  const startUrl = process.env.ELECTRON_START_URL ?? url.format({
    pathname: path.join(__dirname2, '../../dist/index.html'),
    protocol: 'file:',
    slashes: true
  });
  await win.loadURL(startUrl);
  if (isDev) win!.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

process.on('uncaughtException', (err) => console.error('[main] uncaughtException:', err));
process.on('unhandledRejection', (reason) => console.error('[main] unhandledRejection:', reason));

// ===== IPC: Drives =====
ipcMain.handle('drives:list', async () => {
  const { drives } = await loadServices();
  return drives.listRemovableDrives();
});

// ===== Ventoy con progreso =====
const progressTimers = new Map<number, NodeJS.Timeout>();
function stopProgressTimer(webContentsId: number) {
  const t = progressTimers.get(webContentsId);
  if (t) { clearInterval(t); progressTimers.delete(webContentsId); }
}

ipcMain.handle('ventoy:start', async (evt, payload) => {
  const wc = evt.sender; const webId = wc.id;
  stopProgressTimer(webId);
  const { ventoy } = await loadServices();
  const { workdir } = await ventoy.startVentoy(payload);

  const timer = setInterval(async () => {
    try {
      const s = await ventoy.readVentoyStatus(workdir);
      wc.send('ventoy:progress', { percent: s.percent, state: s.state });
      if (s.state !== 'running') {
        stopProgressTimer(webId);
        wc.send('ventoy:done', { ...s, workdir });
      }
    } catch (e) {
      stopProgressTimer(webId);
      wc.send('ventoy:done', { state: 'failure', percent: null, exitCode: -1, error: String(e) });
    }
  }, 600);

  progressTimers.set(webId, timer);
  return { workdir };
});
ipcMain.handle('ventoy:cancelProgress', async (evt) => { stopProgressTimer(evt.sender.id); return true; });

// Legacy
ipcMain.handle('ventoy:run', async (_evt, payload) => {
  const { ventoy } = await loadServices();
  return ventoy.runVentoy(payload);
});
ipcMain.handle('ventoy:copyIso', async (_evt, payload) => {
  const { ventoy } = await loadServices();
  return ventoy.copyIsoToDrive(payload);
});

// ===== Helpers Ventoy =====
ipcMain.handle('ventoy:defaultPath', async () => {
  const devPath = path.resolve(process.cwd(), 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe');
  const prodPath = path.resolve(app.getAppPath(), 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe');
  if (existsSync(devPath)) return devPath;
  if (existsSync(prodPath)) return prodPath;
  const common = 'C:\\ventoy\\Ventoy2Disk.exe';
  return existsSync(common) ? common : '';
});
ipcMain.handle('ventoy:pickExe', async () => {
  const r = await dialog.showOpenDialog({
    title: 'Seleccionar Ventoy2Disk.exe',
    properties: ['openFile'],
    filters: [{ name: 'Ventoy2Disk', extensions: ['exe'] }]
  });
  if (r.canceled || !r.filePaths?.length) return '';
  return r.filePaths[0];
});

// ===== Repo + Hash =====
ipcMain.handle('repo:index', async (_evt, baseUrl) => {
  const { repo } = await loadServices();
  const fn = repo.fetchIndex ?? repo.default?.fetchIndex;
  if (!fn) throw new Error('fetchIndex export not found in services/repo.js');
  return fn(baseUrl);
});
ipcMain.handle('hash:verify', async (_evt, { filePath, sha256 }) => {
  const { repo } = await loadServices();
  const fn = repo.verifySha256 ?? repo.default?.verifySha256;
  if (!fn) throw new Error('verifySha256 export not found');
  return fn(filePath, sha256);
});

// Descarga con progreso (local o directo a USB)
ipcMain.handle('repo:downloadStart', async (evt, payload: { url: string, outDir?: string, driveLetter?: string, destName?: string, sha256?: string }) => {
  const wc = evt.sender;
  const { repo } = await loadServices();
  const dlToProg = repo.downloadToWithProgress ?? repo.default?.downloadToWithProgress;
  const dlToPath = repo.downloadToPathWithProgress ?? repo.default?.downloadToPathWithProgress;
  const verify   = repo.verifySha256 ?? repo.default?.verifySha256;

  if (!dlToProg || !dlToPath) throw new Error('download functions not found in services/repo.js');

  try {
    let resultPath = '';
    let digest: string | null = null;
    if (payload.driveLetter) {
  const root = payload.driveLetter.endsWith('\\') ? payload.driveLetter : payload.driveLetter + '\\';
  const filename = payload.destName || decodeURIComponent(new URL(payload.url).pathname.split('/').pop() || '');
  // si querés forzar subcarpeta:
  // const destPath = path.win32.join(root, 'ISOS', filename);
  const destPath = path.win32.join(root, filename);
  const r = await dlToPath(payload.url, destPath, ({ received, total, percent, filename }) => {
    wc.send('repo:progress', { received, total, percent, filename, target: 'usb' });
  });
      resultPath = r.outPath; digest = r.digest;
    } else {
      const out = await dlToProg(payload.url, payload.outDir || 'C:\\Temp\\isos', ({ received, total, percent, filename }) => {
        wc.send('repo:progress', { received, total, percent, filename, target: 'local' });
      });
      resultPath = out;
      if (payload.sha256) {
        const vr = await verify(resultPath, payload.sha256);
        digest = vr.digest;
      }
    }

    let match: boolean | null = null;
    if (payload.sha256 && digest) match = digest.toUpperCase() === payload.sha256.toUpperCase();

    wc.send('repo:done', { ok: true, outPath: resultPath, digest, match });
    return { ok: true, outPath: resultPath, digest, match };
  } catch (e) {
    wc.send('repo:done', { ok: false, error: String(e) });
    throw e;
  }
});
