import type {
    ConversationMessage,
    ConversationState,
    DesktopUiState,
    DevPilotConversation,
    DevPilotProject,
    LocalGitChanges,
    ReviewScope,
    RuntimeEvent,
    RuntimeModel,
} from '@devpilot/desktop/client';

import { getRequiredDevPilotDesktopClient, readDevPilotDesktopClient, withDevPilotTimeout } from './client';
import { normalizeDevPilotRuntimeEvent } from './events';
import { isDevPilotAttentionState, isDevPilotWorkingState, normalizeDevPilotSandboxMode } from './status';
import type { DevPilotDesktopState, DevPilotDiff, DevPilotLoadingState, DevPilotRuntimeActivity, SandboxMode } from './types';

type Listener = () => void;
type MutableState = DevPilotDesktopState;
type DevPilotDesktopStatePatch = Omit<Partial<DevPilotDesktopState>, 'loading'> & Readonly<{
    loading?: Partial<DevPilotLoadingState>;
}>;

const DEFAULT_LOADING = Object.freeze({
    projects: false,
    conversations: false,
    conversation: false,
    review: false,
});

const INITIAL_STATE: DevPilotDesktopState = Object.freeze({
    initialized: false,
    authenticated: false,
    runtimeReady: false,
    projects: Object.freeze({}),
    conversations: Object.freeze({}),
    messagesByConversation: Object.freeze({}),
    eventsByConversation: Object.freeze({}),
    selectedProjectId: null,
    selectedConversationId: null,
    models: Object.freeze([]),
    selectedModel: null,
    reasoningEffort: 'high',
    sandboxMode: 'workspace-write',
    changesByProject: Object.freeze({}),
    selectedChangedFile: null,
    selectedDiff: null,
    diffByProjectPath: Object.freeze({}),
    loading: DEFAULT_LOADING,
    error: null,
});

let state: MutableState = INITIAL_STATE;
const listeners = new Set<Listener>();
let initializePromise: Promise<void> | null = null;
let unsubscribeRuntimeEvents: (() => void) | null = null;
let transientMessageSeq = 0;

function emit(): void {
    for (const listener of Array.from(listeners)) {
        listener();
    }
}

function patchState(patch: DevPilotDesktopStatePatch): void {
    state = {
        ...state,
        ...patch,
        loading: patch.loading ? { ...state.loading, ...patch.loading } : state.loading,
    };
    emit();
}

function replaceProjects(projects: readonly DevPilotProject[]): Record<string, DevPilotProject> {
    const next: Record<string, DevPilotProject> = {};
    for (const project of projects) {
        if (project?.projectId) next[project.projectId] = project;
    }
    return next;
}

function mergeProjects(projects: readonly DevPilotProject[]): Record<string, DevPilotProject> {
    return { ...state.projects, ...replaceProjects(projects) };
}

function mergeConversations(conversations: readonly DevPilotConversation[]): Record<string, DevPilotConversation> {
    const next = { ...state.conversations };
    for (const conversation of conversations) {
        if (conversation?.conversationId) next[conversation.conversationId] = conversation;
    }
    return next;
}

function normalizeMessages(messages: readonly ConversationMessage[]): readonly ConversationMessage[] {
    const byId = new Map<string, ConversationMessage>();
    for (const message of messages) {
        if (!message?.messageId) continue;
        byId.set(message.messageId, message);
    }
    return [...byId.values()].sort((a, b) => normalizeTimestamp(a.createdAt) - normalizeTimestamp(b.createdAt));
}

function mergeConversationMessages(
    conversationId: string,
    messages: readonly ConversationMessage[],
): Record<string, readonly ConversationMessage[]> {
    const current = state.messagesByConversation[conversationId] ?? [];
    return {
        ...state.messagesByConversation,
        [conversationId]: normalizeMessages([...current, ...messages]),
    };
}

function setConversationMessages(
    conversationId: string,
    messages: readonly ConversationMessage[],
): Record<string, readonly ConversationMessage[]> {
    return {
        ...state.messagesByConversation,
        [conversationId]: normalizeMessages(messages),
    };
}

