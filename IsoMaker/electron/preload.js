// electron/preload.js — puente seguro a IPC
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // DRIVES
  listDrives: () => ipcRenderer.invoke('drives:list'),

  // VENTOY
  ventoyStart: (payload) => ipcRenderer.invoke('ventoy:start', payload),
  ventoyRun:   (payload) => ipcRenderer.invoke('ventoy:run', payload), // opcional (bloqueante)
  ventoyDefaultPath: () => ipcRenderer.invoke('ventoy:defaultPath'),
  ventoyPickExe:     () => ipcRenderer.invoke('ventoy:pickExe'),
  ventoyProbe: (letter, label) => ipcRenderer.invoke('ventoy:probe', { letter, label }),

  // REPO + HASH + DESCARGA
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

  // PQTOOLS + WINPE
  pqtoolsDefaultSrc: () => ipcRenderer.invoke('pqtools:defaultSrc'),
  pqtoolsInstall:    (payload) => ipcRenderer.invoke('pqtools:install', payload),
  winpeInstallPack:  (args) => ipcRenderer.invoke('winpe:installPack', args),
});
