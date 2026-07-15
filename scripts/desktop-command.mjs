import { spawn, spawnSync } from 'node:child_process';
import { resolveCorepackCommand } from './corepack-command.mjs';

const UI_SCRIPTS = Object.freeze({
  dev: 'electron:dev',
  build: 'electron:build',
});

export function createDesktopCommand(mode, options = {}) {
  const uiScript = UI_SCRIPTS[mode];
  if (!uiScript) {
    throw new Error(`Unsupported desktop command mode: ${mode}`);
  }

  const cwd = options.cwd ?? process.cwd();
  const corepack = resolveCorepackCommand(['yarn', uiScript], {
    platform: options.platform,
  });
  return {
    command: corepack.command,
    args: corepack.args,
    options: {
      cwd,
      env: {
        ...process.env,
        ...options.env,
        DEVPILOT_DESKTOP_ROOT: options.env?.DEVPILOT_DESKTOP_ROOT ?? cwd,
      },
      shell: false,
      stdio: 'inherit',
    },
  };
}

export function formatDesktopRuntimeMessage() {
  return [
    'DevPilot Desktop runs through Electron and does not require Rust or Cargo.',
    'Install the workspace dependencies with `corepack yarn install`, then retry.',
    'No Python runtime or DevPilot-CLI installation is changed by desktop startup.',
  ].join('\n');
}

export function assertSupportedNodeRuntime() {
  const result = spawnSync(process.execPath, ['--version'], {
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(formatDesktopRuntimeMessage());
  }
}

export async function runDesktopCommand(mode, options = {}) {
  assertSupportedNodeRuntime();
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
