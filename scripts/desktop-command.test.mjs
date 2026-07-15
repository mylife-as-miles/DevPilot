import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopCommand, formatMissingCargoMessage } from './desktop-command.mjs';

test('creates a Windows development command without shell interpolation', () => {
  const invocation = createDesktopCommand('dev', { platform: 'win32' });
  assert.equal(invocation.command, 'corepack.cmd');
  assert.deepEqual(invocation.args, ['yarn', '--cwd', 'apps/ui', 'tauri:dev']);
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
    command: 'corepack',
    args: ['yarn', '--cwd', 'apps/ui', 'tauri:build:production'],
    cwd: '/workspace/DevPilot',
    shell: false,
    stdio: 'inherit',
    desktopRoot: '/workspace/DevPilot',
  });
});

test('rejects unsupported desktop command modes', () => {
  assert.throws(() => createDesktopCommand('release'), /Unsupported desktop command mode/);
});

test('missing Cargo guidance is actionable', () => {
  assert.match(formatMissingCargoMessage(), /Rust toolchain/);
  assert.match(formatMissingCargoMessage(), /rustup\.rs/);
  assert.match(formatMissingCargoMessage(), /restart/i);
});
