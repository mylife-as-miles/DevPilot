import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopCommand, formatMissingCargoMessage } from './desktop-command.mjs';

test('creates a Windows development command without shell interpolation', () => {
  assert.deepEqual(createDesktopCommand('dev', { platform: 'win32' }), {
    command: 'corepack.cmd',
    args: ['yarn', '--cwd', 'apps/ui', 'tauri:dev'],
    options: {
      cwd: process.cwd(),
      shell: false,
      stdio: 'inherit',
    },
  });
});

test('creates a production build command without shell interpolation', () => {
  assert.deepEqual(createDesktopCommand('build', { platform: 'linux', cwd: '/workspace/DevPilot' }), {
    command: 'corepack',
    args: ['yarn', '--cwd', 'apps/ui', 'tauri:build:production'],
    options: {
      cwd: '/workspace/DevPilot',
      shell: false,
      stdio: 'inherit',
    },
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
