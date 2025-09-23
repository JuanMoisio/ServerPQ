// CommonJS preload compatible con contextIsolation:true
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, args) => ipcRenderer.invoke(ch, args);
const on     = (ch, cb)   => ipcRenderer.on(ch, cb);

contextBridge.exposeInMainWorld('api', {
  // DRIVES
  async listDrives() {
    return await invoke('drives:list');
  },

  // VENTOY
  async ventoyDefaultPath() {
    return await invoke('ventoy:defaultPath');
  },
  async ventoyPickExe() {
    return await invoke('ventoy:pickExe');
  },
  async ventoyStart({ exePath, mode = 'install', target, flags = {} }) {
    const payload = {
      drive: target,                           // "E", "E:", "E:\\" o el objeto del drive
      exePath,
      gpt: flags?.gpt ?? true,
      nosb: flags?.nosb ?? true,
      nousbcheck: flags?.nousbcheck ?? false,
    };
    return await invoke('ventoy:start', payload);
  },
  onVentoyProgress(cb) { on('ventoy:progress', cb); },

  async ventoyProbe(letter, label) {
    return await invoke('ventoy:probe', { letter, label });
  },

  // REPO
  async repoIndex(baseUrl) { return await invoke('repo:index', baseUrl); },
  async hashVerify({ filePath, sha256 }) {
    return await invoke('hash:verify', { filePath, sha256 });
  },
  onRepoProgress(cb) { on('repo:progress', cb); },
  onRepoDone(cb)     { on('repo:done', cb); },
  async repoDownloadStart(payload) {
    return await invoke('repo:downloadStart', payload);
  },

  // PQTOOLS
  async pqtoolsDefaultSrc() { return await invoke('pqtools:defaultSrc'); },
  async pqtoolsInstall({ driveLetter, srcDir }) {
    return await invoke('pqtools:install', { driveLetter: driveLetter, srcDir });
  },

  // WINPE
  async winpeInstallPack({ driveLetter, isoRelative, scriptsRelative } = {}) {
    return await invoke('winpe:installPack', { driveLetter: driveLetter, isoRelative, scriptsRelative });
  },
});
