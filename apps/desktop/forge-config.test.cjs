const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const test = require('node:test');

const config = require('./forge.config.cjs');

test('packages the reusable ACP process client beside the desktop resources', () => {
  assert.ok(config.packagerConfig.asar);
  assert.ok(config.packagerConfig.extraResource.includes(
    resolve(__dirname, '../../packages/devpilot-runtime/src/acpProcessClient.cjs'),
  ));
});
