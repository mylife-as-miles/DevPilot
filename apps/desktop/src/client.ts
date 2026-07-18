/** Typed, capability-limited renderer boundary for the local DevPilot shell. */

export type RuntimeStatus = Readonly<{
    ready: boolean;
    command: string | null;
    source: 'bundled-runtime' | 'configured' | 'repository-virtual-environment' | 'path' | null;
    version: string | null;
    issue: string | null;
}>;

export type CodexAuthStatus = Readonly<{
    runtimeReady: boolean;
    signedIn: boolean;
    message: string;
    accountLabel?: string | null;
    plan?: string | null;
}>;

export type DevPilotProject = Readonly<{
    projectId: string;
    path: string;
    name: string;
    createdAt: number;
    lastOpenedAt: number;
}>;

export type ProjectPreflight = Readonly<{
    path: string;
    readable: boolean;
    isGitRepository: boolean;
    branch: string | null;
    dirty: boolean | null;
    gitAvailable: boolean;
}>;

export type ConversationState = 'idle' | 'starting' | 'working' | 'needs_attention' | 'awaiting_user' | 'awaiting_permission' | 'cancelling' | 'cancelled' | 'completed' | 'failed' | 'interrupted' | 'resuming';

export type DevPilotConversation = Readonly<{
    conversationId: string;
    projectId: string;
    title: string;
    state: ConversationState;
    createdAt: number;
    updatedAt: number;
    provider: 'codex';
    model: string;
    reasoningEffort: string;
    sandbox: 'read-only' | 'workspace-write' | 'full-access';
    pinned: boolean;
    archived: boolean;
    activeRunId: string | null;
    lastError: string | null;
}>;

export type ConversationMessage = Readonly<{
    messageId: string;
    turnId: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    kind: 'message' | 'thinking';
    createdAt: number;
}>;

export type RuntimeModel = Readonly<{
    id: string;
    label: string;
    reasoningEfforts: readonly string[];
    defaultReasoningEffort: string;
}>;

export type RuntimeEvent = Readonly<{ event: string; data: Readonly<Record<string, unknown>> }>;

export type RuntimeLogEntry = Readonly<{
    timestamp: number;
    stream: 'stderr';
    level: 'debug' | 'info' | 'warning' | 'error';
    message: string;
}>;

export type ChangedFile = Readonly<{
    path: string;
    status: string;
    additions: number | null;
    deletions: number | null;
    included: boolean;
    pending: boolean;
}>;

export type LocalGitChanges = Readonly<{
    available: boolean;
    repository: string | null;
    branch: string | null;
    dirty: boolean;
    files: readonly ChangedFile[];
    issue: string | null;
}>;

export type ReviewScope = 'combined' | 'included' | 'pending';

export type DesktopUiState = Readonly<{
    version: 1;
    selectedProjectId: string | null;
    selectedConversationId: string | null;
    lastModel: string | null;
    lastReasoningEffort: string;
    lastSandbox: 'read-only' | 'workspace-write' | 'full-access';
    migrations: Readonly<Record<string, unknown>>;
}>;

export type ConversationInput = Readonly<{
    projectId?: string;
    path?: string;
    title?: string;
    model?: string;
    reasoningEffort?: string;
    sandbox?: 'read-only' | 'workspace-write' | 'full-access';
}>;

export type ConversationReference = Readonly<{ projectId: string; conversationId: string }>;

