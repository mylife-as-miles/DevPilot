const path = require('node:path');

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function resolveStaticCandidate(rootDir, pathname) {
  const decoded = decodeURIComponent(String(pathname || '/'));
  if (decoded.includes('\0')) return null;
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

function mimeTypeForPath(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    return url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

module.exports = {
  isAllowedExternalUrl,
  mimeTypeForPath,
  resolveStaticCandidate,
};
