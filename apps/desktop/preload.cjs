const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__DEVPILOT_ELECTRON__', Object.freeze({
  getRuntimeStatus: () => ipcRenderer.invoke('devpilot:get-runtime-status'),
  getCodexAuthStatus: () => ipcRenderer.invoke('devpilot:get-codex-auth-status'),
  startCodexLogin: () => ipcRenderer.invoke('devpilot:start-codex-login'),
  selectProjectFolder: () => ipcRenderer.invoke('devpilot:select-project-folder'),
  openProject: (projectPath) => ipcRenderer.invoke('devpilot:project-open', projectPath),
  listProjects: () => ipcRenderer.invoke('devpilot:project-list'),
  getProject: (projectId) => ipcRenderer.invoke('devpilot:project-get', projectId),
  removeProject: (projectId) => ipcRenderer.invoke('devpilot:project-remove', projectId),
  preflightProject: (projectId) => ipcRenderer.invoke('devpilot:project-preflight', projectId),
  listModels: () => ipcRenderer.invoke('devpilot:models-list'),
  createConversation: (input) => ipcRenderer.invoke('devpilot:conversation-create', input),
  listConversations: (projectId, includeArchived) => ipcRenderer.invoke('devpilot:conversation-list', projectId, includeArchived),
  openConversation: (projectId, conversationId) => ipcRenderer.invoke('devpilot:conversation-open', projectId, conversationId),
  renameConversation: (input) => ipcRenderer.invoke('devpilot:conversation-rename', input),
  pinConversation: (input) => ipcRenderer.invoke('devpilot:conversation-pin', input),
  archiveConversation: (input) => ipcRenderer.invoke('devpilot:conversation-archive', input),
  deleteConversation: (input) => ipcRenderer.invoke('devpilot:conversation-delete', input),
  sendConversationMessage: (input) => ipcRenderer.invoke('devpilot:conversation-send', input),
  resumeConversation: (input) => ipcRenderer.invoke('devpilot:conversation-resume', input),
  cancelConversationRun: (input) => ipcRenderer.invoke('devpilot:run-cancel', input),
  getConversationRunStatus: (input) => ipcRenderer.invoke('devpilot:run-status', input),
  listChanges: (projectId) => ipcRenderer.invoke('devpilot:changes-list', projectId),
  readChangeDiff: (input) => ipcRenderer.invoke('devpilot:changes-diff', input),
  getUiState: () => ipcRenderer.invoke('devpilot:get-ui-state'),
  saveUiState: (patch) => ipcRenderer.invoke('devpilot:save-ui-state', patch),
  getRuntimeLogs: () => ipcRenderer.invoke('devpilot:get-runtime-logs'),
  clearRuntimeLogs: () => ipcRenderer.invoke('devpilot:clear-runtime-logs'),
  openExternal: (url) => ipcRenderer.invoke('devpilot:open-external', url),
  onRuntimeEvent: (listener) => {
    const handler = (_event, runtimeEvent) => listener(runtimeEvent);
    ipcRenderer.on('devpilot:runtime-event', handler);
    return () => ipcRenderer.removeListener('devpilot:runtime-event', handler);
  },
  onRuntimeLog: (listener) => {
    const handler = (_event, entry) => listener(entry);
    ipcRenderer.on('devpilot:runtime-log', handler);
    return () => ipcRenderer.removeListener('devpilot:runtime-log', handler);
  },
  onUiState: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('devpilot:ui-state', handler);
    return () => ipcRenderer.removeListener('devpilot:ui-state', handler);
  },
}));
