const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const test = require('node:test');

const { AcpProcessClient } = require('./acpProcessClient.cjs');

test('real ACP process reaches the deterministic SDK path and handles cancellation', async () => {
  const repository = resolve(__dirname, '..', '..', '..');
  const executable = join(repository, '.venv', 'Scripts', 'devpilot.exe');
  assert.equal(existsSync(executable), true, 'repository-local runtime must exist');
  assert.match(execFileSync(executable, ['--version'], { encoding: 'utf8' }), /devpilot/i);

  const project = mkdtempSync(join(tmpdir(), 'devpilot-acp-integration-'));
  const updates = [];
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'integration@example.invalid'], { cwd: project });
    execFileSync('git', ['config', 'user.name', 'DevPilot Integration'], { cwd: project });
    require('node:fs').writeFileSync(join(project, 'README.md'), '# integration\n');
    execFileSync('git', ['add', 'README.md'], { cwd: project });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: project, stdio: 'ignore' });

    const client = await AcpProcessClient.start({
      command: executable,
      args: ['acp', '--stdio'],
      cwd: project,
      env: { ...process.env, DEVPILOT_ACP_TEST_MODE: '1', DEVPILOT_ACP_TEST_DELAY_SECONDS: '0.25' },
      onUpdate: (update) => updates.push(update),
    });
    try {
      assert.equal((await client.request('initialize', {})).protocolVersion, 1);
      const session = await client.request('session/new', { cwd: project });
      const options = { provider: 'litellm', api_key: 'integration-secret' };
      const preflight = await client.request('devpilot/preflight', { cwd: project, options });
      assert.equal(preflight.ready, true);

      const result = await client.request('session/prompt', { sessionId: session.sessionId, prompt: { text: 'deterministic run' }, options }, 5_000);
      assert.equal(result.stopReason, 'end_turn');
      assert.ok(updates.some((update) => update.update?._meta?.devpilot?.type === 'runtime.started'));

      const cancelling = client.request('session/prompt', { sessionId: session.sessionId, prompt: { text: 'cancel this run' }, options }, 5_000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const cancellation = await client.request('session/cancel', { sessionId: session.sessionId });
      assert.equal(cancellation.status, 'cancelled');
      assert.equal((await cancelling).stopReason, 'cancelled');
      assert.ok(client.stdoutLines.every((line) => JSON.parse(line).jsonrpc === '2.0'));
      assert.equal(client.stderr.includes('integration-secret'), false);
      assert.equal(client.pending.size, 0);

      const firstPid = client.child.pid;
      await client.close();
      const restarted = await AcpProcessClient.start({
        command: executable,
        args: ['acp', '--stdio'],
        cwd: project,
        env: { ...process.env, DEVPILOT_ACP_TEST_MODE: '1' },
      });
      try {
        assert.notEqual(restarted.child.pid, firstPid, 'restart must spawn a fresh ACP process');
        await restarted.request('initialize', {});
        const freshSession = await restarted.request('session/new', { cwd: project });
        assert.notEqual(freshSession.sessionId, session.sessionId, 'restart must create a fresh ACP session');
        assert.equal(restarted.pending.size, 0);
      } finally {
        await restarted.close();
      }
    } finally {
      await client.close();
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
