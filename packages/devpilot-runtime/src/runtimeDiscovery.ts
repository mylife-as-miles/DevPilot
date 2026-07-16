import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type DevPilotRuntimeSource =
  | 'configured'
  | 'repository-virtual-environment'
  | 'path';

export type DevPilotRuntime = Readonly<{
  command: string;
  argsPrefix: readonly string[];
  kind: 'executable' | 'python-module';
  source: DevPilotRuntimeSource;
  repositoryPath: string | null;
  virtualEnvironmentPath: string | null;
}>;

export type DevPilotDiscoveryResult = Readonly<{
  runtime: DevPilotRuntime | null;
  searchedPaths: readonly string[];
  detectedPythonInstallations: readonly string[];
  detectedVirtualEnvironments: readonly string[];
  repositoryPath: string;
}>;

type DiscoveryOptions = Readonly<{
  configuredExecutablePath?: string | null;
  desktopRoot?: string;
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  fileExists?: (candidate: string) => boolean;
  resolveCommandOnPath?: (commandName: string) => string | null;
}>;

function platformPath(platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function defaultFileExists(candidate: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    if (platform !== 'win32') accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function expandConfiguredPath(
  value: string,
  desktopRoot: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string {
  const pathApi = platformPath(platform);
  const trimmed = value.trim();
  const home = env.HOME || env.USERPROFILE || homedir();
  const expanded = trimmed === '~'
    ? home
    : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? pathApi.join(home, trimmed.slice(2))
      : trimmed;
  return pathApi.isAbsolute(expanded) ? pathApi.normalize(expanded) : pathApi.resolve(desktopRoot, expanded);
}

function resolveOnPath(
  commandName: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  fileExists: (candidate: string) => boolean,
): string | null {
  const pathApi = platformPath(platform);
  const pathValue = env.PATH || env.Path || env.path || '';
  if (!pathValue) return null;

  const extensions = platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const hasExtension = platform !== 'win32' || pathApi.extname(commandName) !== '';
  const names = hasExtension ? [commandName] : extensions.map((extension) => `${commandName}${extension}`);

  for (const directory of pathValue.split(pathApi.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = pathApi.resolve(directory.replace(/^"|"$/g, ''), name);
      if (fileExists(candidate)) return candidate;
    }
  }
  return null;
}

function createRuntime(
  command: string,
  source: DevPilotRuntimeSource,
  repositoryPath: string | null,
  virtualEnvironmentPath: string | null,
): DevPilotRuntime {
  const fileName = path.basename(command).toLowerCase();
  const isPython = fileName === 'python' || fileName === 'python.exe' || /^python\d+(?:\.\d+)?(?:\.exe)?$/.test(fileName);
  return Object.freeze({
    command,
    argsPrefix: isPython ? Object.freeze(['-m', 'devpilot.cli.app']) : Object.freeze([]),
    kind: isPython ? 'python-module' : 'executable',
    source,
    repositoryPath,
    virtualEnvironmentPath,
  });
}

function virtualEnvironmentCandidates(
  root: string,
  platform: NodeJS.Platform,
  includeEnvironmentDirectory: boolean,
): readonly Readonly<{ path: string; environmentPath: string }>[] {
  const pathApi = platformPath(platform);
  const environments = includeEnvironmentDirectory
    ? [pathApi.join(root, '.venv'), pathApi.join(root, 'venv')]
    : [root];
  const binDirectory = platform === 'win32' ? 'Scripts' : 'bin';
  const executableName = platform === 'win32' ? 'devpilot.exe' : 'devpilot';
  const pythonName = platform === 'win32' ? 'python.exe' : 'python';

  return [
    ...environments.map((environmentPath) => ({
      path: pathApi.join(environmentPath, binDirectory, executableName),
      environmentPath,
    })),
    ...environments.map((environmentPath) => ({
      path: pathApi.join(environmentPath, binDirectory, pythonName),
      environmentPath,
    })),
  ];
}

export function discoverDevPilotRuntime(options: DiscoveryOptions = {}): DevPilotDiscoveryResult {
  const platform = options.platform ?? process.platform;
  const pathApi = platformPath(platform);
  const desktopRoot = pathApi.resolve(options.desktopRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? ((candidate: string) => defaultFileExists(candidate, platform));
  const searchedPaths: string[] = [];
  const detectedPythonInstallations: string[] = [];
  const detectedVirtualEnvironments: string[] = [];
  const repositoryPath = desktopRoot;

  const finish = (runtime: DevPilotRuntime | null): DevPilotDiscoveryResult => Object.freeze({
    runtime,
    searchedPaths: Object.freeze([...searchedPaths]),
    detectedPythonInstallations: Object.freeze([...new Set(detectedPythonInstallations)]),
    detectedVirtualEnvironments: Object.freeze([...new Set(detectedVirtualEnvironments)]),
    repositoryPath,
  });

  const configured = options.configuredExecutablePath?.trim();
  if (configured) {
    const configuredPath = expandConfiguredPath(configured, desktopRoot, env, platform);
    searchedPaths.push(configuredPath);
    if (fileExists(configuredPath)) {
      return finish(createRuntime(configuredPath, 'configured', null, null));
    }
  }

  const repositoryCandidates = virtualEnvironmentCandidates(repositoryPath, platform, true);
  searchedPaths.push(...repositoryCandidates.map((candidate) => candidate.path));
  for (const candidate of repositoryCandidates) {
    if (!fileExists(candidate.path)) continue;
    detectedVirtualEnvironments.push(candidate.environmentPath);
    if (createRuntime(candidate.path, 'repository-virtual-environment', repositoryPath, candidate.environmentPath).kind === 'python-module') {
      detectedPythonInstallations.push(candidate.path);
    }
    return finish(createRuntime(candidate.path, 'repository-virtual-environment', repositoryPath, candidate.environmentPath));
  }

  const globalCommandName = platform === 'win32' ? 'devpilot.exe' : 'devpilot';
  searchedPaths.push(globalCommandName);
  const globalPath = options.resolveCommandOnPath
    ? options.resolveCommandOnPath(globalCommandName)
    : resolveOnPath(globalCommandName, env, platform, fileExists);
  if (globalPath) return finish(createRuntime(globalPath, 'path', null, null));

  return finish(null);
}

export function buildDevPilotVersionInvocation(runtime: DevPilotRuntime) {
  return Object.freeze({
    command: runtime.command,
    args: Object.freeze([...runtime.argsPrefix, '--version']),
    options: Object.freeze({ shell: false as const }),
  });
}

export function buildDevPilotAcpInvocation(runtime: DevPilotRuntime) {
  return Object.freeze({
    command: runtime.command,
    args: Object.freeze([...runtime.argsPrefix, 'acp', '--stdio']),
    options: Object.freeze({ shell: false as const }),
  });
}

export function formatRuntimeNotFoundGuidance(result: DevPilotDiscoveryResult): string {
  return [
    'DevPilot runtime was not found.',
    `Expected a virtual environment in ${result.repositoryPath} (normally .venv or venv).`,
    'Install DevPilot in this repository virtual environment, or choose a manual executable path in Settings.',
    'No Python installation or virtual environment was created automatically.',
    'After correcting the runtime, use Retry detection.',
  ].join('\n');
}
