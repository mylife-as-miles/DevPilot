const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const test = require('node:test');

const config = require('./forge.config.cjs');

test('packages the private DevPilot runtime client beside the desktop resources', () => {
  assert.ok(config.packagerConfig.asar);
  assert.ok(config.packagerConfig.extraResource.includes(
    resolve(__dirname, '../../packages/devpilot-runtime/src/desktopRuntimeClient.cjs'),
  ));
});

test('packages the bundled Python runtime with the desktop app', () => {
  assert.ok(config.packagerConfig.extraResource.includes(
    resolve(__dirname, 'runtime'),
  ));
  assert.equal(
    config.packagerConfig.ignore(resolve(__dirname, 'runtime', 'python', 'python.exe')),
    true,
  );
  assert.equal(config.packagerConfig.ignore('runtime/python/python.exe'), true);
  assert.equal(config.packagerConfig.ignore('out-preview/DevPilot-win32-x64/DevPilot.exe'), true);
  assert.equal(config.packagerConfig.ignore('out-native-release/DevPilot-win32-x64/DevPilot.exe'), true);
  assert.equal(config.packagerConfig.ignore('apps/desktop/out-preview/DevPilot-win32-x64/DevPilot.exe'), true);
  assert.equal(config.packagerConfig.ignore(resolve(__dirname, 'main.cjs')), false);
});

test('uses the DevPilot mark for the executable, installer, and background tray', () => {
  const icon = resolve(__dirname, 'assets/devpilot.ico');
  assert.equal(config.packagerConfig.icon, icon);
  assert.equal(config.makers[0].config.setupIcon, icon);
  assert.ok(config.packagerConfig.extraResource.includes(
    resolve(__dirname, '../ui/sources/assets/images/icon.png'),
  ));
  assert.ok(config.packagerConfig.extraResource.includes(
    resolve(__dirname, '../ui/sources/assets/images/devpilot-bot.png'),
  ));
});