function normalizeTimestamp(value: unknown): number {
    const raw = typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
    return raw > 0 && raw < 10_000_000_000 ? raw * 1000 : raw;
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readConversationFromEvent(frame: RuntimeEvent): DevPilotConversation | null {
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const direct = data as Partial<DevPilotConversation>;
    const nested = (data.conversation && typeof data.conversation === 'object'
        ? data.conversation
        : null) as Partial<DevPilotConversation> | null;
    const candidate = nested ?? direct;
    const conversationId = readString(candidate.conversationId);
    const projectId = readString(candidate.projectId);
    if (!conversationId || !projectId) return null;
    return {
        conversationId,
        projectId,
        title: readString(candidate.title) ?? 'New conversation',
        state: normalizeConversationState(candidate.state),
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
        updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : Date.now(),
        provider: 'codex',
        model: readString(candidate.model) ?? state.selectedModel ?? 'codex',
        reasoningEffort: readString(candidate.reasoningEffort) ?? state.reasoningEffort,
        sandbox: normalizeDevPilotSandboxMode(candidate.sandbox),
        pinned: candidate.pinned === true,
        archived: candidate.archived === true,
        activeRunId: readString(candidate.activeRunId),
        lastError: readString(candidate.lastError),
    };
}

function readMessageFromEvent(frame: RuntimeEvent): ConversationMessage | null {
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const nested = (data.message && typeof data.message === 'object'
        ? data.message
        : null) as Partial<ConversationMessage> | null;
    const candidate = nested ?? null;
    if (!candidate) return null;
    const messageId = readString(candidate.messageId);
    const turnId = readString(candidate.turnId);
    const text = readString(candidate.text);
    if (!messageId || !turnId || text === null) return null;
    const role = candidate.role === 'user' || candidate.role === 'system' ? candidate.role : 'assistant';
    const kind = candidate.kind === 'thinking' ? 'thinking' : 'message';
    return {
        messageId,
        turnId,
        role,
        text,
        kind,
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
    };
}

function normalizeConversationState(value: unknown): ConversationState {
    switch (value) {
        case 'starting':
        case 'working':
        case 'needs_attention':
        case 'awaiting_user':
        case 'awaiting_permission':
        case 'cancelling':
        case 'cancelled':
        case 'completed':
        case 'failed':
        case 'interrupted':
        case 'resuming':
        case 'idle':
            return value;
        default:
            return 'idle';
    }
}

function patchConversationState(
    conversationId: string,
    patch: Partial<DevPilotConversation>,
): Record<string, DevPilotConversation> {
    const existing = state.conversations[conversationId];
    if (!existing) return state.conversations as Record<string, DevPilotConversation>;
    return {
        ...state.conversations,
        [conversationId]: {
            ...existing,
            ...patch,
            updatedAt: patch.updatedAt ?? Date.now(),
        },
    };
}

function appendRuntimeActivity(activity: DevPilotRuntimeActivity): Record<string, readonly DevPilotRuntimeActivity[]> {
    const conversationId = activity.conversationId;
    if (!conversationId) return state.eventsByConversation as Record<string, readonly DevPilotRuntimeActivity[]>;
    const current = state.eventsByConversation[conversationId] ?? [];
    if (current.some((candidate) => candidate.id === activity.id && candidate.event === activity.event)) {
        return state.eventsByConversation as Record<string, readonly DevPilotRuntimeActivity[]>;
    }
    const next = [...current, activity].sort((a, b) => a.createdAt - b.createdAt);
    return {
        ...state.eventsByConversation,
        [conversationId]: next,
    };
}

function stateForRuntimeEvent(frame: RuntimeEvent): Partial<DevPilotDesktopState> | null {
    const activity = normalizeDevPilotRuntimeEvent(frame);
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const conversation = readConversationFromEvent(frame);
    const message = readMessageFromEvent(frame);
    const conversationId = conversation?.conversationId ?? readString(data.conversationId);
    let nextConversations = conversation
        ? mergeConversations([conversation])
        : state.conversations as Record<string, DevPilotConversation>;
    let nextMessages = state.messagesByConversation as Record<string, readonly ConversationMessage[]>;

    if (conversationId && message) {
        nextMessages = mergeConversationMessages(conversationId, [message]);
    }

    if (conversationId && !conversation) {
        const event = frame.event;
        if (event === 'run.started') {
            nextConversations = patchConversationState(conversationId, {
                state: normalizeConversationState(data.state) === 'idle' ? 'starting' : normalizeConversationState(data.state),
                activeRunId: readString(data.runId),
                lastError: null,
            });
        } else if (event === 'coordinator.started') {
            nextConversations = patchConversationState(conversationId, { state: 'working', activeRunId: readString(data.runId) });
        } else if (event === 'run.status') {
            nextConversations = patchConversationState(conversationId, { state: normalizeConversationState(data.state) });
        } else if (event === 'run.completed') {
            nextConversations = patchConversationState(conversationId, { state: 'completed', activeRunId: null, lastError: null });
        } else if (event === 'run.failed') {
            nextConversations = patchConversationState(conversationId, {
                state: 'failed',
                activeRunId: null,
                lastError: readString(data.message) ?? 'DevPilot run failed.',
            });
        } else if (event === 'run.cancelled') {
            nextConversations = patchConversationState(conversationId, { state: 'cancelled', activeRunId: null });
        } else if (event === 'user.input_required') {
            nextConversations = patchConversationState(conversationId, { state: 'needs_attention' });
        }
    }

    const nextEvents = appendRuntimeActivity(activity);
    const shouldRefreshReview = activity.projectId && (
        activity.event === 'file.changed'
        || activity.event === 'run.completed'
        || activity.event === 'tool.completed'
        || activity.event === 'command.completed'
    );

    if (shouldRefreshReview && activity.projectId === state.selectedProjectId) {
        void refreshDevPilotReview(activity.projectId);
    }

    if (
        nextConversations === state.conversations
        && nextMessages === state.messagesByConversation
        && nextEvents === state.eventsByConversation
    ) {
        return null;
    }

    return {
        conversations: nextConversations,
        messagesByConversation: nextMessages,
        eventsByConversation: nextEvents,
    };
}

function installRuntimeEvents(): void {
    if (unsubscribeRuntimeEvents) return;
    const client = readDevPilotDesktopClient();
    if (!client) return;
    unsubscribeRuntimeEvents = client.onRuntimeEvent((frame) => {
        const patch = stateForRuntimeEvent(frame);
        if (patch) patchState(patch);
    });
}

async function loadConversationsForProjects(projects: readonly DevPilotProject[]): Promise<readonly DevPilotConversation[]> {
    const client = getRequiredDevPilotDesktopClient();
    const chunks = await Promise.all(projects.map(async (project) => {
        try {
            const result = await withDevPilotTimeout(
                `conversation.list:${project.name}`,
                client.listConversations(project.projectId, false),
                10_000,
            );
            return result.conversations;
        } catch {
            return [];
        }
    }));
    return chunks.flat();
}

function resolveInitialSelection(uiState: DesktopUiState | null, projects: readonly DevPilotProject[], conversations: readonly DevPilotConversation[]) {
    const projectIds = new Set(projects.map((project) => project.projectId));
    const conversationIds = new Set(conversations.map((conversation) => conversation.conversationId));
    const selectedConversation = uiState?.selectedConversationId && conversationIds.has(uiState.selectedConversationId)
        ? conversations.find((conversation) => conversation.conversationId === uiState.selectedConversationId) ?? null
        : null;
    const selectedProjectId = selectedConversation?.projectId
        ?? (uiState?.selectedProjectId && projectIds.has(uiState.selectedProjectId) ? uiState.selectedProjectId : null)
        ?? projects[0]?.projectId
        ?? null;
    return {
        selectedProjectId,
        selectedConversationId: selectedConversation?.conversationId ?? null,
    };
}

export function getDevPilotDesktopState(): DevPilotDesktopState {
    return state;
}

export function subscribeDevPilotDesktopState(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function resetDevPilotDesktopStateForTests(nextState: Partial<DevPilotDesktopState> = {}): void {
    state = {
        ...INITIAL_STATE,
        ...nextState,
        loading: { ...INITIAL_STATE.loading, ...nextState.loading },
    };
    initializePromise = null;
    emit();
}

export function ensureDevPilotDesktopInitialized(enabled = true): Promise<void> {
    if (!enabled) return Promise.resolve();
    if (state.initialized && !state.loading.projects && !state.loading.conversations) return Promise.resolve();
    if (initializePromise) return initializePromise;

    initializePromise = (async () => {
        const client = getRequiredDevPilotDesktopClient();
        installRuntimeEvents();
        patchState({ loading: { projects: true, conversations: true }, error: null });
        try {
            const [auth, modelResult, uiState, projectResult] = await Promise.all([
                withDevPilotTimeout('auth.status', client.getCodexAuthStatus(), 6_000).catch(() => null),
                withDevPilotTimeout('models.list', client.listModels(), 8_000).catch(() => ({ provider: 'codex' as const, models: [] as RuntimeModel[] })),
                withDevPilotTimeout('ui.state', client.getUiState(), 4_000).catch(() => null),
                withDevPilotTimeout('project.list', client.listProjects(), 10_000),
            ]);
            const projects = projectResult.projects ?? [];
            const conversations = await loadConversationsForProjects(projects);
            const initialSelection = resolveInitialSelection(uiState, projects, conversations);
            const models = modelResult.models ?? [];
            const selectedModel = uiState?.lastModel && models.some((model) => model.id === uiState.lastModel)
                ? uiState.lastModel
                : models[0]?.id ?? null;
            const selectedModelRecord = models.find((model) => model.id === selectedModel) ?? models[0] ?? null;
            const reasoningEffort = uiState?.lastReasoningEffort
                && selectedModelRecord?.reasoningEfforts.includes(uiState.lastReasoningEffort)
                    ? uiState.lastReasoningEffort
                    : selectedModelRecord?.defaultReasoningEffort ?? 'high';
            patchState({
                initialized: true,
                authenticated: auth?.signedIn === true,
                runtimeReady: auth?.runtimeReady !== false,
                projects: replaceProjects(projects),
                conversations: mergeConversations(conversations),
                selectedProjectId: initialSelection.selectedProjectId,
                selectedConversationId: initialSelection.selectedConversationId,
                models,
                selectedModel,
                reasoningEffort,
                sandboxMode: normalizeDevPilotSandboxMode(uiState?.lastSandbox),
                loading: { projects: false, conversations: false },
                error: null,
            });
            if (initialSelection.selectedConversationId) {
                await selectDevPilotConversation(initialSelection.selectedConversationId);
            } else if (initialSelection.selectedProjectId) {
                await refreshDevPilotReview(initialSelection.selectedProjectId);
            }
        } catch (error) {
            patchState({
                initialized: true,
                loading: { projects: false, conversations: false },
                error: error instanceof Error ? error.message : 'DevPilot desktop runtime failed to load projects.',
            });
        } finally {
            initializePromise = null;
        }
    })();

    return initializePromise;
}

export async function refreshDevPilotProjectsAndConversations(): Promise<void> {
    const client = getRequiredDevPilotDesktopClient();
    patchState({ loading: { projects: true, conversations: true }, error: null });
    try {
        const projectResult = await withDevPilotTimeout('project.list', client.listProjects(), 10_000);
        const projects = projectResult.projects ?? [];
        const conversations = await loadConversationsForProjects(projects);
        patchState({
            projects: replaceProjects(projects),
            conversations: mergeConversations(conversations),
            loading: { projects: false, conversations: false },
        });
    } catch (error) {
        patchState({
            loading: { projects: false, conversations: false },
            error: error instanceof Error ? error.message : 'DevPilot projects failed to refresh.',
        });
    }
}

export async function openDevPilotProjectFolder(): Promise<DevPilotProject | null> {
    const client = getRequiredDevPilotDesktopClient();
    const path = await client.selectProjectFolder();
    if (!path) return null;
    patchState({ loading: { projects: true, conversations: true }, error: null });
    try {
        const opened = await withDevPilotTimeout('project.open', client.openProject(path), 15_000);
        const project = opened.project;
        const list = await withDevPilotTimeout('conversation.list', client.listConversations(project.projectId, false), 10_000);
        await client.saveUiState({ selectedProjectId: project.projectId, selectedConversationId: null });
        patchState({
            projects: mergeProjects([project]),
            conversations: mergeConversations(list.conversations ?? []),
            selectedProjectId: project.projectId,
            selectedConversationId: null,
            loading: { projects: false, conversations: false },
        });
        await refreshDevPilotReview(project.projectId);
        return project;
    } catch (error) {
        patchState({
            loading: { projects: false, conversations: false },
            error: error instanceof Error ? error.message : 'DevPilot failed to open the selected folder.',
        });
        return null;
    }
}

export function selectDevPilotProject(projectId: string | null): void {
    const normalized = readString(projectId);
    patchState({
        selectedProjectId: normalized,
        selectedConversationId: null,
        selectedChangedFile: null,
        selectedDiff: null,
    });
    const client = readDevPilotDesktopClient();
    if (client) {
        void client.saveUiState({ selectedProjectId: normalized, selectedConversationId: null }).catch(() => undefined);
    }
    if (normalized) void refreshDevPilotReview(normalized);
}

export async function selectDevPilotConversation(conversationId: string): Promise<void> {
    const conversation = state.conversations[conversationId] ?? null;
    if (!conversation) {
        patchState({ error: 'DevPilot conversation is unavailable.' });
        return;
    }
    const client = getRequiredDevPilotDesktopClient();
    patchState({
        selectedProjectId: conversation.projectId,
        selectedConversationId: conversation.conversationId,
        loading: { conversation: true },
        error: null,
    });
    try {
        const opened = await withDevPilotTimeout(
            'conversation.open',
            client.openConversation(conversation.projectId, conversation.conversationId),
            12_000,
        );
        await client.saveUiState({
            selectedProjectId: conversation.projectId,
            selectedConversationId: conversation.conversationId,
        });
        patchState({
            conversations: mergeConversations([opened.conversation]),
            messagesByConversation: setConversationMessages(conversation.conversationId, opened.messages ?? []),
            selectedProjectId: opened.conversation.projectId,
            selectedConversationId: opened.conversation.conversationId,
            loading: { conversation: false },
        });
        await refreshDevPilotReview(opened.conversation.projectId);
    } catch (error) {
        patchState({
            loading: { conversation: false },
            error: error instanceof Error ? error.message : 'DevPilot failed to open the conversation.',
        });
    }
}

export function findDevPilotConversationProjectId(conversationId: string): string | null {
    return state.conversations[conversationId]?.projectId ?? null;
}

export function isKnownDevPilotConversationId(conversationId: string): boolean {
    return Boolean(state.conversations[conversationId]) || conversationId.startsWith('conversation-');
}

function optimisticUserMessage(text: string): ConversationMessage {
    const now = Date.now();
    transientMessageSeq += 1;
    return {
        messageId: `local-pending-${now}-${transientMessageSeq}`,
        turnId: `local-turn-${now}-${transientMessageSeq}`,
        role: 'user',
        text,
        kind: 'message',
        createdAt: now,
    };
}

export async function sendDevPilotConversationMessage(text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) return;
    const client = getRequiredDevPilotDesktopClient();
    const projectId = state.selectedProjectId;
    if (!projectId) {
        patchState({ error: 'Open a folder before starting a DevPilot conversation.' });
        return;
    }
    patchState({ error: null });

    let conversation = state.selectedConversationId ? state.conversations[state.selectedConversationId] ?? null : null;
    try {
        if (!conversation) {
            const created = await withDevPilotTimeout('conversation.create', client.createConversation({
                projectId,
                title: 'New conversation',
                model: state.selectedModel ?? undefined,
                reasoningEffort: state.reasoningEffort,
                sandbox: state.sandboxMode,
            }), 12_000);
            conversation = created.conversation;
            patchState({
                conversations: mergeConversations([conversation]),
                selectedProjectId: conversation.projectId,
                selectedConversationId: conversation.conversationId,
            });
            await client.saveUiState({
                selectedProjectId: conversation.projectId,
                selectedConversationId: conversation.conversationId,
                lastModel: conversation.model,
                lastReasoningEffort: conversation.reasoningEffort,
                lastSandbox: conversation.sandbox,
            }).catch(() => undefined);
        }

        const pendingMessage = optimisticUserMessage(prompt);
        patchState({
            messagesByConversation: mergeConversationMessages(conversation.conversationId, [pendingMessage]),
            conversations: patchConversationState(conversation.conversationId, {
                state: 'starting',
                activeRunId: conversation.activeRunId,
                lastError: null,
            }),
        });

        await withDevPilotTimeout('conversation.send', client.sendConversationMessage({
            projectId: conversation.projectId,
            conversationId: conversation.conversationId,
            text: prompt,
        }), 12_000);

        const opened = await withDevPilotTimeout('conversation.open', client.openConversation(
            conversation.projectId,
            conversation.conversationId,
        ), 12_000);
        patchState({
            conversations: mergeConversations([opened.conversation]),
            messagesByConversation: setConversationMessages(opened.conversation.conversationId, opened.messages ?? []),
            selectedProjectId: opened.conversation.projectId,
            selectedConversationId: opened.conversation.conversationId,
        });
    } catch (error) {
        patchState({ error: error instanceof Error ? error.message : 'DevPilot failed to send the message.' });
    }
}

export async function cancelSelectedDevPilotConversation(): Promise<void> {
    const conversation = state.selectedConversationId ? state.conversations[state.selectedConversationId] ?? null : null;
    if (!conversation) return;
    const client = getRequiredDevPilotDesktopClient();
    try {
        const result = await withDevPilotTimeout('run.cancel', client.cancelConversationRun({
            projectId: conversation.projectId,
            conversationId: conversation.conversationId,
        }), 8_000);
        patchState({
            conversations: patchConversationState(conversation.conversationId, {
                state: result.state,
                activeRunId: result.runId,
            }),
        });
    } catch (error) {
        patchState({ error: error instanceof Error ? error.message : 'DevPilot failed to stop the current run.' });
    }
}

export function setDevPilotModel(model: string): void {
    const selected = readString(model);
    if (!selected) return;
    const modelRecord = state.models.find((candidate) => candidate.id === selected) ?? null;
    const reasoningEffort = modelRecord && !modelRecord.reasoningEfforts.includes(state.reasoningEffort)
        ? modelRecord.defaultReasoningEffort
        : state.reasoningEffort;
    patchState({ selectedModel: selected, reasoningEffort });
    const client = readDevPilotDesktopClient();
    if (client) void client.saveUiState({ lastModel: selected, lastReasoningEffort: reasoningEffort }).catch(() => undefined);
}

export function setDevPilotReasoningEffort(reasoningEffort: string): void {
    const selected = readString(reasoningEffort);
    if (!selected) return;
    patchState({ reasoningEffort: selected });
    const client = readDevPilotDesktopClient();
    if (client) void client.saveUiState({ lastReasoningEffort: selected }).catch(() => undefined);
}

export function setDevPilotSandboxMode(sandboxMode: SandboxMode): void {
    patchState({ sandboxMode });
    const client = readDevPilotDesktopClient();
    if (client) void client.saveUiState({ lastSandbox: sandboxMode }).catch(() => undefined);
}

export async function refreshDevPilotReview(projectId: string): Promise<void> {
    const normalizedProjectId = readString(projectId);
    if (!normalizedProjectId) return;
    const client = getRequiredDevPilotDesktopClient();
    patchState({ loading: { review: true } });
    try {
        const result = await withDevPilotTimeout('changes.list', client.listChanges(normalizedProjectId), 10_000);
        patchState({
            changesByProject: {
                ...state.changesByProject,
                [normalizedProjectId]: result.changes,
            },
            loading: { review: false },
        });
        await prefetchVisibleDiffs(normalizedProjectId, result.changes);
    } catch (error) {
        patchState({
            loading: { review: false },
            error: error instanceof Error ? error.message : 'DevPilot failed to refresh project changes.',
        });
    }
}

function diffKey(projectId: string, path: string): string {
    return `${projectId}\u0000${path}`;
}

async function prefetchVisibleDiffs(projectId: string, changes: LocalGitChanges): Promise<void> {
    const files = changes.files.slice(0, 30);
    await Promise.all(files.map(async (file) => {
        if (!file.path) return;
        if (state.diffByProjectPath[diffKey(projectId, file.path)]) return;
        await readDevPilotChangeDiff(projectId, file.path, 'combined').catch(() => undefined);
    }));
}

export async function readDevPilotChangeDiff(projectId: string, path: string | null, scope: ReviewScope = 'combined'): Promise<DevPilotDiff | null> {
    const normalizedProjectId = readString(projectId);
    if (!normalizedProjectId) return null;
    const client = getRequiredDevPilotDesktopClient();
    try {
        const result = await withDevPilotTimeout('changes.diff', client.readChangeDiff({
            projectId: normalizedProjectId,
            path: path ?? undefined,
            scope,
        }), 10_000);
        const diff = {
            projectId: normalizedProjectId,
            path: result.diff.path,
            scope: result.diff.scope,
            diff: result.diff.diff,
            truncated: result.diff.truncated,
        };
        const keyPath = diff.path ?? path ?? '__all__';
        patchState({
            selectedChangedFile: diff.path ?? path,
            selectedDiff: diff,
            diffByProjectPath: {
                ...state.diffByProjectPath,
                [diffKey(normalizedProjectId, keyPath)]: diff.diff,
            },
        });
        return diff;
    } catch (error) {
        patchState({ error: error instanceof Error ? error.message : 'DevPilot failed to load the diff.' });
        return null;
    }
}

export function isSelectedConversationWorking(): boolean {
    const conversation = state.selectedConversationId ? state.conversations[state.selectedConversationId] ?? null : null;
    return Boolean(conversation && isDevPilotWorkingState(conversation.state));
}

export function isSelectedConversationAttentionRequired(): boolean {
    const conversation = state.selectedConversationId ? state.conversations[state.selectedConversationId] ?? null : null;
    return Boolean(conversation && isDevPilotAttentionState(conversation.state));
}
