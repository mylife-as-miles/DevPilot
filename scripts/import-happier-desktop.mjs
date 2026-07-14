import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultTargetRoot = dirname(scriptDir);

export const importEntries = Object.freeze([
  { source: 'apps/bootstrap', target: 'apps/bootstrap' },
  { source: 'apps/cli', target: 'apps/cli' },
  { source: 'apps/ui', target: 'apps/ui' },
  { source: 'apps/stack/package.json', target: 'apps/stack/package.json' },
  { source: 'apps/stack/bin', target: 'apps/stack/bin' },
  { source: 'apps/stack/scripts/tauri_dev.mjs', target: 'apps/stack/scripts/tauri_dev.mjs' },
  { source: 'apps/stack/scripts/utils', target: 'apps/stack/scripts/utils' },
  { source: 'packages/agents', target: 'packages/agents' },
  { source: 'packages/audio-stream-native', target: 'packages/audio-stream-native' },
  { source: 'packages/cli-common', target: 'packages/cli-common' },
  { source: 'packages/connection-supervisor', target: 'packages/connection-supervisor' },
  { source: 'packages/protocol', target: 'packages/protocol' },
  { source: 'packages/release-runtime', target: 'packages/release-runtime' },
  { source: 'packages/sherpa-native', target: 'packages/sherpa-native' },
  { source: 'packages/transfers', target: 'packages/transfers' },
  { source: 'scripts/workspaces', target: 'scripts/workspaces' },
  { source: 'scripts/postinstall', target: 'scripts/postinstall' },
  { source: 'package.json', target: 'package.json' },
  { source: 'yarn.lock', target: 'yarn.lock' },
  { source: 'app.json', target: 'app.json' },
  { source: 'vitest.config.ts', target: 'vitest.config.ts' },
  { source: 'LICENCE', target: 'licenses/Happier-LICENSE.txt' },
]);

