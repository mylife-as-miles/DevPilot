import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
    ConversationState,
    DesktopClient,
    DesktopUiState,
    DevPilotConversation,
    DevPilotProject,
    LocalGitChanges,
    RuntimeModel,
} from '@devpilot/desktop/client';

vi.mock('@devpilot/desktop/client', () => ({
    getDesktopClient: () => (globalThis as typeof globalThis & { __DEVPILOT_ELECTRON__?: DesktopClient }).__DEVPILOT_ELECTRON__ ?? null,
}));

import {
    cancelSelectedDevPilotConversation,
    ensureDevPilotDesktopInitialized,
    getDevPilotDesktopState,
    openDevPilotProjectFolder,
    resetDevPilotDesktopStateForTests,
    sendDevPilotConversationMessage,
} from './store';

const project: DevPilotProject = {
    projectId: 'project-coal-city',
    name: 'Coal City',
    path: 'C:\\Users\\MILES\\Documents\\Coal City',
    createdAt: 1_000,
    lastOpenedAt: 1_000,
};

const model: RuntimeModel = {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
};

const emptyChanges: LocalGitChanges = {
    available: true,
    repository: project.path,
    branch: 'main',
    dirty: false,
    files: [],
    issue: null,
};

const defaultUiState: DesktopUiState = {
    version: 1,
    selectedProjectId: null,
    selectedConversationId: null,
    lastModel: null,
    lastReasoningEffort: 'high',
    lastSandbox: 'workspace-write',
    migrations: {},
};

function conversation(overrides: Partial<DevPilotConversation> = {}): DevPilotConversation {
    return {
        conversationId: 'conversation-1',
        projectId: project.projectId,
        title: 'New conversation',
        state: 'idle',
        createdAt: 2_000,
        updatedAt: 2_000,
        provider: 'codex',
        model: model.id,
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        pinned: false,
        archived: false,
        activeRunId: null,
        lastError: null,
        ...overrides,
    };
}

function makeDesktopClient(overrides: Partial<DesktopClient> = {}): DesktopClient {
    const base: DesktopClient = {
        getRuntimeStatus: vi.fn(async () => ({ ready: true, command: 'devpilot', source: 'bundled-runtime' as const, version: 'test', issue: null })),
        getCodexAuthStatus: vi.fn(async () => ({ runtimeReady: true, signedIn: true, message: 'signed in' })),
        startCodexLogin: vi.fn(async () => ({ pid: 1, alreadyRunning: false })),
        selectProjectFolder: vi.fn(async () => null),
        openProject: vi.fn(async (projectPath) => ({
            project: { ...project, path: projectPath },
            preflight: { path: projectPath, readable: true, isGitRepository: true, branch: 'main', dirty: false, gitAvailable: true },
        })),
        listProjects: vi.fn(async () => ({ projects: [] })),
        getProject: vi.fn(async () => ({ project })),
        removeProject: vi.fn(async (projectId) => ({ removed: true, projectId })),
        preflightProject: vi.fn(async (projectId) => ({
            preflight: { path: projectId, readable: true, isGitRepository: true, branch: 'main', dirty: false, gitAvailable: true },
        })),
        listModels: vi.fn(async () => ({ provider: 'codex' as const, models: [model] })),
        createConversation: vi.fn(async (input) => ({
            conversation: conversation({
                projectId: input.projectId ?? project.projectId,
                model: input.model ?? model.id,
                reasoningEffort: input.reasoningEffort ?? 'high',
                sandbox: input.sandbox ?? 'workspace-write',
            }),
        })),
        listConversations: vi.fn(async (projectId) => ({ projectId, conversations: [] })),
        openConversation: vi.fn(async (projectId, conversationId) => ({
            conversation: conversation({ projectId, conversationId }),
            messages: [],
        })),
        renameConversation: vi.fn(async (input) => ({ conversation: conversation({ ...input }) })),
        pinConversation: vi.fn(async (input) => ({ conversation: conversation({ ...input }) })),
        archiveConversation: vi.fn(async (input) => ({ conversation: conversation({ ...input, archived: input.archived ?? true }) })),
        deleteConversation: vi.fn(async (input) => ({ conversationId: input.conversationId, deleted: true })),
        sendConversationMessage: vi.fn(async () => ({ turnId: 'turn-1', runId: 'run-1' })),
        resumeConversation: vi.fn(async () => ({ turnId: 'turn-1', runId: 'run-1' })),
        cancelConversationRun: vi.fn(async (input) => ({ conversationId: input.conversationId, runId: 'run-1', state: 'cancelled' as ConversationState })),
        getConversationRunStatus: vi.fn(async (input) => ({ conversationId: input.conversationId, runId: null, state: 'idle' as ConversationState, running: false })),
        listChanges: vi.fn(async () => ({ changes: emptyChanges })),
        readChangeDiff: vi.fn(async () => ({ diff: { scope: 'combined' as const, path: null, diff: '', truncated: false } })),
        getUiState: vi.fn(async () => defaultUiState),
        saveUiState: vi.fn(async (patch) => ({ ...defaultUiState, ...patch })),
        getRuntimeLogs: vi.fn(async () => []),
        clearRuntimeLogs: vi.fn(async () => undefined),
        openExternal: vi.fn(async () => undefined),
        onRuntimeEvent: vi.fn(() => () => undefined),
        onRuntimeLog: vi.fn(() => () => undefined),
        onUiState: vi.fn(() => () => undefined),
    };
    return { ...base, ...overrides };
}

