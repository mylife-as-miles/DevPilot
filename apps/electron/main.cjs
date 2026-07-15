const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const { createReadStream, existsSync, statSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { isAllowedExternalUrl, mimeTypeForPath, resolveStaticCandidate } = require('./desktop-shell.cjs');

let mainWindow = null;
let staticServer = null;

function parseDevUrl() {
  const index = process.argv.indexOf('--url');
  const explicit = index >= 0 ? process.argv[index + 1] : process.env.DEVPILOT_ELECTRON_DEV_URL;
  return String(explicit || '').trim() || null;
}

function isTrustedSender(event) {
  return Boolean(mainWindow && event.sender.id === mainWindow.webContents.id);
}

function startStaticServer(rootDir) {
  if (!existsSync(rootDir)) {
    throw new Error(`Electron production UI export is missing: ${rootDir}. Run \`yarn electron:build\` from the repository root.`);
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    let candidate = resolveStaticCandidate(rootDir, url.pathname);
    if (!candidate) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        candidate = path.join(rootDir, 'index.html');
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': mimeTypeForPath(candidate),
      });
      createReadStream(candidate).pipe(response);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Electron UI server did not receive a TCP port.'));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

function configureSessionPolicy() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

async function createMainWindow() {
  const devUrl = parseDevUrl();
  const frontend = devUrl
    ? { url: devUrl, stop: null }
    : await startStaticServer(path.join(process.resourcesPath, 'ui-dist'));
  staticServer = frontend.stop ? null : frontend.server;
  const allowedOrigin = new URL(frontend.url).origin;

  mainWindow = new BrowserWindow({
    title: 'DevPilot',
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#F5F5F5',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== allowedOrigin) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  await mainWindow.loadURL(frontend.url);
}

ipcMain.handle('devpilot:get-runtime-info', (event) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  return Object.freeze({ platform: process.platform, electron: process.versions.electron, packaged: app.isPackaged });
});

ipcMain.handle('devpilot:open-external', async (event, rawUrl) => {
  if (!isTrustedSender(event)) throw new Error('Untrusted Electron renderer.');
  if (!isAllowedExternalUrl(rawUrl)) throw new Error('Only HTTPS and mailto links may be opened externally.');
  await shell.openExternal(rawUrl);
});

app.whenReady().then(async () => {
  configureSessionPolicy();
  await createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
}).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (staticServer) staticServer.close();
});