const excludedDirectoryNames = new Set([
  '.git',
  '.cache',
  '.expo',
  '.project',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);

const excludedBasenames = new Set([
  '.easignore',
  'eas.json',
  'google-services.json',
  'GoogleService-Info.plist',
  'release-dev.sh',
  'release-production.sh',
]);

const excludedSecretExtensions = new Set([
  '.jks',
  '.keystore',
  '.p12',
  '.p8',
  '.pem',
]);

function toPosix(path) {
  return String(path).replaceAll('\\', '/').replace(/^\.\//, '');
}

function normalizeImportPath(path, label) {
  const value = toPosix(path).replace(/^\/+|\/+$/g, '');
  if (!value || isAbsolute(path) || value.split('/').includes('..')) {
    throw new Error(`Unsafe ${label} import path: ${path}`);
  }
  return value;
}

function isPathInside(path, root) {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(root);
  return absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}${sep}`);
}

export function isExcludedImportPath(path) {
  const normalized = toPosix(path);
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments.at(-1) ?? '';
  const lowerBasename = basename.toLowerCase();

  if (segments.some((segment) => excludedDirectoryNames.has(segment))) {
    return true;
  }
  if (segments.includes('.eas')) {
    return true;
  }
  if (basename === '.env' || basename.startsWith('.env.')) {
    return true;
  }
  if (excludedBasenames.has(basename)) {
    return true;
  }
  if ([...excludedSecretExtensions].some((extension) => lowerBasename.endsWith(extension))) {
    return true;
  }
  if (/^(?:secrets?|credentials?)(?:\.|$)/i.test(basename)) {
    return true;
  }
  if (normalized.startsWith('apps/ui/deploy/')) {
    return true;
  }
  if (normalized.startsWith('apps/ui/src-tauri/binaries/')) {
    return true;
  }
  if (normalized.startsWith('apps/ui/src-tauri/icons/android/')) {
    return true;
  }
  if (normalized.startsWith('apps/ui/src-tauri/icons/ios/')) {
    return true;
  }
  return false;
}

function gitCapture(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
    stdio: options.stdio,
  });
}

function inspectSourceRepository(sourceRoot) {
  const inside = gitCapture(sourceRoot, ['rev-parse', '--is-inside-work-tree']).trim();
  if (inside !== 'true') {
    throw new Error(`Happier source is not a Git worktree: ${sourceRoot}`);
  }
  const status = gitCapture(sourceRoot, ['status', '--short']).trim();
  if (status) {
    throw new Error(`Happier source has local changes; resolve them before importing:\n${status}`);
  }
  const origin = gitCapture(sourceRoot, ['remote', 'get-url', 'origin']).trim();
  if (!/^https:\/\/github\.com\/happier-dev\/happier(?:\.git)?\/?$/i.test(origin)) {
    throw new Error(`Unexpected Happier origin: ${origin}`);
  }
  const branch = gitCapture(sourceRoot, ['branch', '--show-current']).trim() || '(detached)';
  const commit = gitCapture(sourceRoot, ['rev-parse', 'HEAD']).trim();
  return { repository: origin, branch, commit };
}

function assertSourceIgnored({ sourceRoot, targetRoot }) {
  if (!isPathInside(sourceRoot, targetRoot)) {
    throw new Error(`Happier source must live inside the DevPilot repository: ${sourceRoot}`);
  }
  const sourceRelative = toPosix(relative(targetRoot, sourceRoot));
  try {
    gitCapture(targetRoot, ['check-ignore', '-q', '--', sourceRelative], { stdio: 'ignore' });
  } catch {
    throw new Error(`Happier source must be ignored by the DevPilot repository: ${sourceRelative}`);
  }
}

function parseTrackedFiles(sourceRoot, entries) {
  const normalizedEntries = entries.map((entry) => ({
    source: normalizeImportPath(entry.source, 'source'),
    target: normalizeImportPath(entry.target, 'target'),
  }));
  const sourcePaths = [...new Set(normalizedEntries.map((entry) => entry.source))];
  if (sourcePaths.length === 0) {
    return { files: [], excluded: [] };
  }

  const raw = gitCapture(sourceRoot, ['ls-files', '--stage', '-z', '--', ...sourcePaths]);
  const tracked = raw.split('\0').filter(Boolean);
  const filesByTarget = new Map();
  const excluded = [];

  for (const record of tracked) {
    const match = /^(\d+) ([0-9a-f]+) (\d+)\t(.+)$/.exec(record);
    if (!match) {
      throw new Error(`Unable to parse git ls-files record: ${record}`);
    }
    const [, mode, objectId, stage, rawSourcePath] = match;
    const sourcePath = toPosix(rawSourcePath);
    if (stage !== '0') {
      throw new Error(`Happier source contains an unresolved index stage: ${sourcePath}`);
    }
    const entry = normalizedEntries
      .filter((candidate) => sourcePath === candidate.source || sourcePath.startsWith(`${candidate.source}/`))
      .sort((left, right) => right.source.length - left.source.length)[0];
    if (!entry) {
      continue;
    }
    const suffix = sourcePath === entry.source ? '' : sourcePath.slice(entry.source.length + 1);
    const targetPath = suffix ? `${entry.target}/${suffix}` : entry.target;
    const reason = mode === '160000'
      ? 'gitlink'
      : isExcludedImportPath(sourcePath)
        ? 'excluded-path'
        : null;
    if (reason) {
      excluded.push({ source: sourcePath, target: targetPath, reason });
      continue;
    }
    const file = {
      source: sourcePath,
      target: targetPath,
      objectId,
      mode,
      executable: mode === '100755',
    };
    const existing = filesByTarget.get(targetPath);
    if (existing && existing.source !== sourcePath) {
      throw new Error(`Import allowlist maps multiple sources to ${targetPath}`);
    }
    filesByTarget.set(targetPath, file);
  }

  return {
    files: [...filesByTarget.values()].sort((left, right) => left.target.localeCompare(right.target)),
    excluded: excluded.sort((left, right) => left.source.localeCompare(right.source)),
  };
}

async function readState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed && Array.isArray(parsed.files) ? parsed : null;
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Unable to read prior Happier import state at ${path}: ${error.message}`);
  }
}

async function hashFileAsGitBlob(path) {
  const contents = await readFile(path);
  return createHash('sha1')
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest('hex');
}

async function addSourceContentObjectIds(files, sourceRoot, concurrency = 32) {
  const enriched = new Array(files.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), files.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= files.length) {
        return;
      }
      const file = files[index];
      const contentObjectId = file.mode === '120000'
        ? file.objectId
        : await hashFileAsGitBlob(resolve(sourceRoot, file.source));
      enriched[index] = { ...file, contentObjectId };
    }
  });
  await Promise.all(workers);
  return enriched;
}

