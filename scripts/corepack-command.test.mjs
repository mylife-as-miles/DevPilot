import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCorepackCommand } from './corepack-command.mjs';

test('uses Corepack JavaScript through Node when the entrypoint exists', () => {
  const invocation = resolveCorepackCommand(['yarn', '--version']);
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args.at(-2), 'yarn');
  assert.equal(invocation.args.at(-1), '--version');
});

test('falls back to a platform executable only when no entrypoint is present', () => {
  const invocation = resolveCorepackCommand(['yarn', '--version'], {
    platform: 'win32',
    entrypoint: 'Z:\\missing\\corepack.js',
  });
  assert.equal(invocation.command, 'corepack.cmd');
  assert.deepEqual(invocation.args, ['yarn', '--version']);
});
