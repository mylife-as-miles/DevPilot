const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const UI_STATE_VERSION = 1;

function emptyDesktopState() {
  return {
    version: UI_STATE_VERSION,
    selectedProjectId: null,
    selectedConversationId: null,
    lastModel: null,
    lastReasoningEffort: 'high',
    lastSandbox: 'workspace-write',
    migrations: {},
  };
}

function normalizeDesktopState(value) {
  const state = emptyDesktopState();
  if (!value || typeof value !== 'object') return state;
  state.selectedProjectId = optionalString(value.selectedProjectId);
  state.selectedConversationId = optionalString(value.selectedConversationId);
  state.lastModel = optionalString(value.lastModel);
  state.lastReasoningEffort = ['low', 'medium', 'high', 'extra-high'].includes(value.lastReasoningEffort)
    ? value.lastReasoningEffort : 'high';
  state.lastSandbox = ['read-only', 'workspace-write', 'full-access'].includes(value.lastSandbox)
    ? value.lastSandbox : 'workspace-write';
  state.migrations = value.migrations && typeof value.migrations === 'object' && !Array.isArray(value.migrations)
    ? { ...value.migrations } : {};
  return state;
}

function readDesktopState(statePath) {
  try {
    return normalizeDesktopState(JSON.parse(readFileSync(statePath, 'utf8')));
  } catch {
    return emptyDesktopState();
  }
}

function writeDesktopState(statePath, value) {
  const state = normalizeDesktopState(value);
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
  return state;
}

function migrateLegacyWorkspace({ legacyPath, statePath, importWorkspace, now = Date.now }) {
  const current = readDesktopState(statePath);
  if (current.migrations.workspaceV1?.status === 'complete') return Promise.resolve(current);
  if (!existsSync(legacyPath)) {
    current.migrations.workspaceV1 = { status: 'complete', completedAt: now(), importedConversations: 0 };
    return Promise.resolve(writeDesktopState(statePath, current));
  }
  let workspace;
  try {
    workspace = JSON.parse(readFileSync(legacyPath, 'utf8'));
  } catch {
    current.migrations.workspaceV1 = { status: 'skipped', completedAt: now(), reason: 'invalid_legacy_store' };
    return Promise.resolve(writeDesktopState(statePath, current));
  }
  return Promise.resolve(importWorkspace(workspace)).then((result) => {
    const backupPath = `${legacyPath}.v1.backup`;
    if (!existsSync(backupPath)) copyFileSync(legacyPath, backupPath);
    current.selectedProjectId = optionalString(result?.selectedProjectId) || current.selectedProjectId;
    current.selectedConversationId = optionalString(result?.selectedConversationId) || current.selectedConversationId;
    current.migrations.workspaceV1 = {
      status: 'complete',
      completedAt: now(),
      backupPath,
      importedConversations: Number.isFinite(result?.importedConversations) ? result.importedConversations : 0,
    };
    return writeDesktopState(statePath, current);
  });
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

module.exports = { emptyDesktopState, migrateLegacyWorkspace, normalizeDesktopState, readDesktopState, writeDesktopState };
