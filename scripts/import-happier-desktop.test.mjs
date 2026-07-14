import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  ImportConflictError,
  isExcludedImportPath,
  runImport,
} from './import-happier-desktop.mjs';

const temporaryRoots = [];

async function write(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, 'utf8');
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'devpilot-happier-import-'));
  temporaryRoots.push(root);
  const targetRoot = join(root, 'DevPilot');
  const sourceRoot = join(targetRoot, 'happier');
  await mkdir(sourceRoot, { recursive: true });
  await write(join(targetRoot, '.gitignore'), '/happier/\n');

  git(targetRoot, 'init', '--quiet');
  git(targetRoot, 'config', 'user.name', 'DevPilot Test');
  git(targetRoot, 'config', 'user.email', 'devpilot@example.test');

  git(sourceRoot, 'init', '--quiet');
  git(sourceRoot, 'config', 'user.name', 'Happier Test');
  git(sourceRoot, 'config', 'user.email', 'happier@example.test');
  git(sourceRoot, 'remote', 'add', 'origin', 'https://github.com/happier-dev/happier.git');

  await write(join(sourceRoot, 'apps/ui/sources/main.ts'), 'export const value = 1;\n');
  await write(join(sourceRoot, 'apps/ui/.env.local'), 'SECRET=do-not-copy\n');
  await write(join(sourceRoot, 'apps/ui/eas.json'), '{"build":{}}\n');
  await write(join(sourceRoot, 'apps/ui/dist/generated.js'), 'generated\n');
  await write(join(sourceRoot, 'apps/server/server.ts'), 'excluded\n');
  await write(join(sourceRoot, 'packages/protocol/src/index.ts'), 'export type Protocol = string;\n');
  await write(join(sourceRoot, 'scripts/tool.sh'), '#!/bin/sh\nexit 0\n');
  await chmod(join(sourceRoot, 'scripts/tool.sh'), 0o755);
  git(sourceRoot, 'add', '.');
  git(sourceRoot, 'update-index', '--chmod=+x', 'scripts/tool.sh');
  git(sourceRoot, 'commit', '--quiet', '-m', 'fixture');
  git(sourceRoot, 'branch', '-M', 'dev');

  return { root, targetRoot, sourceRoot };
}

test.after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