function installDesktopClient(client: DesktopClient): void {
    (globalThis as typeof globalThis & { __DEVPILOT_ELECTRON__?: DesktopClient }).__DEVPILOT_ELECTRON__ = client;
}

afterEach(() => {
    resetDevPilotDesktopStateForTests();
    delete (globalThis as typeof globalThis & { __DEVPILOT_ELECTRON__?: DesktopClient }).__DEVPILOT_ELECTRON__;
});

describe('DevPilot desktop store', () => {
    it('resolves empty project and conversation loading without hosted server state', async () => {
        const client = makeDesktopClient();
        installDesktopClient(client);

        await ensureDevPilotDesktopInitialized(true);

        expect(client.listProjects).toHaveBeenCalledTimes(1);
        expect(client.listModels).toHaveBeenCalledTimes(1);
        expect(client.listConversations).not.toHaveBeenCalled();
        expect(client.openConversation).not.toHaveBeenCalled();
        expect(getDevPilotDesktopState()).toMatchObject({
            initialized: true,
            selectedProjectId: null,
            selectedConversationId: null,
            loading: { projects: false, conversations: false },
        });
    });

    it('populates models.list and selects reasoning from the chosen model capability', async () => {
        const client = makeDesktopClient({
            listModels: vi.fn(async () => ({ provider: 'codex' as const, models: [model] })),
            getUiState: vi.fn(async () => ({
                ...defaultUiState,
                lastReasoningEffort: 'ultra',
            })),
        });
        installDesktopClient(client);

        await ensureDevPilotDesktopInitialized(true);

        expect(getDevPilotDesktopState()).toMatchObject({
            models: [model],
            selectedModel: model.id,
            reasoningEffort: model.defaultReasoningEffort,
        });
    });

    it('opens a folder through selectProjectFolder then project.open without creating a conversation', async () => {
        const client = makeDesktopClient({
            selectProjectFolder: vi.fn(async () => project.path),
        });
        installDesktopClient(client);

        await openDevPilotProjectFolder();

        expect(client.selectProjectFolder).toHaveBeenCalledTimes(1);
        expect(client.openProject).toHaveBeenCalledWith(project.path);
        expect(vi.mocked(client.selectProjectFolder).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(client.openProject).mock.invocationCallOrder[0]!);
        expect(client.createConversation).not.toHaveBeenCalled();
        expect(getDevPilotDesktopState()).toMatchObject({
            selectedProjectId: project.projectId,
            selectedConversationId: null,
            loading: { projects: false, conversations: false },
        });
    });

    it('creates one conversation on first send and sends follow-ups to the same conversation', async () => {
        const firstConversation = conversation({ sandbox: 'full-access', reasoningEffort: 'high' });
        const client = makeDesktopClient({
            createConversation: vi.fn(async (input) => ({ conversation: { ...firstConversation, ...input, conversationId: firstConversation.conversationId } })),
            openConversation: vi.fn(async (projectId, conversationId) => ({
                conversation: conversation({ projectId, conversationId, sandbox: 'full-access', reasoningEffort: 'high' }),
                messages: [],
            })),
        });
        installDesktopClient(client);
        resetDevPilotDesktopStateForTests({
            initialized: true,
            projects: { [project.projectId]: project },
            selectedProjectId: project.projectId,
            models: [model],
            selectedModel: model.id,
            reasoningEffort: 'high',
            sandboxMode: 'full-access',
        });

        await sendDevPilotConversationMessage('first prompt');
        await sendDevPilotConversationMessage('follow up');

        expect(client.createConversation).toHaveBeenCalledTimes(1);
        expect(client.createConversation).toHaveBeenCalledWith({
            projectId: project.projectId,
            title: 'New conversation',
            model: model.id,
            reasoningEffort: 'high',
            sandbox: 'full-access',
        });
        expect(client.sendConversationMessage).toHaveBeenCalledTimes(2);
        expect(vi.mocked(client.sendConversationMessage).mock.calls.map(([input]) => input.conversationId)).toEqual([
            firstConversation.conversationId,
            firstConversation.conversationId,
        ]);
    });

    it('calls run.cancel for the selected local conversation', async () => {
        const client = makeDesktopClient();
        installDesktopClient(client);
        resetDevPilotDesktopStateForTests({
            initialized: true,
            projects: { [project.projectId]: project },
            conversations: {
                [conversation().conversationId]: conversation({ state: 'working', activeRunId: 'run-1' }),
            },
            selectedProjectId: project.projectId,
            selectedConversationId: conversation().conversationId,
            models: [model],
            selectedModel: model.id,
        });

        await cancelSelectedDevPilotConversation();

        expect(client.cancelConversationRun).toHaveBeenCalledWith({
            projectId: project.projectId,
            conversationId: conversation().conversationId,
        });
    });
});
