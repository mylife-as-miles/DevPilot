const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const { createReadStream, existsSync, statSync } = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const { isAllowedExternalUrl, mimeTypeForPath, resolveStaticCandidate } = require('./desktop-shell.cjs');

let mainWindow = null;
let staticServer = null;
let acpProcess = null;

function desktopRoot() {
  return process.env.DEVPILOT_DESKTOP_ROOT || path.resolve(__dirname, '..', '..');
}

function resolveDevPilotRuntime() {
  const configured = String(process.env.DEVPILOT_EXECUTABLE_PATH || '').trim();
  const repository = desktopRoot();
  const candidates = configured ? [configured] : [
    path.join(repository, '.venv', 'Scripts', 'devpilot.exe'),
    path.join(repository, 'venv', 'Scripts', 'devpilot.exe'),
    path.join(repository, '.venv', 'Scripts', 'python.exe'),
    path.join(repository, 'venv', 'Scripts', 'python.exe'),
  ];
  for (const command of candidates) {
    if (!existsSync(command)) continue;
    const python = path.basename(command).toLowerCase() === 'python.exe';
    return { command, argsPrefix: python ? ['-m', 'devpilot.cli.app'] : [], source: configured ? 'configured' : 'repository-virtual-environment' };
  }
  const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
  const name = process.platform === 'win32' ? 'devpilot.exe' : 'devpilot';
  const found = spawnSync(resolver, [name], { encoding: 'utf8', windowsHide: true });
  const command = String(found.stdout || '').split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  return command ? { command, argsPrefix: [], source: 'path' } : null;
}

function getRuntimeStatus() {
  const runtime = resolveDevPilotRuntime();
  if (!runtime) return { ready: false, command: null, source: null, version: null, issue: 'DevPilot was not found. Expected .venv\\Scripts\\devpilot.exe in this repository.' };
  const result = spawnSync(runtime.command, [...runtime.argsPrefix, '--version'], { encoding: 'utf8', timeout: 5_000, windowsHide: true });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.status !== 0) return { ready: false, command: runtime.command, source: runtime.source, version: null, issue: output || 'DevPilot version check failed.' };
  return { ready: true, command: runtime.command, source: runtime.source, version: output || null, issue: null };
}

function parseDevUrl() {
  const index = process.argv.indexOf('--url');
  return String(index >= 0 ? process.argv[index + 1] : process.env.DEVPILOT_ELECTRON_DEV_URL || '').trim() || null;
}

function isTrustedSender(event) {
  return Boolean(mainWindow && event.sender.id === mainWindow.webContents.id);
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
    title: 'DevPilot', width: 1280, height: 840, minWidth: 960, minHeight: 640, backgroundColor: '#F5F5F5', show: false,
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
}

ipcMain.handle('devpilot:get-runtime-status', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return getRuntimeStatus();
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
ipcMain.handle('devpilot:launch-acp', (event, projectPath) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  if (!projectPath || !existsSync(projectPath) || !statSync(projectPath).isDirectory()) throw new Error('Select an accessible local project directory.');
  const runtime = resolveDevPilotRuntime();
  if (!runtime) throw new Error('DevPilot was not found in this repository.');
  if (acpProcess && acpProcess.exitCode === null) acpProcess.kill();
  acpProcess = spawn(runtime.command, [...runtime.argsPrefix, 'acp', '--stdio'], { cwd: projectPath, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  acpProcess.on('exit', () => { acpProcess = null; });
  return { pid: acpProcess.pid };
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createMainWindow(); });
}).catch((error) => { console.error(error instanceof Error ? error.stack || error.message : String(error)); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (acpProcess && acpProcess.exitCode === null) acpProcess.kill(); if (staticServer) staticServer.close(); });
