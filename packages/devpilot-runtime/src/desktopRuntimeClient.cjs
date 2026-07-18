const { spawn } = require('node:child_process');

const MAX_STDERR_BYTES = 1_000_000;

class DesktopRuntimeProtocolError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DesktopRuntimeProtocolError';
    this.code = code;
    this.details = details && typeof details === 'object' ? details : {};
  }
}

/**
 * One long-lived client for DevPilot's private desktop-runtime protocol.
 *
 * The Electron main process owns this client. Renderer code can only call
 * explicitly-whitelisted IPC handlers and therefore cannot supply a command,
 * shell string, or arbitrary spawn arguments.
 */
class DevPilotRuntimeClient {
  constructor(child, { onEvent = () => {}, onStderr = () => {}, onExit = () => {}, onProtocolError = () => {} } = {}) {
    this.child = child;
    this.onEvent = onEvent;
    this.onStderr = onStderr;
    this.onExit = onExit;
    this.onProtocolError = onProtocolError;
    this.pending = new Map();
    this.sequence = 0;
    this.stdoutLines = [];
    this.stderr = '';
    this._stdoutBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._readStdout(chunk));
    child.stderr.on('data', (chunk) => this._readStderr(chunk));
    child.on('error', (error) => this._rejectAll(error));
    child.on('exit', (code, signal) => {
      const error = new Error('DevPilot desktop runtime stopped.');
      this._rejectAll(error);
      this.onExit({ code, signal, error });
    });
  }

  static async start({ command, args = [], cwd, env, onEvent, onStderr, onExit, onProtocolError }) {
    if (typeof command !== 'string' || !command.trim()) throw new TypeError('A DevPilot runtime executable is required.');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new TypeError('DevPilot runtime arguments must be a string array.');
    }
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    return new DevPilotRuntimeClient(child, { onEvent, onStderr, onExit, onProtocolError });
  }

  request(method, params = {}, timeoutMs = 15_000) {
    if (typeof method !== 'string' || !method.trim()) return Promise.reject(new TypeError('A desktop runtime method is required.'));
    if (!params || typeof params !== 'object' || Array.isArray(params)) return Promise.reject(new TypeError('Desktop runtime params must be an object.'));
    if (this.child.exitCode !== null || !this.child.stdin.writable) return Promise.reject(new Error('DevPilot desktop runtime is not running.'));
    const id = `desktop-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = timeoutMs > 0 ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevPilot desktop runtime timed out while handling ${method}.`));
      }, timeoutMs) : null;
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, 'utf8', (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.reject(error);
      });
    });
  }

  async close() {
    if (this.child.exitCode !== null) return;
    try {
      await this.request('runtime.shutdown', {}, 2_000);
    } catch {
      // A process that has already exited is safe to close below.
    }
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

  terminate(message = 'DevPilot desktop runtime was restarted.') {
    this._rejectAll(new Error(message));
    if (this.child.exitCode === null) this.child.kill();
  }

  _readStderr(chunk) {
    const text = String(chunk);
    this.stderr = `${this.stderr}${text}`.slice(-MAX_STDERR_BYTES);
    this.onStderr(text);
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
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.onProtocolError(new Error('DevPilot desktop runtime emitted an invalid protocol frame.'));
        continue;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        this.onProtocolError(new Error('DevPilot desktop runtime emitted an invalid protocol envelope.'));
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(message, 'id')) {
        const pending = this.pending.get(String(message.id));
        if (!pending) continue;
        this.pending.delete(String(message.id));
        if (pending.timeout) clearTimeout(pending.timeout);
        if (message.error) {
          const error = message.error && typeof message.error === 'object' ? message.error : {};
          pending.reject(new DesktopRuntimeProtocolError(
            typeof error.code === 'string' ? error.code : 'runtime_error',
            typeof error.message === 'string' ? error.message : 'DevPilot desktop runtime request failed.',
            error.details,
          ));
        } else {
          pending.resolve(message.result && typeof message.result === 'object' ? message.result : {});
        }
      } else if (typeof message.event === 'string' && message.event) {
        this.onEvent({ event: message.event, data: message.data && typeof message.data === 'object' ? message.data : {} });
      } else {
        this.onProtocolError(new Error('DevPilot desktop runtime emitted an unsupported protocol envelope.'));
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

module.exports = { DevPilotRuntimeClient, DesktopRuntimeProtocolError };