async function classifyFiles({ files, targetRoot, priorState }, concurrency = 32) {
  const priorByTarget = new Map((priorState?.files ?? []).map((file) => [file.target, file]));
  const currentTargets = new Set(files.map((file) => file.target));
  const safeAdds = [];
  const safeChanges = [];
  const unchanged = [];
  const localDifferences = [];
  const conflicts = [];

  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), files.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= files.length) {
        return;
      }
      const file = files[index];
      const targetPath = resolve(targetRoot, file.target);
      if (!isPathInside(targetPath, targetRoot)) {
        throw new Error(`Import target escapes the DevPilot repository: ${file.target}`);
      }
      let targetStat;
      try {
        targetStat = await lstat(targetPath);
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') {
          safeAdds.push(file);
          continue;
        }
        throw error;
      }
      if (!targetStat.isFile()) {
        const conflict = { ...file, reason: 'target-is-not-a-file' };
        localDifferences.push(conflict);
        conflicts.push(conflict);
        continue;
      }
      const targetObjectId = await hashFileAsGitBlob(targetPath);
      if (targetObjectId === file.contentObjectId) {
        unchanged.push(file);
        continue;
      }
      const prior = priorByTarget.get(file.target);
      if (
        (prior?.contentObjectId && prior.contentObjectId === targetObjectId)
        || (prior?.objectId && prior.objectId === targetObjectId)
      ) {
        safeChanges.push(file);
        continue;
      }
      const conflict = {
        ...file,
        reason: prior ? 'local-file-changed' : 'pre-existing-target',
        targetObjectId,
        priorObjectId: prior?.objectId ?? null,
      };
      localDifferences.push(conflict);
      conflicts.push(conflict);
    }
  });
  await Promise.all(workers);

  for (const items of [safeAdds, safeChanges, unchanged, localDifferences, conflicts]) {
    items.sort((left, right) => left.target.localeCompare(right.target));
  }

  const upstreamDeleted = (priorState?.files ?? [])
    .filter((file) => !currentTargets.has(file.target))
    .sort((left, right) => left.target.localeCompare(right.target));

  return { safeAdds, safeChanges, unchanged, localDifferences, conflicts, upstreamDeleted };
}

async function copyImportedFile({ file, sourceRoot, targetRoot }) {
  const sourcePath = resolve(sourceRoot, file.source);
  const targetPath = resolve(targetRoot, file.target);
  if (!isPathInside(sourcePath, sourceRoot) || !isPathInside(targetPath, targetRoot)) {
    throw new Error(`Refusing unsafe import mapping: ${file.source} -> ${file.target}`);
  }
  await mkdir(dirname(targetPath), { recursive: true });
  if (file.mode === '120000') {
    const linkContents = gitCapture(sourceRoot, ['show', `HEAD:${file.source}`], { encoding: null });
    await writeFile(targetPath, linkContents);
  } else {
    await copyFile(sourcePath, targetPath);
  }
  if (process.platform !== 'win32') {
    await chmod(targetPath, file.executable ? 0o755 : 0o644).catch(() => {});
  }
}

async function copyImportedFiles(files, options, concurrency = 32) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), files.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= files.length) {
        return;
      }
      await copyImportedFile({ file: files[index], ...options });
    }
  });
  await Promise.all(workers);
}

function displayList(items, selector = (item) => item.target, limit = 200) {
  if (items.length === 0) {
    return '- None';
  }
  const lines = items.slice(0, limit).map((item) => `- \`${selector(item)}\``);
  if (items.length > limit) {
    lines.push(`- … ${items.length - limit} additional files recorded in the state manifest`);
  }
  return lines.join('\n');
}

function renderReport(result) {
  return `# Happier Desktop Import Report

Generated: ${result.generatedAt}

## Source

| Field | Value |
| --- | --- |
| Repository | \`${result.source.repository}\` |
| Branch | \`${result.source.branch}\` |
| Commit | \`${result.source.commit}\` |
| Mode | ${result.dryRun ? 'Dry run' : 'Import'} |

## Summary

| Category | Count |
| --- | ---: |
| Tracked allowlisted files | ${result.files.length} |
| Safe additions | ${result.safeAdds.length} |
| Safe upstream changes | ${result.safeChanges.length} |
| Unchanged files | ${result.unchanged.length} |
| Upstream deletions (report only) | ${result.upstreamDeleted.length} |
| Local files that differ | ${result.localDifferences.length} |
| Unsafe conflicts | ${result.conflicts.length} |
| Excluded or rejected files | ${result.excluded.length} |

## Upstream-added files

${displayList(result.safeAdds)}

## Upstream-changed files safe to import

${displayList(result.safeChanges)}

## Upstream-deleted files requiring manual review

${displayList(result.upstreamDeleted)}

The importer never deletes these targets automatically.

## Local files that differ

${displayList(result.localDifferences, (item) => `${item.target} (${item.reason})`)}

## Potential conflicts

${displayList(result.conflicts, (item) => `${item.target} (${item.reason})`)}

## Excluded or rejected source files

${displayList(result.excluded, (item) => `${item.source} (${item.reason})`)}

## Manual review requirements

${result.conflicts.length > 0
    ? '- Resolve every potential conflict before running a real import. No allowlisted production file was overwritten.'
    : '- Review reported upstream deletions before removing any tracked DevPilot file.\n- Review excluded mobile, hosted-service, credential, and generated paths when the upstream allowlist changes.'}
`;
}

