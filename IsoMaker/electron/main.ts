import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ESM-safe __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const preloadPath = process.env.ELECTRON_START_URL
  ? path.join(process.cwd(), 'electron', 'preload.js')  // DEV: archivo fuente
  : path.join(__dirname, 'preload.js'); 

// Servicios (stubs/real)
import { listDrives, unmount } from '../services/drives.js';
import { flash } from '../services/flash.js';
import { getRepoIndex, downloadToTemp, verifySha256 } from '../services/repo.js';
import { ventoyInstall, ventoyCopyIso } from '../services/ventoy.js';


let win: BrowserWindow | null = null;



async function createWindow() {
  win = new BrowserWindow({
  width: 1000,
  height: 700,
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
  },
});
win.webContents.on('did-finish-load', () => {
  console.log('[electron] did-finish-load', win?.webContents.getURL());
});
win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
  console.error('[electron] did-fail-load', { code, desc, url, isMainFrame });
});
win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
  console.log(`[renderer ${level}] ${message} (${sourceId}:${line})`);
});

// útil en dev
win.webContents.openDevTools({ mode: 'detach' });


  const url = process.env.ELECTRON_START_URL || "http://localhost:5173";
  await win.loadURL(url);

  // IPC mínimos
  ipcMain.handle("list-drives", async () => listDrives());
  ipcMain.handle("unmount", async (_e, d: string) => unmount(d));
  ipcMain.handle("flash", async (_e, p: any) => {
    try { return await flash(p); }
    catch (e: any) {
      dialog.showErrorBox("Error de flasheo", e?.message ?? String(e));
      throw e;
    }
  });
  ipcMain.handle("get-repo-index", async () => getRepoIndex());
  ipcMain.handle("download-to-temp", async (_e, n: string) => downloadToTemp(n));
  ipcMain.handle("verify-sha256", async (_e, p: string) => verifySha256(p));
  ipcMain.handle("ventoy-install", async (_e, d: string) => ventoyInstall(d));
  ipcMain.handle("ventoy-copy-iso", async (_e, m: string, n: string) => ventoyCopyIso(m, n));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
