import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import * as url from 'node:url';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.ELECTRON_START_URL;
let win: BrowserWindow | null = null;

function log(...a: any[]) { console.log('[main]', ...a); }
function err(...a: any[]) { console.error('[main]', ...a); }

// --- helper: unwrap default/named ---
function unwrap<T extends object = any>(mod: any): T {
  if (mod && typeof mod === 'object' && 'default' in mod && mod.default && typeof mod.default === 'object') {
    return { ...mod.default, ...mod } as T;
  }
  return mod as T;
}
// --- helper: file:// href to local service file ---
function hrefFrom(rel: string): string {
  const abs = isDev ? path.resolve(process.cwd(), rel) : path.resolve(__dirname2, '../', rel);
  return pathToFileURL(abs).href;
}

// --- imports perezosos por servicio (evita petar si uno rompe) ---
async function loadDrives() {
  const m = await import(hrefFrom('services/drives.js')); return unwrap(m);
}
async function loadVentoy() {
  const m = await import(hrefFrom('services/ventoy.js')); return unwrap(m);
}
async function loadRepo() {
  const m = await import(hrefFrom('services/repo.js')); return unwrap(m);
}
async function loadPQTools() {
  const m = await import(hrefFrom('services/pqtools.js')); return unwrap(m);
}

async function createWindow() {
  try {
    log('createWindow: start');
    const preloadPath = isDev
      ? path.resolve(process.cwd(), 'electron', 'preload.js')
      : path.resolve(__dirname2, 'preload.js');

    if (!existsSync(preloadPath)) log('WARN preload not found at', preloadPath);

    win = new BrowserWindow({
      width: 1100,
      height: 800,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath
      }
    });

    win.on('unresponsive', () => err('BrowserWindow unresponsive'));
    win.webContents.on('render-process-gone', (_e, details) => err('render-process-gone', details));
    win.webContents.on('did-fail-load', (_e, ec, desc, v, u) => err('did-fail-load', { ec, desc, v, u }));

    const startUrl = process.env.ELECTRON_START_URL ?? url.format({
      pathname: path.join(__dirname2, '../../dist/index.html'),
      protocol: 'file:',
      slashes: true
    });

    log('loadURL ->', startUrl);
    await win.loadURL(startUrl);
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
    log('createWindow: done');
  } catch (e: any) {
    err('createWindow error:', e);
    dialog.showErrorBox('Electron startup error', String(e?.stack || e));
    throw e;
  }
}

