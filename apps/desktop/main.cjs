const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } = require('electron');
const { createReadStream, existsSync, statSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const { isAllowedExternalUrl, mimeTypeForPath, resolveStaticCandidate } = require('./desktop-shell.cjs');
const { migrateLegacyWorkspace, readDesktopState, writeDesktopState } = require('./conversation-preferences.cjs');
const runtimeClientModule = app.isPackaged
  ? path.join(process.resourcesPath, 'desktopRuntimeClient.cjs')
  : path.resolve(__dirname, '../../packages/devpilot-runtime/src/desktopRuntimeClient.cjs');
const { DevPilotRuntimeClient } = require(runtimeClientModule);

app.setName('DevPilot');

let mainWindow = null;
let staticServer = null;
let tray = null;
let runtimeClient = null;
let runtimeStarting = null;
let codexLoginInProgress = false;
let isQuitting = false;
const activeConversationIds = new Set();
const runtimeLogs = [];
let runtimeLogBytes = 0;
const MAX_RUNTIME_LOG_ENTRIES = 1000;
const MAX_RUNTIME_LOG_BYTES = 1_500_000;
const MAX_RUNTIME_LOG_ENTRY_BYTES = 16_384;

function desktopStatePath() {
  return path.join(app.getPath('userData'), 'devpilot-desktop-state.json');
}

function legacyWorkspacePath() {
  return path.join(app.getPath('userData'), 'devpilot-workspace.json');
}

function readUiState() {
  return readDesktopState(desktopStatePath());
}

function saveUiState(next) {
  const state = writeDesktopState(desktopStatePath(), next);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('devpilot:ui-state', state);
  return state;
}

function patchUiState(patch) {
  return saveUiState({ ...readUiState(), ...patch });
}

function getNativeIcon(fileName) {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.resolve(__dirname, '../ui/sources/assets/images', fileName);
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function getTrayIcon() {
  const image = getNativeIcon('devpilot-bot.png');
  return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
}

function getWindowIcon() {
  return getNativeIcon('icon.png');
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function updateTray() {
  if (!tray) return;
  const status = activeConversationIds.size > 0
    ? `${activeConversationIds.size} conversation${activeConversationIds.size === 1 ? '' : 's'} working`
    : runtimeClient && runtimeClient.child.exitCode === null
      ? 'Local runtime ready'
      : 'Ready';
  tray.setToolTip(`DevPilot - ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open DevPilot', click: showMainWindow },
    { label: status, enabled: false },
    { type: 'separator' },
    {
      label: 'Stop local runtime',
      enabled: Boolean(runtimeClient),
      click: () => { void stopDesktopRuntime(); },
    },
    { type: 'separator' },
    { label: 'Quit DevPilot', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  if (tray) return tray;
  tray = new Tray(getTrayIcon());
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  updateTray();
  return tray;
}

function developmentRuntimeRoots() {
  const configured = String(process.env.DEVPILOT_DESKTOP_ROOT || '').trim();
  return [...new Set([configured, path.resolve(__dirname, '..', '..')].filter(Boolean).map((candidate) => path.resolve(candidate)))];
}

function isElectronExecutable(command) {
  try {
    return path.resolve(command).toLowerCase() === path.resolve(process.execPath).toLowerCase();
  } catch {
    return false;
  }
}

function resolveDevPilotRuntime() {
  const configured = String(process.env.DEVPILOT_EXECUTABLE_PATH || '').trim();
  const bundledPython = path.join(process.resourcesPath, 'runtime', 'python', 'python.exe');
  if (app.isPackaged) {
    return existsSync(bundledPython)
      ? { command: bundledPython, argsPrefix: ['-m', 'devpilot.cli.app'], source: 'bundled-runtime' }
      : null;
  }
  const candidates = configured ? [configured] : developmentRuntimeRoots().flatMap((repository) => [
    path.join(repository, '.venv', 'Scripts', 'python.exe'),
    path.join(repository, 'venv', 'Scripts', 'python.exe'),
    path.join(repository, '.venv', 'Scripts', 'devpilot.exe'),
    path.join(repository, 'venv', 'Scripts', 'devpilot.exe'),
  ]);
  for (const command of candidates) {
    if (!existsSync(command) || isElectronExecutable(command)) continue;
    return {
      command,
      argsPrefix: path.basename(command).toLowerCase() === 'python.exe' ? ['-m', 'devpilot.cli.app'] : [],
      source: configured ? 'configured' : 'repository-virtual-environment',
    };
  }
  const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
  const name = process.platform === 'win32' ? 'devpilot.exe' : 'devpilot';
  const found = spawnSync(resolver, [name], { encoding: 'utf8', windowsHide: true });
  const command = String(found.stdout || '').split(/\r?\n/).map((value) => value.trim())
    .find((value) => value && !isElectronExecutable(value));
  return command ? { command, argsPrefix: [], source: 'path' } : null;
}

function getRuntimeStatus() {
  const runtime = resolveDevPilotRuntime();
  if (!runtime) return {
    ready: false, command: null, source: null, version: null,
    issue: app.isPackaged ? 'The bundled DevPilot runtime is missing. Reinstall the desktop app.' : 'DevPilot was not found. Expected the repository virtual environment.',
  };
  const result = spawnSync(runtime.command, [...runtime.argsPrefix, 'version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.status === 0) {
    return { ready: true, command: runtime.command, source: runtime.source, version: output || null, issue: null };
  }
  const issue = output || result.error?.message || 'DevPilot version check failed.';
  if (app.isPackaged && runtime.source === 'bundled-runtime') {
    addRuntimeLog(issue);
    return { ready: true, command: runtime.command, source: runtime.source, version: null, issue };
  }
  return { ready: false, command: runtime.command, source: runtime.source, version: null, issue };
}

function redactRuntimeLog(raw) {
  return String(raw || '').slice(0, MAX_RUNTIME_LOG_ENTRY_BYTES)
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)\S+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|glpat-[A-Za-z0-9_-]{8,})\b/g, '[redacted]')
    .replace(/([?&](?:api[_-]?key|token|secret|access_token)=)[^&\s]+/gi, '$1[redacted]');
}

function addRuntimeLog(raw) {
  const message = redactRuntimeLog(raw);
  if (!message.trim()) return;
  const lower = message.toLowerCase();
  const level = /\b(error|traceback|exception|failed)\b/.test(lower) ? 'error' : /\b(warn|warning)\b/.test(lower) ? 'warning' : 'info';
  const entry = { timestamp: Date.now(), stream: 'stderr', level, message };
  runtimeLogs.push(entry);
  runtimeLogBytes += Buffer.byteLength(message, 'utf8');
  while (runtimeLogs.length > MAX_RUNTIME_LOG_ENTRIES || runtimeLogBytes > MAX_RUNTIME_LOG_BYTES) {
    const removed = runtimeLogs.shift();
    runtimeLogBytes -= Buffer.byteLength(removed.message, 'utf8');
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('devpilot:runtime-log', entry);
}

function handleRuntimeEvent(event) {
  const data = event?.data && typeof event.data === 'object' ? event.data : {};
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : null;
  if (conversationId && event.event === 'run.started') activeConversationIds.add(conversationId);
  if (conversationId && ['run.completed', 'run.failed', 'run.cancelled'].includes(event.event)) activeConversationIds.delete(conversationId);
  if (event.event === 'conversation.updated' && data.conversation?.state && conversationId) {
    if (['working', 'starting', 'resuming', 'cancelling'].includes(data.conversation.state)) activeConversationIds.add(conversationId);
    else activeConversationIds.delete(conversationId);
  }
  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('devpilot:runtime-event', event);
}

async function launchDesktopRuntime() {
  if (runtimeClient && runtimeClient.child.exitCode === null) return runtimeClient;
  if (runtimeStarting) return runtimeStarting;
  runtimeStarting = (async () => {
    const runtime = resolveDevPilotRuntime();
    if (!runtime) throw new Error('DevPilot runtime is unavailable. Reinstall the desktop app.');
    const client = await DevPilotRuntimeClient.start({
      command: runtime.command,
      args: [...runtime.argsPrefix, 'desktop-runtime', '--stdio'],
      cwd: app.isPackaged ? app.getPath('userData') : developmentRuntimeRoots()[0],
      onEvent: handleRuntimeEvent,
      onStderr: addRuntimeLog,
      onProtocolError: (error) => addRuntimeLog(error.message),
      onExit: () => {
        if (runtimeClient !== client) return;
        runtimeClient = null;
        activeConversationIds.clear();
        updateTray();
      },
    });
    runtimeClient = client;
    try {
      // The bundled Python runtime may populate its import cache on first
      // launch. Avoid turning a cold local start into an auth error.
      await client.request('runtime.initialize', {}, 60_000);
      updateTray();
      return client;
    } catch (error) {
      if (runtimeClient === client) runtimeClient = null;
      client.terminate('DevPilot desktop runtime could not initialize.');
      throw error;
    }
  })();
  try {
    return await runtimeStarting;
  } finally {
    runtimeStarting = null;
  }
}

async function requestRuntime(method, params = {}, timeoutMs = 45_000) {
  const client = await launchDesktopRuntime();
  try {
    return await client.request(method, params, timeoutMs);
  } catch (error) {
    // Do not reuse a runtime after a timed-out frame: its late response could
    // otherwise race the next renderer request.
    if (error instanceof Error && /timed out while handling/.test(error.message) && runtimeClient === client) {
      runtimeClient = null;
      client.terminate('DevPilot desktop runtime request timed out.');
      updateTray();
    }
    throw error;
  }
}

async function stopDesktopRuntime() {
  const client = runtimeClient;
  runtimeClient = null;
  activeConversationIds.clear();
  updateTray();
  if (client) await client.close();
}

async function getCodexAuthStatus() {
  const status = getRuntimeStatus();
  if (!status.ready) return { runtimeReady: false, signedIn: false, message: status.issue || 'DevPilot runtime is unavailable.' };
  const auth = await requestRuntime('auth.status', {}, 45_000);
  return {
    runtimeReady: true,
    signedIn: Boolean(auth.signedIn),
    message: auth.signedIn ? 'Signed in with ChatGPT.' : 'Sign in with your ChatGPT account to use DevPilot.',
    accountLabel: auth.accountLabel || null,
    plan: auth.plan || null,
  };
}

async function startCodexLogin() {
  const client = await launchDesktopRuntime();
  if (codexLoginInProgress) return { pid: client.child.pid, alreadyRunning: true };
  codexLoginInProgress = true;
  void client.request('auth.login', { openBrowser: true }, 0).catch((error) => addRuntimeLog(error.message)).finally(() => {
    codexLoginInProgress = false;
  });
  return { pid: client.child.pid, alreadyRunning: false };
}

async function ensureLegacyMigration() {
  const current = readUiState();
  if (current.migrations.workspaceV1?.status === 'complete') return current;
  const auth = await requestRuntime('auth.status');
  if (!auth.signedIn) return current;
  return migrateLegacyWorkspace({
    legacyPath: legacyWorkspacePath(),
    statePath: desktopStatePath(),
    importWorkspace: (workspace) => requestRuntime('migration.importLegacyWorkspace', { workspace }),
  });
}

function parseDevUrl() {
  const index = process.argv.indexOf('--url');
  return String(index >= 0 ? process.argv[index + 1] : process.env.DEVPILOT_ELECTRON_DEV_URL || '').trim() || null;
}

function isTrustedSender(event) {
  return Boolean(mainWindow && event.sender.id === mainWindow.webContents.id);
}

function assertProjectPath(projectPath) {
  if (!projectPath || !existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    throw new Error('Select an accessible local project directory.');
  }
  return path.resolve(projectPath);
}

function startStaticServer(rootDir) {
  if (!existsSync(rootDir)) throw new Error(`Electron production UI export is missing: ${rootDir}.`);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    let candidate = resolveStaticCandidate(rootDir, url.pathname);
    if (!candidate) return response.writeHead(403).end('Forbidden');
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) candidate = path.join(rootDir, 'index.html');
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': mimeTypeForPath(candidate) });
      createReadStream(candidate).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Electron UI server did not receive a TCP port.'));
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function createMainWindow() {
  const devUrl = parseDevUrl();
  const exportedUiRoot = app.isPackaged ? path.join(process.resourcesPath, 'dist') : path.resolve(__dirname, '../ui/dist');
  const frontend = devUrl ? { url: devUrl, stop: null } : await startStaticServer(exportedUiRoot);
  staticServer = frontend.stop ? null : frontend.server;
  const allowedOrigin = new URL(frontend.url).origin;
  mainWindow = new BrowserWindow({
    title: 'DevPilot', width: 1280, height: 840, minWidth: 960, minHeight: 640, backgroundColor: '#111111', show: true,
    icon: getWindowIcon(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== allowedOrigin) event.preventDefault(); });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
    updateTray();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(frontend.url);
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
}

function trusted(handler) {
  return async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
    return handler(...args);
  };
}

ipcMain.handle('devpilot:get-runtime-status', trusted(() => getRuntimeStatus()));
ipcMain.handle('devpilot:get-codex-auth-status', trusted(() => getCodexAuthStatus()));
ipcMain.handle('devpilot:start-codex-login', trusted(() => startCodexLogin()));
ipcMain.handle('devpilot:open-external', trusted(async (rawUrl) => {
  if (!isAllowedExternalUrl(rawUrl)) throw new Error('Only HTTPS and mailto links may be opened externally.');
  await shell.openExternal(rawUrl);
}));
ipcMain.handle('devpilot:select-project-folder', trusted(async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a project in DevPilot', buttonLabel: 'Open folder', properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] || null;
}));
ipcMain.handle('devpilot:project-open', trusted(async (projectPath) => {
  await ensureLegacyMigration();
  const result = await requestRuntime('project.open', { path: assertProjectPath(projectPath) });
  patchUiState({ selectedProjectId: result.project.projectId, selectedConversationId: null });
  return result;
}));
ipcMain.handle('devpilot:project-list', trusted(async () => {
  await ensureLegacyMigration();
  return requestRuntime('project.list');
}));
ipcMain.handle('devpilot:project-get', trusted((projectId) => requestRuntime('project.get', { projectId: String(projectId || '') })));
ipcMain.handle('devpilot:project-remove', trusted((projectId) => requestRuntime('project.remove', { projectId: String(projectId || '') })));
ipcMain.handle('devpilot:project-preflight', trusted((projectId) => requestRuntime('project.preflight', { projectId: String(projectId || '') })));
ipcMain.handle('devpilot:models-list', trusted(() => requestRuntime('models.list')));
ipcMain.handle('devpilot:conversation-create', trusted(async (input) => {
  await ensureLegacyMigration();
  const result = await requestRuntime('conversation.create', input && typeof input === 'object' ? input : {});
  patchUiState({
    selectedProjectId: result.conversation.projectId,
    selectedConversationId: result.conversation.conversationId,
    lastModel: result.conversation.model,
    lastReasoningEffort: result.conversation.reasoningEffort,
    lastSandbox: result.conversation.sandbox,
  });
  return result;
}));
ipcMain.handle('devpilot:conversation-list', trusted((projectId, includeArchived) => requestRuntime('conversation.list', {
  projectId: String(projectId || ''), includeArchived: Boolean(includeArchived),
})));
ipcMain.handle('devpilot:conversation-open', trusted(async (projectId, conversationId) => {
  const result = await requestRuntime('conversation.open', { projectId: String(projectId || ''), conversationId: String(conversationId || '') });
  patchUiState({ selectedProjectId: String(projectId || ''), selectedConversationId: String(conversationId || '') });
  return result;
}));
ipcMain.handle('devpilot:conversation-rename', trusted((input) => requestRuntime('conversation.rename', input && typeof input === 'object' ? input : {})));
ipcMain.handle('devpilot:conversation-pin', trusted((input) => requestRuntime('conversation.pin', input && typeof input === 'object' ? input : {})));
ipcMain.handle('devpilot:conversation-archive', trusted((input) => requestRuntime('conversation.archive', input && typeof input === 'object' ? input : {})));
ipcMain.handle('devpilot:conversation-delete', trusted((input) => requestRuntime('conversation.delete', input && typeof input === 'object' ? input : {})));
ipcMain.handle('devpilot:conversation-send', trusted((input) => requestRuntime('conversation.send', input && typeof input === 'object' ? input : {}, 0)));
ipcMain.handle('devpilot:conversation-resume', trusted((input) => requestRuntime('conversation.resume', input && typeof input === 'object' ? input : {}, 0)));
ipcMain.handle('devpilot:run-cancel', trusted((input) => requestRuntime('run.cancel', input && typeof input === 'object' ? input : {})));
ipcMain.handle('devpilot:run-status', trusted((input) => requestRuntime('run.status', input && typeof input === 'object' ? input : {})));
ipcMain.handle('devpilot:changes-list', trusted((projectId) => requestRuntime('changes.list', { projectId: String(projectId || '') })));
ipcMain.handle('devpilot:changes-diff', trusted((input) => requestRuntime('changes.diff', input && typeof input === 'object' ? input : {})));
ipcMain.handle('devpilot:get-ui-state', trusted(() => readUiState()));
ipcMain.handle('devpilot:save-ui-state', trusted((patch) => patchUiState(patch && typeof patch === 'object' ? patch : {})));
ipcMain.handle('devpilot:get-runtime-logs', trusted(() => runtimeLogs.slice()));
ipcMain.handle('devpilot:clear-runtime-logs', trusted(() => { runtimeLogs.length = 0; runtimeLogBytes = 0; }));

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createTray();
  await createMainWindow();
  app.on('activate', showMainWindow);
}).catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); app.quit(); });

app.on('before-quit', () => {
  isQuitting = true;
  void stopDesktopRuntime();
  if (staticServer) staticServer.close();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
