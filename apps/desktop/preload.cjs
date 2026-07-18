const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__DEVPILOT_ELECTRON__', Object.freeze({
  getRuntimeStatus: () => ipcRenderer.invoke('devpilot:get-runtime-status'),
  getCodexAuthStatus: () => ipcRenderer.invoke('devpilot:get-codex-auth-status'),
  startCodexLogin: () => ipcRenderer.invoke('devpilot:start-codex-login'),
  selectProject: () => ipcRenderer.invoke('devpilot:select-project'),
  launchAcp: (projectPath) => ipcRenderer.invoke('devpilot:launch-acp', projectPath),
  restoreAcp: () => ipcRenderer.invoke('devpilot:restore-acp'),
  startAcpPrompt: (sessionId, prompt) => ipcRenderer.invoke('devpilot:start-acp-prompt', sessionId, prompt),
  cancelAcpRun: (sessionId) => ipcRenderer.invoke('devpilot:cancel-acp-run', sessionId),
  preflight: (projectPath, options) => ipcRenderer.invoke('devpilot:preflight', projectPath, options),
  getRuntimeLogs: () => ipcRenderer.invoke('devpilot:get-runtime-logs'),
  clearRuntimeLogs: () => ipcRenderer.invoke('devpilot:clear-runtime-logs'),
  onRuntimeLog: (listener) => {
    const handler = (_event, entry) => listener(entry);
    ipcRenderer.on('devpilot:runtime-log', handler);
    return () => ipcRenderer.removeListener('devpilot:runtime-log', handler);
  },
  onAcpUpdate: (listener) => {
    const handler = (_event, update) => listener(update);
    ipcRenderer.on('devpilot:acp-update', handler);
    return () => ipcRenderer.removeListener('devpilot:acp-update', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('devpilot:open-external', url),
}));
