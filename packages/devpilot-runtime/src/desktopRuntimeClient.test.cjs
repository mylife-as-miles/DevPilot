const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const test = require('node:test');

const { DesktopRuntimeProtocolError, DevPilotRuntimeClient } = require('./desktopRuntimeClient.cjs');

test('private desktop runtime correlates requests, delivers events, and drains stderr', async () => {
  const repository = resolve(__dirname, '..', '..', '..');
  const executable = join(repository, '.venv', 'Scripts', 'python.exe');
  assert.equal(existsSync(executable), true, 'repository-local Python runtime must exist');
  assert.match(execFileSync(executable, ['-m', 'devpilot.cli.app', '--version'], { encoding: 'utf8' }), /devpilot/i);

  const events = [];
  const diagnostics = [];
  const client = await DevPilotRuntimeClient.start({
    command: executable,
    args: ['-m', 'devpilot.cli.app', 'desktop-runtime', '--stdio'],
    cwd: repository,
    env: { ...process.env, DEVPILOT_DESKTOP_RUNTIME_TEST_MODE: '1' },
    onEvent: (event) => events.push(event),
    onStderr: (entry) => diagnostics.push(entry),
  });
  try {
    const [version, initialized] = await Promise.all([
      client.request('runtime.version'),
      client.request('runtime.initialize'),
    ]);
    assert.equal(version.protocolVersion, 1);
    assert.equal(initialized.runtime, 'devpilot-desktop-runtime');
    assert.equal((await client.request('auth.status')).signedIn, true);
    assert.equal((await client.request('models.list')).provider, 'codex');
    await assert.rejects(
      client.request('not.a.method'),
      (error) => error instanceof DesktopRuntimeProtocolError && error.code === 'method_not_found',
    );
    assert.ok(events.some((event) => event.event === 'runtime.status' && event.data.state === 'ready'));
    assert.ok(client.stdoutLines.every((line) => {
      const frame = JSON.parse(line);
      return typeof frame === 'object' && frame !== null;
    }));
    assert.equal(client.stderr.includes('sk-'), false);
    assert.equal(diagnostics.join('').includes('sk-'), false);
    assert.equal(client.pending.size, 0);
  } finally {
    await client.close();
  }
});

test('desktop runtime client validates method and parameter framing before writing to stdin', async () => {
  const fakeChild = {
    exitCode: null,
    stdin: { writable: true },
  };
  const client = Object.create(DevPilotRuntimeClient.prototype);
  client.child = fakeChild;
  await assert.rejects(client.request('', {}), /method is required/);
  await assert.rejects(client.request('runtime.status', []), /params must be an object/);
});
