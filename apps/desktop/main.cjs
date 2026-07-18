const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray } = require('electron');
const { createReadStream, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const { isAllowedExternalUrl, mimeTypeForPath, resolveStaticCandidate } = require('./desktop-shell.cjs');
const {
  addProject,
  appendTaskMessage,
  createTask,
  emptyWorkspace,
  normalizeWorkspace,
  selectProject: selectWorkspaceProject,
  updateTask,
} = require('./workspace-store.cjs');
const acpClientModule = app.isPackaged
  ? path.join(process.resourcesPath, 'acpProcessClient.cjs')
  : path.resolve(__dirname, '../../packages/devpilot-runtime/src/acpProcessClient.cjs');
const { AcpProcessClient } = require(acpClientModule);

// Electron's development executable still carries its generic package name.
// Set the process-visible name explicitly so tray, taskbar, and system dialogs
// consistently identify the product as DevPilot.
app.setName('DevPilot');

let mainWindow = null;
let staticServer = null;
let acpClient = null;
let acpProcessProjectPath = null;
let acpSessionId = null;
let acpRunInProgress = false;
let codexLoginProcess = null;
let tray = null;
let isQuitting = false;
const taskWorkers = new Map();
const runtimeLogs = [];
let runtimeLogBytes = 0;
const MAX_RUNTIME_LOG_ENTRIES = 1000;
const MAX_RUNTIME_LOG_BYTES = 1_500_000;
const MAX_RUNTIME_LOG_ENTRY_BYTES = 16_384;

function workspaceRecordPath() {
  return path.join(app.getPath('userData'), 'devpilot-workspace.json');
}

function readWorkspace() {
  try {
    return normalizeWorkspace(JSON.parse(readFileSync(workspaceRecordPath(), 'utf8')));
  } catch {
    return emptyWorkspace();
  }
}

function recoverInterruptedWorkspace() {
  const workspace = readWorkspace();
  let changed = false;
  for (const project of workspace.projects) {
    for (const task of project.tasks) {
      if (task.status !== 'starting' && task.status !== 'running') continue;
      task.status = 'interrupted';
      task.acpSessionId = null;
      changed = true;
    }
  }
  return changed ? writeWorkspace(workspace) : workspace;
}

function writeWorkspace(workspace) {
  const normalized = normalizeWorkspace(workspace);
  const target = workspaceRecordPath();
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode: 0o600 });
  return normalized;
}

function broadcastWorkspace(workspace) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('devpilot:workspace-changed', workspace);
  }
}

function saveWorkspace(workspace) {
  const saved = writeWorkspace(workspace);
  broadcastWorkspace(saved);
  return saved;
}

function findWorkspaceTask(workspace, taskId) {
  for (const project of workspace.projects) {
    const task = project.tasks.find((candidate) => candidate.id === taskId);
    if (task) return { project, task };
  }
  return null;
}

function publicTaskUpdate(taskId, update) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('devpilot:task-update', { taskId, ...update });
  }
}

function textFromTaskUpdate(update) {
  const text = update?.update?.content?.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const type = String(update?.update?._meta?.devpilot?.type || '').toLowerCase();
  return { text: text.trim(), kind: type.includes('thought') || type.includes('thinking') ? 'thinking' : 'message' };
}

function localSessionRecordPath() {
  return path.join(app.getPath('userData'), 'devpilot-local-session.json');
}

function readPersistedLocalSession() {
  try {
    const raw = JSON.parse(readFileSync(localSessionRecordPath(), 'utf8'));
    if (!raw || raw.version !== 1 || typeof raw.projectPath !== 'string' || !raw.projectPath.trim()) return null;
    return raw;
  } catch {
    return null;
  }
}

