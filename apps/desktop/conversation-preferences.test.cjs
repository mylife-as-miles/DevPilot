const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const test = require('node:test');

const { migrateLegacyWorkspace, readDesktopState, writeDesktopState } = require('./conversation-preferences.cjs');

test('migrates the legacy task store once, preserving a backup and only UI selection state', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'devpilot-desktop-preferences-'));
  const legacyPath = join(directory, 'devpilot-workspace.json');
  const statePath = join(directory, 'desktop-state.json');
  const workspace = { selectedProjectId: 'old-project', selectedTaskId: 'old-task', projects: [{ path: 'C:/work/project' }] };
  writeFileSync(legacyPath, JSON.stringify(workspace), 'utf8');
  try {
    let imports = 0;
    const migrated = await migrateLegacyWorkspace({
      legacyPath,
      statePath,
      now: () => 123,
      importWorkspace: async (input) => {
        imports += 1;
        assert.deepEqual(input, workspace);
        return { importedConversations: 1, selectedProjectId: 'project-new', selectedConversationId: 'conversation-new' };
      },
    });
    assert.equal(imports, 1);
    assert.equal(migrated.selectedProjectId, 'project-new');
    assert.equal(migrated.selectedConversationId, 'conversation-new');
    assert.equal(existsSync(`${legacyPath}.v1.backup`), true);
    await migrateLegacyWorkspace({ legacyPath, statePath, importWorkspace: async () => { throw new Error('must not import twice'); } });
    assert.equal(readDesktopState(statePath).migrations.workspaceV1.status, 'complete');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('normalizes UI preferences without storing conversation data', () => {
  const state = writeDesktopState(join(tmpdir(), 'devpilot-state-normalize.json'), {
    selectedProjectId: 'project-a',
    selectedConversationId: 'conversation-a',
    lastModel: 'codex-model',
    lastSandbox: 'full-access',
    migrations: { workspaceV1: { status: 'complete' } },
    projects: ['must-not-be-persisted'],
  });
  assert.deepEqual(Object.keys(state).sort(), ['lastModel', 'lastReasoningEffort', 'lastSandbox', 'migrations', 'selectedConversationId', 'selectedProjectId', 'version']);
});
