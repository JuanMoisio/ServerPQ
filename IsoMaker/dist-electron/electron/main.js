// electron/main.ts — núcleo con IPC y carga perezosa de services
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as url from 'node:url';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import * as path from 'path';
const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.ELECTRON_START_URL;
let win = null;
function log(...a) { console.log('[main]', ...a); }
function err(...a) { console.error('[main]', ...a); }
// helpers
function unwrap(mod) {
    if (mod && typeof mod === 'object' && 'default' in mod && mod.default && typeof mod.default === 'object') {
        return { ...mod.default, ...mod };
    }
    return mod;
}
function hrefFrom(rel) {
    const abs = isDev ? path.resolve(process.cwd(), rel) : path.resolve(__dirname2, '../', rel);
    return pathToFileURL(abs).href;
}
// servicios (lazy)
async function loadDrives() { const m = await import(hrefFrom('services/drives.js')); return unwrap(m); }
async function loadVentoy() { const m = await import(hrefFrom('services/ventoy.js')); return unwrap(m); }
async function loadRepo() { const m = await import(hrefFrom('services/repo.js')); return unwrap(m); }
async function loadPQTools() { const m = await import(hrefFrom('services/pqtools.js')); return unwrap(m); }
async function loadProbe() { const m = await import(hrefFrom('services/ventoy-probe.js')); return unwrap(m); }
// winpe está en TS; lo importamos por ruta de fuente (dev) o dist (prod) según empaquete
async function loadWinPE() {
    // en DEV tomamos services/winpe.ts compilado a dist-electron/services/winpe.js por tsc (tu build:build:main)
    // en PROD vivirá cerca del main compilado
    const tryHrefs = [
        hrefFrom('services/winpe.js'),
        pathToFileURL(path.resolve(process.cwd(), 'dist-electron', 'services', 'winpe.js')).href
    ];
    for (const href of tryHrefs) {
        try {
            const m = await import(href);
            return unwrap(m);
        }
        catch { /* try next */ }
    }
    throw new Error('No pude cargar services/winpe.js (asegurate de compilar TS a JS).');
}
async function createWindow() {
    log('createWindow: start');
    const preloadPath = isDev
        ? path.resolve(process.cwd(), 'electron', 'preload.js')
        : path.resolve(__dirname2, 'preload.js');
    win = new BrowserWindow({
        width: 1120, height: 820,
        webPreferences: { contextIsolation: true, nodeIntegration: false, preload: preloadPath }
    });
    win.on('unresponsive', () => err('BrowserWindow unresponsive'));
    win.webContents.on('did-fail-load', (_e, ec, desc) => err('did-fail-load', { ec, desc }));
    const startUrl = process.env.ELECTRON_START_URL ?? url.format({
        pathname: path.join(__dirname2, '../../dist/index.html'),
        protocol: 'file:', slashes: true
    });
    log('loadURL ->', startUrl);
    await win.loadURL(startUrl);
    log('createWindow: done');
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin')
    app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0)
    createWindow(); });
// ===== IPC =====
// DRIVES
ipcMain.handle('drives:list', async () => {
    const d = await loadDrives();
    return d.listRemovableDrives();
});
// VENTOY
ipcMain.handle('ventoy:start', async (_evt, payload) => {
    const v = await loadVentoy();
    return v.startVentoy(payload);
});
ipcMain.handle('ventoy:run', async (_evt, payload) => {
    const v = await loadVentoy();
    return v.runVentoy ? v.runVentoy(payload) : { status: 'not-implemented' };
});
ipcMain.handle('ventoy:defaultPath', async () => {
    const dev = path.resolve(process.cwd(), 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe');
    const prod = path.resolve(app.getAppPath(), 'vendor', 'ventoy', 'win', 'Ventoy2Disk.exe');
    const common = 'C:\\ventoy\\Ventoy2Disk.exe';
    if (existsSync(dev))
        return dev;
    if (existsSync(prod))
        return prod;
    return existsSync(common) ? common : '';
});
ipcMain.handle('ventoy:pickExe', async () => {
    const r = await dialog.showOpenDialog({
        title: 'Seleccionar Ventoy2Disk.exe', properties: ['openFile'],
        filters: [{ name: 'Ventoy2Disk', extensions: ['exe'] }]
    });
    if (r.canceled || !r.filePaths?.length)
        return '';
    return r.filePaths[0];
});
ipcMain.handle('ventoy:probe', async (_ev, { letter, label }) => {
    const p = await loadProbe();
    return p.probe(letter, label);
});
// REPO + HASH + DESCARGA
ipcMain.handle('repo:index', async (_evt, baseUrl) => {
    const r = await loadRepo();
    return r.fetchIndex(baseUrl);
});
ipcMain.handle('hash:verify', async (_evt, { filePath, sha256 }) => {
    const r = await loadRepo();
    return r.verifySha256(filePath, sha256);
});
ipcMain.handle('repo:downloadStart', async (evt, payload) => {
    const wc = evt.sender;
    const r = await loadRepo();
    const sendProg = (data) => wc.send('repo:progress', data);
    try {
        let out = '';
        if (payload.driveLetter) {
            const root = payload.driveLetter.endsWith('\\') ? payload.driveLetter : payload.driveLetter + '\\';
            const dest = path.win32.join(root, payload.destName || path.win32.basename(new URL(payload.url).pathname));
            const res = await r.downloadToPathWithProgress(payload.url, dest, sendProg);
            wc.send('repo:done', { ok: true, outPath: res.outPath, digest: res.digest, match: payload.sha256 ? (res.digest?.toUpperCase() === payload.sha256.toUpperCase()) : null });
            return { ok: true, outPath: res.outPath, digest: res.digest };
        }
        else {
            out = await r.downloadToWithProgress(payload.url, payload.outDir || 'C:\\Temp\\isos', sendProg);
            let vr = null;
            if (payload.sha256)
                vr = await r.verifySha256(out, payload.sha256);
            wc.send('repo:done', { ok: true, outPath: out, digest: vr?.digest, match: vr ? vr.ok : null });
            return { ok: true, outPath: out, digest: vr?.digest };
        }
    }
    catch (e) {
        wc.send('repo:done', { ok: false, error: String(e?.message || e) });
        throw e;
    }
});
// PQTOOLS
ipcMain.handle('pqtools:defaultSrc', async () => {
    const dev = path.resolve(process.cwd(), 'vendor', 'pqtools', 'win');
    const prod = path.resolve(app.getAppPath(), 'vendor', 'pqtools', 'win');
    if (existsSync(dev))
        return dev;
    if (existsSync(prod))
        return prod;
    return '';
});
ipcMain.handle('pqtools:install', async (_evt, payload) => {
    const p = await loadPQTools();
    return p.installPQTools(payload);
});
// WINPE
ipcMain.handle('winpe:installPack', async (_evt, args) => {
    const winpe = await loadWinPE();
    const appPath = app.getAppPath();
    return winpe.installPackToUSB(args, { appPath });
});
