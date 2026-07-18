const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { createReadStream, existsSync, statSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const { isAllowedExternalUrl, mimeTypeForPath, resolveStaticCandidate } = require('./desktop-shell.cjs');
const acpClientModule = app.isPackaged
  ? path.join(process.resourcesPath, 'acpProcessClient.cjs')
  : path.resolve(__dirname, '../../packages/devpilot-runtime/src/acpProcessClient.cjs');
const { AcpProcessClient } = require(acpClientModule);

let mainWindow = null;
let staticServer = null;
let acpClient = null;
let acpProcessProjectPath = null;
let acpSessionId = null;
let codexLoginProcess = null;
const runtimeLogs = [];
let runtimeLogBytes = 0;
const MAX_RUNTIME_LOG_ENTRIES = 1000;
const MAX_RUNTIME_LOG_BYTES = 1_500_000;
const MAX_RUNTIME_LOG_ENTRY_BYTES = 16_384;

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
    path.join(repository, '.venv', 'Scripts', 'devpilot.exe'),
    path.join(repository, 'venv', 'Scripts', 'devpilot.exe'),
    path.join(repository, '.venv', 'Scripts', 'python.exe'),
    path.join(repository, 'venv', 'Scripts', 'python.exe'),
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
      ? 'Signed in with Codex.'
      : 'Sign in with your ChatGPT account to use Codex.',
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
  if (client) client.terminate();
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
  if (!runtime) throw new Error('DevPilot was not found in this repository.');

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
    },
  });
  acpClient = client;
  acpProcessProjectPath = resolvedProjectPath;

  await requestAcp('initialize', {});
  const created = await requestAcp('session/new', { cwd: resolvedProjectPath });
  const sessionId = String(created.sessionId || '').trim();
  if (!sessionId) throw new Error('DevPilot ACP did not return a session id.');
  acpSessionId = sessionId;
  persistLocalSession('idle');
  return { pid: client.child.pid, sessionId };
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
  const frontend = devUrl ? { url: devUrl, stop: null } : await startStaticServer(path.join(process.resourcesPath, 'dist'));
  staticServer = frontend.stop ? null : frontend.server;
  const allowedOrigin = new URL(frontend.url).origin;
  mainWindow = new BrowserWindow({
    title: 'DevPilot', width: 1280, height: 840, minWidth: 960, minHeight: 640, backgroundColor: '#F5F5F5', show: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== allowedOrigin) event.preventDefault(); });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
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
  try {
    return await requestAcp('session/prompt', { sessionId: acpSessionId, prompt: { text } }, 0);
  } finally {
    persistLocalSession('idle');
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
  await createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createMainWindow(); });
}).catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  stopAcpProcess();
  if (codexLoginProcess && codexLoginProcess.exitCode === null) codexLoginProcess.kill();
  if (staticServer) staticServer.close();
});
