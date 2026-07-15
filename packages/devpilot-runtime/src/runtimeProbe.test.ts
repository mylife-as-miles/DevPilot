import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { probeDevPilotRuntime, type DevPilotRuntime } from './index.ts';

const runtime: DevPilotRuntime = Object.freeze({
  command: 'C:\\repo\\.venv\\Scripts\\devpilot.exe',
  argsPrefix: Object.freeze([]),
  kind: 'executable',
  source: 'sibling-repository',
  repositoryPath: 'C:\\repo',
  virtualEnvironmentPath: 'C:\\repo\\.venv',
});

test('reports a ready sibling runtime without starting ACP', async () => {
  const projectPath = mkdtempSync(path.join(tmpdir(), 'devpilot-runtime-probe-'));
  const calls: readonly string[][] = [];
  const mutableCalls = calls as string[][];

  try {
    const result = await probeDevPilotRuntime(runtime, {
      platform: 'win32',
      projectPath,
      runCommand: async (command, args) => {
        mutableCalls.push([...args]);
        if (command.endsWith('devpilot.exe') && args.includes('--version')) {
          return { exitCode: 0, stdout: 'DevPilot 0.1.0\n', stderr: '' };
        }
        if (args.includes('--help')) {
          return { exitCode: 0, stdout: 'Commands: run acp doctor\n', stderr: '' };
        }
        return { exitCode: 0, stdout: 'Python 3.12.4\n', stderr: '' };
      },
    });

    assert.equal(result.ready, true);
    assert.equal(result.version, '0.1.0');
    assert.equal(result.acpAvailable, true);
    assert.equal(result.pythonVersion, '3.12.4');
    assert.equal(result.pythonCompatible, true);
    assert.equal(result.projectAccessible, true);
    assert.deepEqual(mutableCalls, [
      ['--version'],
      ['--help'],
      ['--version'],
    ]);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test('explains every failed readiness check', async () => {
  const result = await probeDevPilotRuntime(runtime, {
    platform: 'win32',
    projectPath: 'C:\\missing-project',
    projectExists: () => false,
    runCommand: async (command, args) => {
      if (args.includes('--help')) return { exitCode: 0, stdout: 'Commands: run doctor\n', stderr: '' };
      if (command.endsWith('devpilot.exe')) return { exitCode: 1, stdout: '', stderr: 'broken install' };
      return { exitCode: 0, stdout: 'Python 3.9.18\n', stderr: '' };
    },
  });

  assert.equal(result.ready, false);
  assert.equal(result.version, null);
  assert.equal(result.acpAvailable, false);
  assert.equal(result.pythonCompatible, false);
  assert.equal(result.projectAccessible, false);
  assert.deepEqual(result.issues, [
    'DevPilot version check failed: broken install',
    'The selected DevPilot runtime does not expose the ACP command.',
    'Python 3.10 or newer is required; detected Python 3.9.18.',
    'The selected project directory is not accessible: C:\\missing-project',
  ]);
});

test('does not reject a global executable when its Python interpreter cannot be identified', async () => {
  const globalRuntime: DevPilotRuntime = Object.freeze({
    command: 'devpilot.exe',
    argsPrefix: Object.freeze([]),
    kind: 'executable',
    source: 'path',
    repositoryPath: null,
    virtualEnvironmentPath: null,
  });

  const result = await probeDevPilotRuntime(globalRuntime, {
    runCommand: async (_command, args) => ({
      exitCode: 0,
      stdout: args.includes('--help') ? 'Commands: acp\n' : 'DevPilot 0.2.0\n',
      stderr: '',
    }),
  });

  assert.equal(result.ready, true);
  assert.equal(result.pythonVersion, null);
  assert.equal(result.pythonCompatible, null);
});
