import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';

import { createDesktopCommand, formatDesktopRuntimeMessage } from './desktop-command.mjs';

test('creates a Windows development command without shell interpolation', () => {
  const invocation = createDesktopCommand('dev', { platform: 'win32' });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js'),
    'yarn',
    'electron:dev',
  ]);
  assert.deepEqual({
    cwd: invocation.options.cwd,
    shell: invocation.options.shell,
    stdio: invocation.options.stdio,
    desktopRoot: invocation.options.env.DEVPILOT_DESKTOP_ROOT,
  }, {
    cwd: process.cwd(),
    shell: false,
    stdio: 'inherit',
    desktopRoot: process.cwd(),
  });
});

test('preserves an explicit desktop root for packaged launch environments', () => {
  const invocation = createDesktopCommand('dev', {
    platform: 'win32',
    cwd: 'C:\\workspace\\DevPilot',
    env: { DEVPILOT_DESKTOP_ROOT: 'D:\\installed\\DevPilot' },
  });
  assert.equal(invocation.options.env.DEVPILOT_DESKTOP_ROOT, 'D:\\installed\\DevPilot');
});

test('creates a production build command without shell interpolation', () => {
  const invocation = createDesktopCommand('build', { platform: 'linux', cwd: '/workspace/DevPilot' });
  assert.deepEqual({
    command: invocation.command,
    args: invocation.args,
    cwd: invocation.options.cwd,
    shell: invocation.options.shell,
    stdio: invocation.options.stdio,
    desktopRoot: invocation.options.env.DEVPILOT_DESKTOP_ROOT,
  }, {
    command: process.execPath,
    args: [
      join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js'),
      'yarn',
      'electron:build',
    ],
    cwd: '/workspace/DevPilot',
    shell: false,
    stdio: 'inherit',
    desktopRoot: '/workspace/DevPilot',
  });
});

test('rejects unsupported desktop command modes', () => {
  assert.throws(() => createDesktopCommand('release'), /Unsupported desktop command mode/);
});

test('Electron desktop guidance does not require Rust', () => {
  assert.match(formatDesktopRuntimeMessage(), /Electron/);
  assert.match(formatDesktopRuntimeMessage(), /does not require Rust/i);
  assert.match(formatDesktopRuntimeMessage(), /yarn install/i);
});
