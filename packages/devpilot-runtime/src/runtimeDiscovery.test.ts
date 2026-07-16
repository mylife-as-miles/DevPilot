import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDevPilotAcpInvocation,
  discoverDevPilotRuntime,
  formatRuntimeNotFoundGuidance,
} from './runtimeDiscovery.ts';

function fakeFiles(paths: readonly string[]) {
  const normalized = new Set(paths.map((value) => value.toLowerCase()));
  return (candidate: string) => normalized.has(candidate.toLowerCase());
}

test('prefers an explicit configured executable over repository candidates', () => {
  const configured = String.raw`D:\Tools\devpilot.exe`;
  const result = discoverDevPilotRuntime({
    platform: 'win32',
    desktopRoot: String.raw`C:\Users\Miles\Documents\DevPilot`,
    configuredExecutablePath: configured,
    env: {},
    fileExists: fakeFiles([configured, String.raw`C:\Users\Miles\Documents\DevPilot\.venv\Scripts\devpilot.exe`]),
    resolveCommandOnPath: () => String.raw`C:\global\devpilot.exe`,
  });

  assert.equal(result.runtime?.source, 'configured');
  assert.equal(result.runtime?.command, configured);
});

test('finds the current repository using the required Windows candidate order', () => {
  const desktopRoot = String.raw`C:\Users\Miles\Documents\DevPilot`;
  const expected = String.raw`C:\Users\Miles\Documents\DevPilot\venv\Scripts\devpilot.exe`;
  const result = discoverDevPilotRuntime({
    platform: 'win32', desktopRoot, env: {}, fileExists: fakeFiles([expected]), resolveCommandOnPath: () => null,
  });

  assert.equal(result.runtime?.source, 'repository-virtual-environment');
  assert.equal(result.runtime?.repositoryPath, desktopRoot);
  assert.equal(result.runtime?.command, expected);
  assert.deepEqual(result.searchedPaths.slice(0, 4), [
    String.raw`C:\Users\Miles\Documents\DevPilot\.venv\Scripts\devpilot.exe`,
    String.raw`C:\Users\Miles\Documents\DevPilot\venv\Scripts\devpilot.exe`,
    String.raw`C:\Users\Miles\Documents\DevPilot\.venv\Scripts\python.exe`,
    String.raw`C:\Users\Miles\Documents\DevPilot\venv\Scripts\python.exe`,
  ]);
});

test('uses Python module arguments when only repository Python exists', () => {
  const python = '/work/DevPilot/.venv/bin/python';
  const result = discoverDevPilotRuntime({ platform: 'linux', desktopRoot: '/work/DevPilot', env: {}, fileExists: fakeFiles([python]), resolveCommandOnPath: () => null });
  assert.equal(result.runtime?.kind, 'python-module');
  assert.deepEqual(buildDevPilotAcpInvocation(result.runtime!), { command: python, args: ['-m', 'devpilot.cli.app', 'acp', '--stdio'], options: { shell: false } });
});

test('uses the global command only after repository candidates fail', () => {
  const result = discoverDevPilotRuntime({ platform: 'win32', desktopRoot: String.raw`C:\work\DevPilot`, env: {}, fileExists: () => false, resolveCommandOnPath: () => String.raw`C:\bin\devpilot.exe` });
  assert.equal(result.runtime?.source, 'path');
});

test('missing-runtime guidance describes repository virtual-environment recovery', () => {
  const result = discoverDevPilotRuntime({ platform: 'linux', desktopRoot: '/work/DevPilot', env: {}, fileExists: () => false, resolveCommandOnPath: () => null });
  assert.match(formatRuntimeNotFoundGuidance(result), /\.venv/);
  assert.match(formatRuntimeNotFoundGuidance(result), /manual executable/i);
});
