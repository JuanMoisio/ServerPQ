// electron/preload.js — puente IPC
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Drives
  listDrives: () => ipcRenderer.invoke('drives:list'),

  // Ventoy con progreso
  ventoyStart: (payload) => ipcRenderer.invoke('ventoy:start', payload),
  ventoyCancelProgress: () => ipcRenderer.invoke('ventoy:cancelProgress'),
  onVentoyProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('ventoy:progress', h);
    return () => ipcRenderer.removeListener('ventoy:progress', h);
  },
  onVentoyDone: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('ventoy:done', h);
    return () => ipcRenderer.removeListener('ventoy:done', h);
  },

  // Ventoy legacy + helpers
  ventoyRun: (payload) => ipcRenderer.invoke('ventoy:run', payload),
  ventoyCopyIso: (payload) => ipcRenderer.invoke('ventoy:copyIso', payload),
  ventoyDefaultPath: () => ipcRenderer.invoke('ventoy:defaultPath'),
  ventoyPickExe: () => ipcRenderer.invoke('ventoy:pickExe'),

  // Repo + hash + descarga con progreso
  repoIndex: (baseUrl) => ipcRenderer.invoke('repo:index', baseUrl),
  hashVerify: (payload) => ipcRenderer.invoke('hash:verify', payload),
  repoDownloadStart: (payload) => ipcRenderer.invoke('repo:downloadStart', payload),
  onRepoProgress: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('repo:progress', h);
    return () => ipcRenderer.removeListener('repo:progress', h);
  },
  onRepoDone: (cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on('repo:done', h);
    return () => ipcRenderer.removeListener('repo:done', h);
  },

  // PQTools
  pqtoolsDefaultSrc: () => ipcRenderer.invoke('pqtools:defaultSrc'),
  pqtoolsInstall: (payload) => ipcRenderer.invoke('pqtools:install', payload),
});