test('dry-run imports only allowlisted, safe files without writing targets', async () => {
  const { targetRoot, sourceRoot } = await createFixture();
  const result = await runImport({
    targetRoot,
    sourceRoot,
    dryRun: true,
    entries: [
      { source: 'apps/ui', target: 'apps/ui' },
      { source: 'packages/protocol', target: 'packages/protocol' },
      { source: 'scripts/tool.sh', target: 'scripts/tool.sh' },
    ],
  });

  assert.equal(result.source.branch, 'dev');
  assert.match(result.source.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(
    result.safeAdds.map((item) => item.target).sort(),
    ['apps/ui/sources/main.ts', 'packages/protocol/src/index.ts', 'scripts/tool.sh'],
  );
  assert.ok(result.excluded.some((item) => item.source === 'apps/ui/.env.local'));
  assert.ok(result.excluded.some((item) => item.source === 'apps/ui/eas.json'));
  assert.ok(result.excluded.some((item) => item.source === 'apps/ui/dist/generated.js'));
  assert.equal(result.files.find((item) => item.target === 'scripts/tool.sh')?.executable, true);
  await assert.rejects(stat(join(targetRoot, 'apps/ui/sources/main.ts')), { code: 'ENOENT' });
});

test('real import copies safe files and refuses to overwrite a local change', async () => {
  const { targetRoot, sourceRoot } = await createFixture();
  const entries = [{ source: 'apps/ui', target: 'apps/ui' }];
  await runImport({ targetRoot, sourceRoot, entries });
  assert.equal(await readFile(join(targetRoot, 'apps/ui/sources/main.ts'), 'utf8'), 'export const value = 1;\n');

  await write(join(targetRoot, 'apps/ui/sources/main.ts'), 'export const local = true;\n');
  await write(join(sourceRoot, 'apps/ui/sources/main.ts'), 'export const value = 2;\n');
  git(sourceRoot, 'add', 'apps/ui/sources/main.ts');
  git(sourceRoot, 'commit', '--quiet', '-m', 'upstream change');

  await assert.rejects(
    runImport({ targetRoot, sourceRoot, entries }),
    (error) => error instanceof ImportConflictError && error.conflicts.length === 1,
  );
  assert.equal(await readFile(join(targetRoot, 'apps/ui/sources/main.ts'), 'utf8'), 'export const local = true;\n');
});

test('upstream-owned files update safely when the local imported copy is unchanged', async () => {
  const { targetRoot, sourceRoot } = await createFixture();
  const entries = [{ source: 'packages/protocol', target: 'packages/protocol' }];
  await runImport({ targetRoot, sourceRoot, entries });

  await write(join(sourceRoot, 'packages/protocol/src/index.ts'), 'export type Protocol = number;\n');
  git(sourceRoot, 'add', 'packages/protocol/src/index.ts');
  git(sourceRoot, 'commit', '--quiet', '-m', 'protocol update');

  const result = await runImport({ targetRoot, sourceRoot, entries });
  assert.deepEqual(result.safeChanges.map((item) => item.target), ['packages/protocol/src/index.ts']);
  assert.equal(
    await readFile(join(targetRoot, 'packages/protocol/src/index.ts'), 'utf8'),
    'export type Protocol = number;\n',
  );
});

test('a clean CRLF checkout can be imported repeatedly without false conflicts', async () => {
  const { targetRoot, sourceRoot } = await createFixture();
  const entries = [{ source: 'apps/ui', target: 'apps/ui' }];
  git(sourceRoot, 'config', 'core.autocrlf', 'true');
  await write(join(sourceRoot, 'apps/ui/sources/main.ts'), 'export const value = 1;\r\n');
  git(sourceRoot, 'add', 'apps/ui/sources/main.ts');
  assert.equal(git(sourceRoot, 'status', '--short'), '');

  await runImport({ targetRoot, sourceRoot, entries });
  const second = await runImport({ targetRoot, sourceRoot, entries });

  assert.equal(second.conflicts.length, 0);
  assert.deepEqual(second.unchanged.map((item) => item.target), ['apps/ui/sources/main.ts']);
});

test('upstream deletions are reported and never delete the imported target', async () => {
  const { targetRoot, sourceRoot } = await createFixture();
  const entries = [{ source: 'packages/protocol', target: 'packages/protocol' }];
  await runImport({ targetRoot, sourceRoot, entries });
  git(sourceRoot, 'rm', 'packages/protocol/src/index.ts');
  git(sourceRoot, 'commit', '--quiet', '-m', 'remove protocol file');

  const result = await runImport({ targetRoot, sourceRoot, entries });
  assert.deepEqual(result.upstreamDeleted.map((item) => item.target), ['packages/protocol/src/index.ts']);
  assert.equal(
    await readFile(join(targetRoot, 'packages/protocol/src/index.ts'), 'utf8'),
    'export type Protocol = string;\n',
  );
});

test('source must be ignored and exclusion rules reject repository and secret paths', async () => {
  const { targetRoot, sourceRoot } = await createFixture();
  await write(join(targetRoot, '.gitignore'), 'node_modules/\n');
  await assert.rejects(runImport({ targetRoot, sourceRoot, dryRun: true, entries: [] }), /must be ignored/i);

  assert.equal(isExcludedImportPath('apps/ui/.git/config'), true);
  assert.equal(isExcludedImportPath('apps/ui/.vscode/launch.json'), true);
  assert.equal(isExcludedImportPath('apps/ui/node_modules/react/index.js'), true);
  assert.equal(isExcludedImportPath('apps/ui/.env.production'), true);
  assert.equal(isExcludedImportPath('apps/ui/sources/app.ts'), false);
});