export type DesktopClient = Readonly<{
    getRuntimeStatus: () => Promise<RuntimeStatus>;
    getCodexAuthStatus: () => Promise<CodexAuthStatus>;
    startCodexLogin: () => Promise<Readonly<{ pid: number; alreadyRunning: boolean }>>;
    selectProjectFolder: () => Promise<string | null>;
    openProject: (projectPath: string) => Promise<Readonly<{ project: DevPilotProject; preflight: ProjectPreflight }>>;
    listProjects: () => Promise<Readonly<{ projects: readonly DevPilotProject[] }>>;
    getProject: (projectId: string) => Promise<Readonly<{ project: DevPilotProject }>>;
    removeProject: (projectId: string) => Promise<Readonly<{ removed: boolean; projectId: string }>>;
    preflightProject: (projectId: string) => Promise<Readonly<{ preflight: ProjectPreflight }>>;
    listModels: () => Promise<Readonly<{ provider: 'codex'; models: readonly RuntimeModel[] }>>;
    createConversation: (input: ConversationInput) => Promise<Readonly<{ conversation: DevPilotConversation }>>;
    listConversations: (projectId: string, includeArchived?: boolean) => Promise<Readonly<{ projectId: string; conversations: readonly DevPilotConversation[] }>>;
    openConversation: (projectId: string, conversationId: string) => Promise<Readonly<{ conversation: DevPilotConversation; messages: readonly ConversationMessage[] }>>;
    renameConversation: (input: ConversationReference & Readonly<{ title: string }>) => Promise<Readonly<{ conversation: DevPilotConversation }>>;
    pinConversation: (input: ConversationReference & Readonly<{ pinned: boolean }>) => Promise<Readonly<{ conversation: DevPilotConversation }>>;
    archiveConversation: (input: ConversationReference & Readonly<{ archived?: boolean }>) => Promise<Readonly<{ conversation: DevPilotConversation }>>;
    deleteConversation: (input: ConversationReference) => Promise<Readonly<{ conversationId: string; deleted: boolean }>>;
    sendConversationMessage: (input: ConversationReference & Readonly<{ text: string }>) => Promise<Readonly<{ turnId: string; runId: string }>>;
    resumeConversation: (input: ConversationReference & Readonly<{ prompt?: string }>) => Promise<Readonly<{ turnId: string; runId: string }>>;
    cancelConversationRun: (input: ConversationReference) => Promise<Readonly<{ conversationId: string; runId: string | null; state: ConversationState }>>;
    getConversationRunStatus: (input: ConversationReference) => Promise<Readonly<{ conversationId: string; runId: string | null; state: ConversationState; running: boolean }>>;
    listChanges: (projectId: string) => Promise<Readonly<{ changes: LocalGitChanges }>>;
    readChangeDiff: (input: Readonly<{ projectId: string; path?: string; scope?: ReviewScope }>) => Promise<Readonly<{ diff: Readonly<{ scope: ReviewScope; path: string | null; diff: string; truncated: boolean }> }>>;
    getUiState: () => Promise<DesktopUiState>;
    saveUiState: (patch: Partial<DesktopUiState>) => Promise<DesktopUiState>;
    getRuntimeLogs: () => Promise<readonly RuntimeLogEntry[]>;
    clearRuntimeLogs: () => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    onRuntimeEvent: (listener: (event: RuntimeEvent) => void) => () => void;
    onRuntimeLog: (listener: (entry: RuntimeLogEntry) => void) => () => void;
    onUiState: (listener: (state: DesktopUiState) => void) => () => void;
}>;

type DesktopGlobal = typeof globalThis & { __DEVPILOT_ELECTRON__?: Partial<DesktopClient> };

export function getDesktopClient(target: DesktopGlobal = globalThis): DesktopClient | null {
    const candidate = target.__DEVPILOT_ELECTRON__;
    return candidate
        && typeof candidate.getRuntimeStatus === 'function'
        && typeof candidate.getCodexAuthStatus === 'function'
        && typeof candidate.startCodexLogin === 'function'
        && typeof candidate.selectProjectFolder === 'function'
        && typeof candidate.openProject === 'function'
        && typeof candidate.listProjects === 'function'
        && typeof candidate.listModels === 'function'
        && typeof candidate.createConversation === 'function'
        && typeof candidate.listConversations === 'function'
        && typeof candidate.openConversation === 'function'
        && typeof candidate.sendConversationMessage === 'function'
        && typeof candidate.cancelConversationRun === 'function'
        && typeof candidate.listChanges === 'function'
        && typeof candidate.readChangeDiff === 'function'
        && typeof candidate.onRuntimeEvent === 'function'
        ? candidate as DesktopClient
        : null;
}