app.whenReady().then(async () => {
  log('app.whenReady');
  // single-instance (opcional, por si quedó zombie)
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    log('second-instance -> quit');
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  await createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// Robust logging de errores globales
process.on('uncaughtException', (e) => err('uncaughtException:', e));
process.on('unhandledRejection', (r) => err('unhandledRejection:', r));

async function loadWinPE() {
  const m = await import(hrefFrom('services/winpe.js'));
  return (m && m.default) ? { ...m.default, ...m } : m;
}


// ================= IPC =================

// DRIVES: import perezoso (no toca ventoy ni otros módulos)
ipcMain.handle('drives:list', async () => {
  log('ipc drives:list');
  const drives = await loadDrives();
  return drives.listRemovableDrives();
});

// VENTOY (no bloquear UI; progreso vía polling desde el service)
const progressTimers = new Map<number, NodeJS.Timeout>();
function stopProgressTimer(id: number) {
  const t = progressTimers.get(id);
  if (t) { clearInterval(t); progressTimers.delete(id); }
}

ipcMain.handle('ventoy:start', async (evt, payload: { target: string; physIndex?: number }) => {
  const wc = evt.sender; const webId = wc.id;
  stopProgressTimer(webId);

  const ventoy = await loadVentoy();
  const drives = await loadDrives();

  const startLetter = (payload.target || '').toUpperCase().replace(/:?$/, ':');   // ej. "E:"
  const targetPhys  = (typeof payload.physIndex === 'number') ? payload.physIndex : undefined;

  const { workdir } = await ventoy.startVentoy(payload);

  const tStart = Date.now();
  let staleCount = 0;
  let sawGone = false;      // desapareció (reparticionando)
  let lastLetter = startLetter;

  const timer = setInterval(async () => {
    try {
      // 1) Status por archivos (si existieran)
      const s = await ventoy.readVentoyStatus(workdir);

      // 2) Status por DISCO (robusto): buscar por physIndex y/o por letra inicial
      let current = null as null | { letter: string; volumeLabel?: string };
      try {
        const list = await drives.listRemovableDrives();
        if (targetPhys !== undefined) {
          current = list.find((d: any) => d.physIndex === targetPhys) || null;
        }
        if (!current) {
          // fallback por letra inicial
          current = list.find((d: any) => (d.letter || '').toUpperCase() === lastLetter) || null;
        }
      } catch {}

      // Detectar desaparición / reaparición
      if (!current) {
        // Si antes estaba y ahora no, lo tomamos como "running"
        sawGone = true;
        wc.send('ventoy:progress', { percent: Math.max(1, s.percent ?? 0), state: 'running' });
      } else {
        // trackear si cambió de letra
        const curLetter = (current.letter || '').toUpperCase().replace(/:?$/, ':');
        lastLetter = curLetter || lastLetter;

        const label = String(current.volumeLabel || '').toUpperCase();
        const labelIsVentoy = label === 'VENTOY';

        if (labelIsVentoy) {
          // ✅ Éxito por etiqueta (aunque Ventoy no genere cli_done.txt)
          stopProgressTimer(webId);
          wc.send('ventoy:progress', { percent: 100, state: 'success' });
          wc.send('ventoy:done', { state: 'success', percent: 100, detectedLabel: true, newLetter: lastLetter, workdir });
          return;
        }

        // Si reaparece pero aún sin etiqueta VENTOY, seguimos "running"
        if (sawGone) {
          wc.send('ventoy:progress', { percent: Math.max(5, s.percent ?? 0), state: 'running' });
        }
      }

      // Mantener compatibilidad con status por workdir
      if ((s.percent ?? 0) === 0 && s.state !== 'success' && s.state !== 'failure') {
        staleCount++;
        if (staleCount === 5) {
          wc.send('ventoy:progress', { percent: 0, state: 'waiting_uac' });
        }
      } else {
        staleCount = 0;
        wc.send('ventoy:progress', s);
      }

      const tooLong = Date.now() - tStart > 10 * 60_000;
      if (s.state === 'success' || s.state === 'failure' || tooLong) {
        stopProgressTimer(webId);
        wc.send('ventoy:done', { ...s, workdir, timeout: tooLong });
      }
    } catch (e) {
      stopProgressTimer(webId);
      wc.send('ventoy:done', { state: 'failure', percent: 0, error: String(e) });
    }
  }, 1000);

  progressTimers.set(webId, timer);
  return { workdir };
});


ipcMain.handle('ventoy:cancelProgress', async (evt) => { stopProgressTimer(evt.sender.id); return true; });

ipcMain.handle('ventoy:run', async (_evt, payload) => {
  log('ipc ventoy:run', payload);
  const ventoy = await loadVentoy();
  return ventoy.runVentoy(payload);
});
ipcMain.handle('ventoy:copyIso', async (_evt, payload) => {
  log('ipc ventoy:copyIso', payload);
  const ventoy = await loadVentoy();
  return ventoy.copyIsoToDrive ? ventoy.copyIsoToDrive(payload) : { ok: false, error: 'copyIsoToDrive no implementado' };
});

// Helpers Ventoy
ipcMain.handle('ventoy:defaultPath', async () => {
  const devPath = path.resolve(process.cwd(), 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe');
  const prodPath = path.resolve(app.getAppPath(), 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe');
  const common = 'C:\\ventoy\\Ventoy2Disk.exe';
  if (existsSync(devPath)) return devPath;
  if (existsSync(prodPath)) return prodPath;
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

// REPO + HASH
ipcMain.handle('repo:index', async (_evt, baseUrl) => {
  log('ipc repo:index', baseUrl);
  const repo = await loadRepo();
  const fn = repo.fetchIndex ?? repo.default?.fetchIndex;
  if (!fn) throw new Error('fetchIndex export not found in services/repo.js');
  return fn(baseUrl);
});
ipcMain.handle('hash:verify', async (_evt, { filePath, sha256 }) => {
  log('ipc hash:verify', filePath);
  const repo = await loadRepo();
  const fn = repo.verifySha256 ?? repo.default?.verifySha256;
  if (!fn) throw new Error('verifySha256 export not found');
  return fn(filePath, sha256);
});
ipcMain.handle('repo:downloadStart', async (evt, payload) => {
  const wc = evt.sender; log('ipc repo:downloadStart', payload?.url);
  const repo = await loadRepo();
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

// PQTools
ipcMain.handle('pqtools:defaultSrc', async () => {
  const dev = path.resolve(process.cwd(), 'vendor', 'pqtools', 'win');
  const prod = path.resolve(app.getAppPath(), 'vendor', 'pqtools', 'win');
  if (existsSync(dev)) return dev;
  if (existsSync(prod)) return prod;
  return '';
});
ipcMain.handle('pqtools:install', async (_evt, payload) => {
  log('ipc pqtools:install', payload?.driveLetter);
  const pqtools = await loadPQTools();
  return pqtools.installPQTools(payload);
});
ipcMain.handle('winpe:installPack', async (_evt, payload) => {
  const winpe = await loadWinPE();
  return winpe.installWinPEPack(payload || {});
});