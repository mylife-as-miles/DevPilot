import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';

import type { DevPilotRuntime } from './runtimeDiscovery.ts';

export type CommandResult = Readonly<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}>;

export type DevPilotRuntimeProbe = Readonly<{
  ready: boolean;
  version: string | null;
  acpAvailable: boolean;
  pythonVersion: string | null;
  pythonCompatible: boolean | null;
  projectAccessible: boolean | null;
  issues: readonly string[];
}>;

type ProbeOptions = Readonly<{
  platform?: NodeJS.Platform;
  projectPath?: string | null;
  timeoutMs?: number;
  runCommand?: (command: string, args: readonly string[], timeoutMs: number) => Promise<CommandResult>;
  projectExists?: (projectPath: string) => boolean;
}>;

function runCommand(command: string, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms.`.trim() });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => finish({ exitCode: null, stdout, stderr: error.message }));
    child.on('close', (exitCode) => finish({ exitCode, stdout, stderr }));
  });
}

function defaultProjectExists(projectPath: string): boolean {
  try {
    if (!statSync(projectPath).isDirectory()) return false;
    accessSync(projectPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseVersion(output: string, productName: string): string | null {
  const expression = new RegExp(`${productName}\\s+([0-9]+(?:\\.[0-9A-Za-z-]+)+)`, 'i');
  return output.match(expression)?.[1] ?? null;
}

function pythonCommandForRuntime(runtime: DevPilotRuntime, platform: NodeJS.Platform): string | null {
  if (runtime.kind === 'python-module') return runtime.command;
  if (!runtime.virtualEnvironmentPath) return null;
  return platform === 'win32'
    ? path.win32.join(runtime.virtualEnvironmentPath, 'Scripts', 'python.exe')
    : path.posix.join(runtime.virtualEnvironmentPath, 'bin', 'python');
}

function formatCommandFailure(result: CommandResult): string {
  return (result.stderr || result.stdout || `exit code ${String(result.exitCode)}`).trim();
}

export async function probeDevPilotRuntime(
  runtime: DevPilotRuntime,
  options: ProbeOptions = {},
): Promise<DevPilotRuntimeProbe> {
  const platform = options.platform ?? process.platform;
  const execute = options.runCommand ?? runCommand;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const issues: string[] = [];

  const versionResult = await execute(runtime.command, [...runtime.argsPrefix, '--version'], timeoutMs);
  const version = versionResult.exitCode === 0
    ? parseVersion(`${versionResult.stdout}\n${versionResult.stderr}`, 'DevPilot')
    : null;
  if (!version) {
    issues.push(`DevPilot version check failed: ${formatCommandFailure(versionResult)}`);
  }

  const helpResult = await execute(runtime.command, [...runtime.argsPrefix, '--help'], timeoutMs);
  const acpAvailable = helpResult.exitCode === 0 && /(?:^|\s)acp(?:\s|$)/im.test(helpResult.stdout);
  if (!acpAvailable) {
    issues.push('The selected DevPilot runtime does not expose the ACP command.');
  }

  const pythonCommand = pythonCommandForRuntime(runtime, platform);
  let pythonVersion: string | null = null;
  let pythonCompatible: boolean | null = null;
  if (pythonCommand) {
    const pythonResult = await execute(pythonCommand, ['--version'], timeoutMs);
    pythonVersion = pythonResult.exitCode === 0
      ? parseVersion(`${pythonResult.stdout}\n${pythonResult.stderr}`, 'Python')
      : null;
    if (pythonVersion) {
      const [major, minor] = pythonVersion.split('.').map(Number);
      pythonCompatible = major > 3 || (major === 3 && minor >= 10);
      if (!pythonCompatible) {
        issues.push(`Python 3.10 or newer is required; detected Python ${pythonVersion}.`);
      }
    } else {
      pythonCompatible = false;
      issues.push(`Python compatibility check failed: ${formatCommandFailure(pythonResult)}`);
    }
  }

  const requestedProject = options.projectPath?.trim();
  let projectAccessible: boolean | null = null;
  if (requestedProject) {
    projectAccessible = (options.projectExists ?? defaultProjectExists)(requestedProject);
    if (!projectAccessible) {
      issues.push(`The selected project directory is not accessible: ${requestedProject}`);
    }
  }

  return Object.freeze({
    ready: issues.length === 0,
    version,
    acpAvailable,
    pythonVersion,
    pythonCompatible,
    projectAccessible,
    issues: Object.freeze(issues),
  });
}
