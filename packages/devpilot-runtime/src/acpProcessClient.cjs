const { spawn } = require('node:child_process');

class AcpProcessClient {
  constructor(child, { onUpdate = () => {}, onStderr = () => {}, onExit = () => {} } = {}) {
    this.child = child;
    this.onUpdate = onUpdate;
    this.onStderr = onStderr;
    this.onExit = onExit;
    this.pending = new Map();
    this.sequence = 0;
    this.stdoutLines = [];
    this.stderr = '';
    this._stdoutBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._readStdout(chunk));
    child.stderr.on('data', (chunk) => {
      this.stderr += String(chunk);
      this.onStderr(String(chunk));
    });
    child.on('error', (error) => this._rejectAll(error));
    child.on('exit', (code, signal) => {
      const error = new Error('DevPilot ACP stopped.');
      this._rejectAll(error);
      this.onExit({ code, signal, error });
    });
  }

  static async start({ command, args, cwd, env, onUpdate, onStderr, onExit }) {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    return new AcpProcessClient(child, { onUpdate, onStderr, onExit });
  }

  request(method, params, timeoutMs = 15_000) {
    if (this.child.exitCode !== null || !this.child.stdin.writable) return Promise.reject(new Error('DevPilot ACP is not running.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`DevPilot ACP timed out while handling ${method}.`));
      }, timeoutMs) : null;
      this.pending.set(String(id), { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, 'utf8', (error) => {
        if (!error) return;
        const pending = this.pending.get(String(id));
        if (!pending) return;
        this.pending.delete(String(id));
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.reject(error);
      });
    });
  }

  async close() {
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill();
      }, 1_000);
      this.child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  terminate(message = 'DevPilot ACP was restarted for another project.') {
    this._rejectAll(new Error(message));
    if (this.child.exitCode === null) this.child.kill();
  }

  _readStdout(chunk) {
    this._stdoutBuffer += String(chunk);
    for (;;) {
      const newline = this._stdoutBuffer.indexOf('\n');
      if (newline < 0) return;
      const line = this._stdoutBuffer.slice(0, newline).trim();
      this._stdoutBuffer = this._stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      this.stdoutLines.push(line);
      const message = JSON.parse(line);
      if (Object.prototype.hasOwnProperty.call(message, 'id')) {
        const pending = this.pending.get(String(message.id));
        if (!pending) continue;
        this.pending.delete(String(message.id));
        if (pending.timeout) clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(String(message.error.message || 'ACP request failed.')));
        else pending.resolve(message.result || {});
      } else if (message.method === 'session/update') {
        this.onUpdate(message.params || {});
      }
    }
  }

  _rejectAll(error) {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

module.exports = { AcpProcessClient };
