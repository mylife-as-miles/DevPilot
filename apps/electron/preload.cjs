const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__DEVPILOT_ELECTRON__', Object.freeze({
  platform: process.platform,
  version: process.versions.electron,
  getRuntimeInfo: () => ipcRenderer.invoke('devpilot:get-runtime-info'),
  getRuntimeStatus: () => ipcRenderer.invoke('devpilot:get-runtime-status'),
  selectProject: () => ipcRenderer.invoke('devpilot:select-project'),
  launchAcp: (projectPath) => ipcRenderer.invoke('devpilot:launch-acp', projectPath),
  openExternal: (url) => ipcRenderer.invoke('devpilot:open-external', url),
}));
