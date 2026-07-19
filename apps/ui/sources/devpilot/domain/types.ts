import type {
    ChangedFile,
    ConversationMessage,
    ConversationState,
    DevPilotConversation,
    DevPilotProject,
    LocalGitChanges,
    ReviewScope,
    RuntimeEvent,
    RuntimeModel,
} from '@devpilot/desktop/client';

export type {
    ChangedFile,
    ConversationMessage,
    ConversationState,
    DevPilotConversation,
    DevPilotProject,
    LocalGitChanges,
    ReviewScope,
    RuntimeEvent,
    RuntimeModel,
};

export type SandboxMode = DevPilotConversation['sandbox'];

export type DevPilotRuntimeActivity = Readonly<{
    id: string;
    event: string;
    createdAt: number;
    projectId: string | null;
    conversationId: string | null;
    runId: string | null;
    title: string;
    detail: string | null;
    tone: 'info' | 'working' | 'success' | 'warning' | 'error';
}>;

export type DevPilotDiff = Readonly<{
    projectId: string;
    path: string | null;
    scope: ReviewScope;
    diff: string;
    truncated: boolean;
}>;

export type DevPilotLoadingState = Readonly<{
    projects: boolean;
    conversations: boolean;
    conversation: boolean;
    review: boolean;
}>;

export type DevPilotDesktopState = Readonly<{
    initialized: boolean;
    authenticated: boolean;
    runtimeReady: boolean;

    projects: Readonly<Record<string, DevPilotProject>>;
    conversations: Readonly<Record<string, DevPilotConversation>>;
    messagesByConversation: Readonly<Record<string, readonly ConversationMessage[]>>;
    eventsByConversation: Readonly<Record<string, readonly DevPilotRuntimeActivity[]>>;

    selectedProjectId: string | null;
    selectedConversationId: string | null;

    models: readonly RuntimeModel[];
    selectedModel: string | null;
    reasoningEffort: string;
    sandboxMode: SandboxMode;

    changesByProject: Readonly<Record<string, LocalGitChanges>>;
    selectedChangedFile: string | null;
    selectedDiff: DevPilotDiff | null;
    diffByProjectPath: Readonly<Record<string, string>>;

    loading: DevPilotLoadingState;
    error: string | null;
}>;

export type DevPilotConversationGroup = 'attention' | 'working' | 'pinned' | 'recent';

export type DevPilotConversationRowModel = Readonly<{
    id: string;
    title: string;
    subtitle: string;
    status: ConversationState;
    pinned: boolean;
    updatedAt: number;
    projectId: string;
    projectName: string;
    projectPath: string;
    model: string;
    reasoningEffort: string;
    requiresAttention: boolean;
}>;
