import { contextBridge, ipcRenderer } from 'electron';
const api = {
    listDrives: () => ipcRenderer.invoke('list-drives'),
    unmount: (d) => ipcRenderer.invoke('unmount', d),
    flash: (p) => ipcRenderer.invoke('flash', p),
    getRepoIndex: () => ipcRenderer.invoke('get-repo-index'),
    downloadToTemp: (n) => ipcRenderer.invoke('download-to-temp', n),
    verifySha256: (p) => ipcRenderer.invoke('verify-sha256', p),
    ventoyInstall: (d) => ipcRenderer.invoke('ventoy-install', d),
    ventoyCopyIso: (m, iso) => ipcRenderer.invoke('ventoy-copy-iso', m, iso)
};
contextBridge.exposeInMainWorld('api', api);
