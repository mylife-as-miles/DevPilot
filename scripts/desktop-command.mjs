import { spawn, spawnSync } from 'node:child_process';

const UI_SCRIPTS = Object.freeze({
  dev: 'tauri:dev',
  build: 'tauri:build:production',
});

export function createDesktopCommand(mode, options = {}) {
  const uiScript = UI_SCRIPTS[mode];
  if (!uiScript) {
    throw new Error(`Unsupported desktop command mode: ${mode}`);
  }

  const platform = options.platform ?? process.platform;
  return {
    command: platform === 'win32' ? 'corepack.cmd' : 'corepack',
    args: ['yarn', '--cwd', 'apps/ui', uiScript],
    options: {
      cwd: options.cwd ?? process.cwd(),
      shell: false,
      stdio: 'inherit',
    },
  };
}

export function formatMissingCargoMessage() {
  return [
    'DevPilot Desktop requires the Rust toolchain (Cargo) to run Tauri.',
    'Install Rust from https://rustup.rs/, restart this terminal, and retry.',
    'No Python runtime or DevPilot-CLI installation was changed.',
  ].join('\n');
}

export function assertCargoAvailable() {
  const result = spawnSync('cargo', ['--version'], {
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(formatMissingCargoMessage());
  }
}

export async function runDesktopCommand(mode, options = {}) {
  assertCargoAvailable();
  const invocation = createDesktopCommand(mode, options);

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, invocation.options);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Desktop command terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`Desktop ${mode} command exited with code ${exitCode}`);
  }
}
