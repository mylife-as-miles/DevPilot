const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__DEVPILOT_ELECTRON__', Object.freeze({
  platform: process.platform,
  version: process.versions.electron,
  getRuntimeInfo: () => ipcRenderer.invoke('devpilot:get-runtime-info'),
  openExternal: (url) => ipcRenderer.invoke('devpilot:open-external', url),
}));
