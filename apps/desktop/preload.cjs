const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__DEVPILOT_ELECTRON__', Object.freeze({
  getRuntimeStatus: () => ipcRenderer.invoke('devpilot:get-runtime-status'),
  getCodexAuthStatus: () => ipcRenderer.invoke('devpilot:get-codex-auth-status'),
  startCodexLogin: () => ipcRenderer.invoke('devpilot:start-codex-login'),
  selectProject: () => ipcRenderer.invoke('devpilot:select-project'),
  getWorkspace: () => ipcRenderer.invoke('devpilot:get-workspace'),
  addProject: () => ipcRenderer.invoke('devpilot:add-project'),
  activateProject: (projectId) => ipcRenderer.invoke('devpilot:activate-project', projectId),
  activateTask: (taskId) => ipcRenderer.invoke('devpilot:activate-task', taskId),
  createTask: (projectId, input) => ipcRenderer.invoke('devpilot:create-task', projectId, input),
  sendTaskPrompt: (taskId, prompt, input) => ipcRenderer.invoke('devpilot:send-task-prompt', taskId, prompt, input),
  cancelTask: (taskId) => ipcRenderer.invoke('devpilot:cancel-task', taskId),
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
  onWorkspaceChanged: (listener) => {
    const handler = (_event, workspace) => listener(workspace);
    ipcRenderer.on('devpilot:workspace-changed', handler);
    return () => ipcRenderer.removeListener('devpilot:workspace-changed', handler);
  },
  onTaskUpdate: (listener) => {
    const handler = (_event, update) => listener(update);
    ipcRenderer.on('devpilot:task-update', handler);
    return () => ipcRenderer.removeListener('devpilot:task-update', handler);
  },
  openExternal: (url) => ipcRenderer.invoke('devpilot:open-external', url),
}));
