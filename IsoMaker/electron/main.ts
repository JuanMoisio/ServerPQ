import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { listDrives, unmount } from '../services/drives.js';
import { flash } from '../services/flash.js';
import { getRepoIndex, downloadToTemp, verifySha256 } from '../services/repo.js';
import { ventoyInstall, ventoyCopyIso } from '../services/ventoy.js';

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

let win: BrowserWindow | null = null;

function createWindow() {
win = new BrowserWindow({
width: 1100,
height: 720,
title: 'PQ-USB Creator',
webPreferences: {
preload: path.join(__dirname, '../electron/preload.js'),
contextIsolation: true,
nodeIntegration: false,
sandbox: true
}
});

if (process.env.VITE_DEV_SERVER_URL) {
win.loadURL(process.env.VITE_DEV_SERVER_URL);
win.webContents.openDevTools({ mode: 'detach' });
} else {
win.loadFile(path.join(__dirname, '../dist/index.html'));
}
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// IPC handlers
ipcMain.handle('list-drives', async () => listDrives());
ipcMain.handle('unmount', async (_e, device: string) => unmount(device));
ipcMain.handle('flash', async (_e, p) => flash(p));
ipcMain.handle('get-repo-index', async () => getRepoIndex());
ipcMain.handle('download-to-temp', async (_e, name: string) => downloadToTemp(name));
ipcMain.handle('verify-sha256', async (_e, p: string) => verifySha256(p));
ipcMain.handle('ventoy-install', async (_e, device: string) => ventoyInstall(device));
ipcMain.handle('ventoy-copy-iso', async (_e, mount: string, iso: string) => ventoyCopyIso(mount, iso));

process.on('uncaughtException', (err) => {
dialog.showErrorBox('Error inesperado', String(err));
});