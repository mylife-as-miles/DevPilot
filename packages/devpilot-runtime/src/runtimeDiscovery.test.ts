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

test('prefers an explicit configured executable over every automatic candidate', () => {
  const configured = String.raw`D:\Tools\devpilot.exe`;
  const result = discoverDevPilotRuntime({
    platform: 'win32',
    desktopRoot: String.raw`C:\Users\Miles\Documents\DevPilot`,
    configuredExecutablePath: configured,
    env: { VIRTUAL_ENV: String.raw`C:\active` },
    fileExists: fakeFiles([
      configured,
      String.raw`C:\Users\Miles\Documents\DevPilot-CLI\.venv\Scripts\devpilot.exe`,
      String.raw`C:\active\Scripts\devpilot.exe`,
    ]),
    resolveCommandOnPath: () => String.raw`C:\global\devpilot.exe`,
  });

  assert.equal(result.runtime?.source, 'configured');
  assert.equal(result.runtime?.command, configured);
  assert.deepEqual(result.runtime?.argsPrefix, []);
});

test('finds the sibling repository using the required Windows candidate order', () => {
  const desktopRoot = String.raw`C:\Users\Miles\Documents\DevPilot`;
  const expected = String.raw`C:\Users\Miles\Documents\DevPilot-CLI\venv\Scripts\devpilot.exe`;
  const result = discoverDevPilotRuntime({
    platform: 'win32',
    desktopRoot,
    env: {},
    fileExists: fakeFiles([expected]),
    resolveCommandOnPath: () => null,
  });

  assert.equal(result.runtime?.source, 'sibling-repository');
  assert.equal(result.runtime?.repositoryPath, String.raw`C:\Users\Miles\Documents\DevPilot-CLI`);
  assert.equal(result.runtime?.command, expected);
  assert.deepEqual(result.searchedPaths.slice(0, 4), [
    String.raw`C:\Users\Miles\Documents\DevPilot-CLI\.venv\Scripts\devpilot.exe`,
    String.raw`C:\Users\Miles\Documents\DevPilot-CLI\venv\Scripts\devpilot.exe`,
    String.raw`C:\Users\Miles\Documents\DevPilot-CLI\.venv\Scripts\python.exe`,
    String.raw`C:\Users\Miles\Documents\DevPilot-CLI\venv\Scripts\python.exe`,
  ]);
});

test('uses Python module arguments when only sibling Python exists', () => {
  const python = '/home/miles/DevPilot-CLI/.venv/bin/python';
  const result = discoverDevPilotRuntime({
    platform: 'linux',
    desktopRoot: '/home/miles/DevPilot',
    env: {},
    fileExists: fakeFiles([python]),
    resolveCommandOnPath: () => null,
  });

  assert.equal(result.runtime?.command, python);
  assert.equal(result.runtime?.kind, 'python-module');
  assert.deepEqual(result.runtime?.argsPrefix, ['-m', 'devpilot.cli.app']);
  assert.deepEqual(buildDevPilotAcpInvocation(result.runtime!), {
    command: python,
    args: ['-m', 'devpilot.cli.app', 'acp', '--stdio'],
    options: { shell: false },
  });
});

test('falls back from the sibling repository to the active virtual environment', () => {
  const active = '/tmp/devpilot-env/bin/devpilot';
  const result = discoverDevPilotRuntime({
    platform: 'darwin',
    desktopRoot: '/work/DevPilot',
    env: { VIRTUAL_ENV: '/tmp/devpilot-env' },
    fileExists: fakeFiles([active]),
    resolveCommandOnPath: () => null,
  });

  assert.equal(result.runtime?.source, 'active-virtual-environment');
  assert.equal(result.runtime?.command, active);
  assert.deepEqual(result.detectedVirtualEnvironments, ['/tmp/devpilot-env']);
});

test('uses the global command only after local and active environments fail', () => {
  const result = discoverDevPilotRuntime({
    platform: 'win32',
    desktopRoot: String.raw`C:\work\DevPilot`,
    env: {},
    fileExists: () => false,
    resolveCommandOnPath: (name) => name === 'devpilot.exe' ? String.raw`C:\bin\devpilot.exe` : null,
  });

  assert.equal(result.runtime?.source, 'path');
  assert.equal(result.runtime?.command, String.raw`C:\bin\devpilot.exe`);
});

test('missing-runtime guidance describes manual and editable-install recovery', () => {
  const result = discoverDevPilotRuntime({
    platform: 'linux',
    desktopRoot: '/work/DevPilot',
    env: {},
    fileExists: () => false,
    resolveCommandOnPath: () => null,
  });
  const guidance = formatRuntimeNotFoundGuidance(result);

  assert.equal(result.runtime, null);
  assert.match(guidance, /\.\.\/DevPilot-CLI/);
  assert.match(guidance, /editable/i);
  assert.match(guidance, /manual executable/i);
  assert.match(guidance, /retry/i);
});