function persistLocalSession(status = 'idle') {
  if (!acpProcessProjectPath) return;
  const now = Date.now();
  const prior = readPersistedLocalSession();
  const record = {
    version: 1,
    projectPath: acpProcessProjectPath,
    devpilotSessionPath: prior?.devpilotSessionPath || null,
    runName: prior?.runName || null,
    lastAcpSessionId: acpSessionId || null,
    lastKnownStatus: status,
    connectedAt: prior?.projectPath === acpProcessProjectPath ? prior.connectedAt || now : now,
    updatedAt: now,
  };
  mkdirSync(path.dirname(localSessionRecordPath()), { recursive: true });
  writeFileSync(localSessionRecordPath(), JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
}

function trayProjectName() {
  return acpProcessProjectPath ? path.basename(acpProcessProjectPath) || acpProcessProjectPath : null;
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
  const activeTaskCount = [...taskWorkers.values()].filter((worker) => worker.runInProgress).length;
  const taskWorkerCount = taskWorkers.size;
  const projectName = trayProjectName();
  const status = activeTaskCount > 0
    ? `${activeTaskCount} DevPilot task${activeTaskCount === 1 ? '' : 's'} running`
    : taskWorkerCount > 0
      ? `${taskWorkerCount} project task${taskWorkerCount === 1 ? '' : 's'} ready`
      : acpClient && acpClient.child.exitCode === null
    ? `${acpRunInProgress ? 'DevPilot task running' : 'ACP running'}${projectName ? ` - ${projectName}` : ''}`
    : 'Ready for a project';
  tray.setToolTip(`DevPilot - ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open DevPilot', click: showMainWindow },
    { label: status, enabled: false },
    { type: 'separator' },
    {
      label: 'Stop background tasks',
      enabled: Boolean(acpClient || taskWorkers.size),
      click: () => {
        stopAcpProcess();
        stopAllTaskWorkers();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit DevPilot',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
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
  const roots = [
    configured,
    path.resolve(__dirname, '..', '..'),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  return [...new Set(roots)];
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
    // The console-script shim can inherit Electron's process environment on
    // Windows and fail before Python starts. Invoking the same installed
    // package through its virtual-environment interpreter is deterministic.
    path.join(repository, '.venv', 'Scripts', 'python.exe'),
    path.join(repository, 'venv', 'Scripts', 'python.exe'),
    path.join(repository, '.venv', 'Scripts', 'devpilot.exe'),
    path.join(repository, 'venv', 'Scripts', 'devpilot.exe'),
  ]);
  for (const command of candidates) {
    if (!existsSync(command) || isElectronExecutable(command)) continue;
    const python = path.basename(command).toLowerCase() === 'python.exe';
    return { command, argsPrefix: python ? ['-m', 'devpilot.cli.app'] : [], source: configured ? 'configured' : 'repository-virtual-environment' };
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
    ready: false,
    command: null,
    source: null,
    version: null,
    issue: app.isPackaged
      ? 'The bundled DevPilot runtime is missing. Reinstall the desktop app.'
      : 'DevPilot was not found. Expected .venv\\Scripts\\devpilot.exe in this repository.',
  };
  const result = spawnSync(runtime.command, [...runtime.argsPrefix, '--version'], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.status !== 0) return { ready: false, command: runtime.command, source: runtime.source, version: null, issue: output || 'DevPilot version check failed.' };
  return { ready: true, command: runtime.command, source: runtime.source, version: output || null, issue: null };
}

function getCodexAuthStatus() {
  const runtime = resolveDevPilotRuntime();
  if (!runtime) return { runtimeReady: false, signedIn: false, message: 'DevPilot runtime is unavailable.' };
  const result = spawnSync(runtime.command, [...runtime.argsPrefix, 'login', 'status'], {
    encoding: 'utf8', timeout: 5_000, windowsHide: true,
  });
  return {
    runtimeReady: true,
    signedIn: result.status === 0,
    message: result.status === 0
      ? 'Signed in with ChatGPT.'
      : 'Sign in with your ChatGPT account to use DevPilot.',
  };
}

function startCodexLogin() {
  if (codexLoginProcess && codexLoginProcess.exitCode === null) {
    return { pid: codexLoginProcess.pid, alreadyRunning: true };
  }
  const runtime = resolveDevPilotRuntime();
  if (!runtime) throw new Error('DevPilot runtime is unavailable. Reinstall the desktop app.');
  const child = spawn(runtime.command, [...runtime.argsPrefix, 'login', 'openai'], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  codexLoginProcess = child;
  child.stderr.on('data', addRuntimeLog);
  child.once('exit', () => {
    if (codexLoginProcess === child) codexLoginProcess = null;
  });
  return { pid: child.pid, alreadyRunning: false };
}

function parseDevUrl() {
  const index = process.argv.indexOf('--url');
  return String(index >= 0 ? process.argv[index + 1] : process.env.DEVPILOT_ELECTRON_DEV_URL || '').trim() || null;
}

function isTrustedSender(event) {
  return Boolean(mainWindow && event.sender.id === mainWindow.webContents.id);
}

function redactRuntimeLog(raw) {
  let message = String(raw || '').slice(0, MAX_RUNTIME_LOG_ENTRY_BYTES);
  message = message
    .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)\S+/gi, '$1[redacted]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|glpat-[A-Za-z0-9_-]{8,})\b/g, '[redacted]')
    .replace(/([?&](?:api[_-]?key|token|secret|access_token)=)[^&\s]+/gi, '$1[redacted]');
  return message;
}

function addRuntimeLog(raw) {
  const message = redactRuntimeLog(raw);
  if (!message.trim()) return;
  const lower = message.toLowerCase();
  const level = /\b(error|traceback|exception|failed)\b/.test(lower)
    ? 'error' : /\b(warn|warning)\b/.test(lower) ? 'warning' : 'info';
  const entry = { timestamp: Date.now(), stream: 'stderr', level, message };
  runtimeLogs.push(entry);
  runtimeLogBytes += Buffer.byteLength(message, 'utf8');
  while (runtimeLogs.length > MAX_RUNTIME_LOG_ENTRIES || runtimeLogBytes > MAX_RUNTIME_LOG_BYTES) {
    const removed = runtimeLogs.shift();
    runtimeLogBytes -= Buffer.byteLength(removed.message, 'utf8');
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('devpilot:runtime-log', entry);
}

function stopAcpProcess() {
  const client = acpClient;
  acpClient = null;
  acpProcessProjectPath = null;
  acpSessionId = null;
  acpRunInProgress = false;
  if (client) client.terminate();
  updateTray();
}

function requestAcp(method, params, timeoutMs = 15_000) {
  if (!acpClient || acpClient.child.exitCode !== null || !acpClient.child.stdin.writable) {
    return Promise.reject(new Error('DevPilot ACP is not running.'));
  }
  return acpClient.request(method, params, timeoutMs);
}

async function launchAcpSession(projectPath) {
  const resolvedProjectPath = path.resolve(projectPath);
  if (acpClient && acpClient.child.exitCode === null && acpProcessProjectPath === resolvedProjectPath && acpSessionId) {
    return { pid: acpClient.child.pid, sessionId: acpSessionId };
  }

  stopAcpProcess();
  const runtime = resolveDevPilotRuntime();
  if (!runtime) throw new Error('DevPilot runtime is unavailable. Reinstall the desktop app.');

  const client = await AcpProcessClient.start({
    command: runtime.command,
    args: [...runtime.argsPrefix, 'acp', '--stdio'],
    cwd: resolvedProjectPath,
    onUpdate: (update) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('devpilot:acp-update', update);
    },
    onStderr: addRuntimeLog,
    onExit: () => {
      if (acpClient !== client) return;
      acpClient = null;
      acpProcessProjectPath = null;
      acpSessionId = null;
      acpRunInProgress = false;
      updateTray();
    },
  });
  acpClient = client;
  acpProcessProjectPath = resolvedProjectPath;
  updateTray();

  await requestAcp('initialize', {});
  const created = await requestAcp('session/new', { cwd: resolvedProjectPath });
  const sessionId = String(created.sessionId || '').trim();
  if (!sessionId) throw new Error('DevPilot ACP did not return a session id.');
  acpSessionId = sessionId;
  persistLocalSession('idle');
  updateTray();
  return { pid: client.child.pid, sessionId };
}

function stopTaskWorker(taskId, message = 'DevPilot task stopped.') {
  const worker = taskWorkers.get(taskId);
  if (!worker) return;
  taskWorkers.delete(taskId);
  worker.runInProgress = false;
  if (!isQuitting) {
    try {
      const interrupted = updateTask(readWorkspace(), taskId, { status: 'interrupted', acpSessionId: null });
      saveWorkspace(interrupted.workspace);
    } catch {
      // The task may have been removed already.
    }
  }
  worker.client.terminate(message);
  updateTray();
}

function stopAllTaskWorkers() {
  for (const taskId of [...taskWorkers.keys()]) stopTaskWorker(taskId, 'DevPilot is quitting.');
}

function taskPromptOptions(task) {
  const options = {};
  if (task.model && task.model !== 'default') options.model = task.model;
  if (task.reasoningEffort && task.reasoningEffort !== 'default') options.reasoning_effort = task.reasoningEffort;
  return options;
}

async function ensureTaskWorker(taskId) {
  const existing = taskWorkers.get(taskId);
  if (existing && existing.client.child.exitCode === null && existing.sessionId) return existing;

  const workspace = readWorkspace();
  const found = findWorkspaceTask(workspace, taskId);
  if (!found) throw new Error('This DevPilot task no longer exists.');
  if (!existsSync(found.project.path) || !statSync(found.project.path).isDirectory()) {
    throw new Error('The project folder is no longer accessible.');
  }
  const runtime = resolveDevPilotRuntime();
  if (!runtime) throw new Error('The bundled DevPilot runtime is unavailable. Reinstall the desktop app.');

  const client = await AcpProcessClient.start({
    command: runtime.command,
    args: [...runtime.argsPrefix, 'acp', '--stdio'],
    cwd: found.project.path,
    onUpdate: (update) => {
      publicTaskUpdate(taskId, { type: 'acp-update', update });
      const content = textFromTaskUpdate(update);
      if (!content) return;
      try {
        const appended = appendTaskMessage(readWorkspace(), taskId, {
          role: 'assistant',
          text: content.text,
          kind: content.kind,
        });
        saveWorkspace(appended.workspace);
      } catch (error) {
        addRuntimeLog(error instanceof Error ? error.message : String(error));
      }
    },
    onStderr: addRuntimeLog,
    onExit: () => {
      const current = taskWorkers.get(taskId);
      if (!current || current.client !== client) return;
      taskWorkers.delete(taskId);
      if (!isQuitting) {
        try {
          const updated = updateTask(readWorkspace(), taskId, {
            status: current.runInProgress ? 'interrupted' : 'completed',
            acpSessionId: null,
          });
          saveWorkspace(updated.workspace);
        } catch {
          // The task may have been removed while its process was shutting down.
        }
      }
      updateTray();
    },
  });

  const worker = { client, sessionId: null, projectId: found.project.id, projectPath: found.project.path, runInProgress: false };
  taskWorkers.set(taskId, worker);
  updateTray();
  try {
    await client.request('initialize', {});
    const created = await client.request('session/new', { cwd: found.project.path });
    const sessionId = String(created.sessionId || '').trim();
    if (!sessionId) throw new Error('DevPilot ACP did not return a task session id.');
    worker.sessionId = sessionId;
    const updated = updateTask(readWorkspace(), taskId, { acpSessionId: sessionId, status: 'running' });
    saveWorkspace(updated.workspace);
    return worker;
  } catch (error) {
    taskWorkers.delete(taskId);
    client.terminate('DevPilot could not initialize this task.');
    updateTray();
    throw error;
  }
}

async function runTaskPrompt(taskId, prompt) {
  let worker = null;
  try {
    worker = await ensureTaskWorker(taskId);
    const workspace = readWorkspace();
    const found = findWorkspaceTask(workspace, taskId);
    if (!found) throw new Error('This DevPilot task no longer exists.');
    worker.runInProgress = true;
    updateTray();
    publicTaskUpdate(taskId, { type: 'status', status: 'running' });
    await worker.client.request('session/prompt', {
      sessionId: worker.sessionId,
      prompt: { text: prompt },
      options: taskPromptOptions(found.task),
    }, 0);
    const completed = updateTask(readWorkspace(), taskId, { status: 'completed' });
    saveWorkspace(completed.workspace);
    publicTaskUpdate(taskId, { type: 'status', status: 'completed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'DevPilot could not run this task.';
    try {
      const appended = appendTaskMessage(readWorkspace(), taskId, { role: 'system', text: message });
      const failed = updateTask(appended.workspace, taskId, { status: 'failed', acpSessionId: worker?.sessionId || null });
      saveWorkspace(failed.workspace);
    } catch {
      // Preserve the original runtime error when persistence also fails.
    }
    publicTaskUpdate(taskId, { type: 'status', status: 'failed', error: message });
    addRuntimeLog(message);
  } finally {
    if (worker) worker.runInProgress = false;
    updateTray();
  }
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
  const exportedUiRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'dist')
    : path.resolve(__dirname, '../ui/dist');
  const frontend = devUrl ? { url: devUrl, stop: null } : await startStaticServer(exportedUiRoot);
  staticServer = frontend.stop ? null : frontend.server;
  const allowedOrigin = new URL(frontend.url).origin;
  mainWindow = new BrowserWindow({
    title: 'DevPilot', width: 1280, height: 840, minWidth: 960, minHeight: 640, backgroundColor: '#F5F5F5', show: true,
    icon: getWindowIcon(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== allowedOrigin) event.preventDefault(); });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
    updateTray();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(frontend.url);
  // Some development-server navigations do not emit `ready-to-show` even
  // though the renderer has loaded. Keep the fast-path event above, but make
  // the desktop visible after a successful navigation in that case.
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
}

ipcMain.handle('devpilot:get-runtime-status', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return getRuntimeStatus();
});
ipcMain.handle('devpilot:get-codex-auth-status', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return getCodexAuthStatus();
});
ipcMain.handle('devpilot:start-codex-login', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return startCodexLogin();
});
ipcMain.handle('devpilot:open-external', async (event, rawUrl) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  if (!isAllowedExternalUrl(rawUrl)) throw new Error('Only HTTPS and mailto links may be opened externally.');
  await shell.openExternal(rawUrl);
});
ipcMain.handle('devpilot:select-project', async (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0] || null;
});
ipcMain.handle('devpilot:get-workspace', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return readWorkspace();
});
ipcMain.handle('devpilot:add-project', async (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a project in DevPilot',
    buttonLabel: 'Open project',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const workspace = saveWorkspace(addProject(readWorkspace(), result.filePaths[0]));
  return workspace;
});
ipcMain.handle('devpilot:activate-project', (event, projectId) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return saveWorkspace(selectWorkspaceProject(readWorkspace(), String(projectId || '')));
});
ipcMain.handle('devpilot:activate-task', (event, taskId) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  const workspace = readWorkspace();
  const found = findWorkspaceTask(workspace, String(taskId || ''));
  if (!found) throw new Error('Unknown DevPilot task.');
  workspace.selectedProjectId = found.project.id;
  workspace.selectedTaskId = found.task.id;
  return saveWorkspace(workspace);
});
ipcMain.handle('devpilot:create-task', (event, projectId, input) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  const prompt = String(input?.prompt || '').trim();
  const created = createTask(readWorkspace(), String(projectId || ''), input);
  const workspace = saveWorkspace(created.workspace);
  void runTaskPrompt(created.task.id, prompt);
  return { workspace, task: created.task };
});
ipcMain.handle('devpilot:send-task-prompt', (event, taskId, prompt, input) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Describe what you would like DevPilot to work on.');
  const appended = appendTaskMessage(readWorkspace(), String(taskId || ''), { role: 'user', text });
  const updated = updateTask(appended.workspace, String(taskId || ''), {
    status: 'starting',
    model: String(input?.model || appended.task.model || 'default'),
    reasoningEffort: String(input?.reasoningEffort || appended.task.reasoningEffort || 'medium'),
  });
  const workspace = saveWorkspace(updated.workspace);
  void runTaskPrompt(String(taskId || ''), text);
  return workspace;
});
ipcMain.handle('devpilot:cancel-task', async (event, taskId) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  const id = String(taskId || '');
  const worker = taskWorkers.get(id);
  if (worker?.sessionId) {
    await worker.client.request('session/cancel', { sessionId: worker.sessionId });
    worker.runInProgress = false;
  }
  const updated = updateTask(readWorkspace(), id, { status: 'cancelled' });
  updateTray();
  return saveWorkspace(updated.workspace);
});
ipcMain.handle('devpilot:launch-acp', async (event, projectPath) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  if (!projectPath || !existsSync(projectPath) || !statSync(projectPath).isDirectory()) throw new Error('Select an accessible local project directory.');
  return launchAcpSession(projectPath);
});
ipcMain.handle('devpilot:restore-acp', async (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  const persisted = readPersistedLocalSession();
  if (!persisted || !existsSync(persisted.projectPath) || !statSync(persisted.projectPath).isDirectory()) return null;
  const launched = await launchAcpSession(persisted.projectPath);
  persistLocalSession('resumed');
  return { ...launched, projectPath: persisted.projectPath, historicalAcpSessionId: persisted.lastAcpSessionId || null };
});
ipcMain.handle('devpilot:start-acp-prompt', async (event, sessionId, prompt) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  if (!acpClient || acpClient.child.exitCode !== null || String(sessionId || '') !== acpSessionId) {
    throw new Error('The local ACP session is no longer active. Reconnect the project and try again.');
  }
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Describe a research goal before starting a run.');
  persistLocalSession('running');
  acpRunInProgress = true;
  updateTray();
  try {
    return await requestAcp('session/prompt', { sessionId: acpSessionId, prompt: { text } }, 0);
  } finally {
    acpRunInProgress = false;
    persistLocalSession('idle');
    updateTray();
  }
});
ipcMain.handle('devpilot:cancel-acp-run', async (event, sessionId) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  if (!acpClient || acpClient.child.exitCode !== null || String(sessionId || '') !== acpSessionId) {
    throw new Error('The local ACP session is no longer active. Reconnect the project and try again.');
  }
  persistLocalSession('cancelling');
  const result = await requestAcp('session/cancel', { sessionId: acpSessionId });
  persistLocalSession('cancelled');
  return result;
});
ipcMain.handle('devpilot:preflight', async (event, projectPath, options) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  if (!projectPath || !existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    throw new Error('Select an accessible local project directory.');
  }
  await launchAcpSession(projectPath);
  return requestAcp('devpilot/preflight', { cwd: acpProcessProjectPath, options: options && typeof options === 'object' ? options : {} });
});
ipcMain.handle('devpilot:get-runtime-logs', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return runtimeLogs.slice();
});
ipcMain.handle('devpilot:clear-runtime-logs', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  runtimeLogs.length = 0;
  runtimeLogBytes = 0;
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  recoverInterruptedWorkspace();
  createTray();
  await createMainWindow();
  app.on('activate', showMainWindow);
}).catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); app.quit(); });
app.on('before-quit', () => {
  isQuitting = true;
  stopAcpProcess();
  stopAllTaskWorkers();
  if (codexLoginProcess && codexLoginProcess.exitCode === null) codexLoginProcess.kill();
  if (staticServer) staticServer.close();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
