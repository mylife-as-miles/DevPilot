#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCorepackCommand } from './corepack-command.mjs';

const ROOT = process.cwd();
const DEV_PORT = Number(process.env.DEVPILOT_ELECTRON_PORT ?? '8081');

function assertElectronDependenciesInstalled() {
  const requiredPackages = [
    join(ROOT, 'node_modules', 'electron', 'package.json'),
    join(ROOT, 'node_modules', '@electron-forge', 'cli', 'package.json'),
  ];
  if (!requiredPackages.every((candidate) => existsSync(candidate))) {
    throw new Error(
      'Electron dependencies are not installed. Run `corepack yarn install` from the DevPilot repository root, then retry.',
    );
  }
}

function spawnCorepack(args, options = {}) {
  const invocation = resolveCorepackCommand(args);
  return spawn(invocation.command, invocation.args, {
    cwd: ROOT,
    env: { ...process.env, DEVPILOT_DESKTOP_ROOT: ROOT, ...options.env },
    shell: false,
    stdio: options.stdio ?? 'inherit',
  });
}

function waitForChild(child, label) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} exited with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}.`));
    });
  });
}

async function waitForDevServer(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok || response.status === 404) return;
    } catch {
      // Expo has not finished starting yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Expo Web did not become reachable at ${url} within ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function runDevelopmentDesktop() {
  const url = `http://127.0.0.1:${DEV_PORT}`;
  const expo = spawnCorepack([
    'yarn', '--cwd', 'apps/ui', 'web', '--', '--port', String(DEV_PORT), '--localhost',
  ]);
  let electron = null;
  const cleanup = () => {
    if (electron && electron.exitCode == null) electron.kill();
    if (expo.exitCode == null) expo.kill();
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  try {
    await waitForDevServer(url);
    electron = spawnCorepack([
      'yarn', '--cwd', 'apps/electron', 'dev', '--', '--url', url,
    ]);
    await waitForChild(electron, 'Electron');
  } finally {
    cleanup();
  }
}

async function runProductionBuild() {
  await waitForChild(spawnCorepack(['yarn', '--cwd', 'apps/ui', 'electron:export']), 'Expo export');
  await waitForChild(spawnCorepack(['yarn', '--cwd', 'apps/electron', 'make']), 'Electron Forge');
}

const mode = process.argv[2] ?? 'dev';
if (mode !== 'dev' && mode !== 'build') {
  console.error('Usage: node scripts/electron-desktop.mjs <dev|build>');
  process.exitCode = 2;
} else {
  try {
    assertElectronDependenciesInstalled();
    await (mode === 'dev' ? runDevelopmentDesktop() : runProductionBuild());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