async function writeImportMetadata({ result, targetRoot, statePath, reportPath }) {
  const state = {
    version: 1,
    importedAt: result.generatedAt,
    source: result.source,
    entries: result.entries,
    files: result.files,
  };
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderReport(result), 'utf8');
  return { statePath: relative(targetRoot, statePath), reportPath: relative(targetRoot, reportPath) };
}

export class ImportConflictError extends Error {
  constructor(conflicts, reportPath = null) {
    super(`Happier import stopped because ${conflicts.length} unsafe conflict(s) require manual review.`);
    this.name = 'ImportConflictError';
    this.conflicts = conflicts;
    this.reportPath = reportPath;
  }
}

export async function runImport({
  targetRoot = defaultTargetRoot,
  sourceRoot = join(targetRoot, 'happier'),
  dryRun = false,
  entries = importEntries,
  statePath = join(targetRoot, 'docs', 'happier-import-state.json'),
  reportPath = join(targetRoot, 'docs', 'HAPPIER_IMPORT_REPORT.md'),
} = {}) {
  const resolvedTargetRoot = resolve(targetRoot);
  const resolvedSourceRoot = resolve(sourceRoot);
  const resolvedStatePath = resolve(statePath);
  const resolvedReportPath = resolve(reportPath);
  if (!isPathInside(resolvedStatePath, resolvedTargetRoot) || !isPathInside(resolvedReportPath, resolvedTargetRoot)) {
    throw new Error('Import state and report paths must remain inside the DevPilot repository.');
  }

  assertSourceIgnored({ sourceRoot: resolvedSourceRoot, targetRoot: resolvedTargetRoot });
  const source = inspectSourceRepository(resolvedSourceRoot);
  const normalizedEntries = entries.map((entry) => ({
    source: normalizeImportPath(entry.source, 'source'),
    target: normalizeImportPath(entry.target, 'target'),
  }));
  const tracked = parseTrackedFiles(resolvedSourceRoot, normalizedEntries);
  const files = await addSourceContentObjectIds(tracked.files, resolvedSourceRoot);
  const { excluded } = tracked;
  const priorState = await readState(resolvedStatePath);
  const classification = await classifyFiles({ files, targetRoot: resolvedTargetRoot, priorState });
  const result = {
    generatedAt: new Date().toISOString(),
    dryRun,
    source,
    entries: normalizedEntries,
    files,
    excluded,
    ...classification,
  };

  if (dryRun) {
    return result;
  }
  if (result.conflicts.length > 0) {
    await mkdir(dirname(resolvedReportPath), { recursive: true });
    await writeFile(resolvedReportPath, renderReport(result), 'utf8');
    throw new ImportConflictError(result.conflicts, resolvedReportPath);
  }

  await copyImportedFiles(
    [...result.safeAdds, ...result.safeChanges],
    { sourceRoot: resolvedSourceRoot, targetRoot: resolvedTargetRoot },
  );
  result.metadata = await writeImportMetadata({
    result,
    targetRoot: resolvedTargetRoot,
    statePath: resolvedStatePath,
    reportPath: resolvedReportPath,
  });
  return result;
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--source' || arg === '--target') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a path`);
      options[arg === '--source' ? 'sourceRoot' : 'targetRoot'] = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--source=')) {
      options.sourceRoot = resolve(arg.slice('--source='.length));
      continue;
    }
    if (arg.startsWith('--target=')) {
      options.targetRoot = resolve(arg.slice('--target='.length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.targetRoot && !options.sourceRoot) {
    options.sourceRoot = join(options.targetRoot, 'happier');
  }
  return options;
}

async function main() {
  const result = await runImport(parseCliArgs(process.argv.slice(2)));
  const summary = {
    mode: result.dryRun ? 'dry-run' : 'import',
    source: result.source,
    tracked: result.files.length,
    safeAdds: result.safeAdds.length,
    safeChanges: result.safeChanges.length,
    unchanged: result.unchanged.length,
    upstreamDeleted: result.upstreamDeleted.length,
    conflicts: result.conflicts.length,
    excluded: result.excluded.length,
    metadata: result.metadata ?? null,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    const suffix = error instanceof ImportConflictError && error.reportPath
      ? ` Report: ${error.reportPath}`
      : '';
    process.stderr.write(`${error.message}${suffix}\n`);
    process.exitCode = 1;
  });
}
