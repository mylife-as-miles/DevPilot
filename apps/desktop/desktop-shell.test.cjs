const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { isAllowedExternalUrl, mimeTypeForPath, resolveStaticCandidate } = require('./desktop-shell.cjs');

test('resolves only files inside the packaged web root', () => {
  const root = path.resolve('C:/app/ui-dist');
  assert.equal(resolveStaticCandidate(root, '/_expo/static/main.js'), path.resolve(root, './_expo/static/main.js'));
  assert.equal(resolveStaticCandidate(root, '/../secret.txt'), null);
});

test('uses safe renderer boundaries', () => {
  assert.equal(mimeTypeForPath('index.html'), 'text/html; charset=utf-8');
  assert.equal(isAllowedExternalUrl('https://devpilot.example/docs'), true);
  assert.equal(isAllowedExternalUrl('file:///C:/secret.txt'), false);
});
