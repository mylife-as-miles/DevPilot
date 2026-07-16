const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__DEVPILOT_ELECTRON__', Object.freeze({
  getRuntimeStatus: () => ipcRenderer.invoke('devpilot:get-runtime-status'),
  selectProject: () => ipcRenderer.invoke('devpilot:select-project'),
  launchAcp: (projectPath) => ipcRenderer.invoke('devpilot:launch-acp', projectPath),
  startAcpPrompt: (sessionId, prompt) => ipcRenderer.invoke('devpilot:start-acp-prompt', sessionId, prompt),
  onAcpUpdate: (listener) => {
    const handler = (_event, update) => listener(update);
    ipcRenderer.on('devpilot:acp-update', handler);
    return () => ipcRenderer.removeListener('devpilot:acp-update', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('devpilot:open-external', url),
}));
