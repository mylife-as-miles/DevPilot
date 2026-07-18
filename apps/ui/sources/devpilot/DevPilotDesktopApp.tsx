import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import {
    getDesktopClient,
    type ConversationMessage,
    type ConversationState,
    type DevPilotConversation,
    type DevPilotProject,
    type LocalGitChanges,
    type ProjectPreflight,
    type ReviewScope,
    type RuntimeEvent,
    type RuntimeModel,
} from '@devpilot/desktop/client';

type WorkspaceState = Readonly<{
    projects: readonly DevPilotProject[];
    conversations: readonly DevPilotConversation[];
    models: readonly RuntimeModel[];
    activeProject: DevPilotProject | null;
    preflight: ProjectPreflight | null;
    activeConversation: DevPilotConversation | null;
    messages: readonly ConversationMessage[];
    changes: LocalGitChanges | null;
}>;

const EMPTY_WORKSPACE: WorkspaceState = {
    projects: [], conversations: [], models: [], activeProject: null, preflight: null, activeConversation: null, messages: [], changes: null,
};

export const DevPilotDesktopApp = React.memo(function DevPilotDesktopApp(): React.ReactElement {
    const desktop = React.useMemo(() => getDesktopClient(), []);
    const [authState, setAuthState] = React.useState<'loading' | 'signed-out' | 'signed-in' | 'error'>('loading');
    const [workspace, setWorkspace] = React.useState<WorkspaceState>(EMPTY_WORKSPACE);
    const [model, setModel] = React.useState<string | null>(null);
    const [reasoningEffort, setReasoningEffort] = React.useState('high');
    const [sandbox, setSandbox] = React.useState<'read-only' | 'workspace-write' | 'full-access'>('workspace-write');
    const [prompt, setPrompt] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [showSettings, setShowSettings] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [runtimeEvents, setRuntimeEvents] = React.useState<readonly RuntimeEvent[]>([]);

    const refresh = React.useCallback(async (selection?: Readonly<{ projectId?: string | null; conversationId?: string | null }>) => {
        if (!desktop) return;
        const [projectsResult, modelsResult, uiState] = await Promise.all([desktop.listProjects(), desktop.listModels(), desktop.getUiState()]);
        const projects = projectsResult.projects;
        const selectedProjectId = selection?.projectId ?? uiState.selectedProjectId;
        const activeProject = projects.find((project) => project.projectId === selectedProjectId) ?? projects[0] ?? null;
        const conversationsResult = activeProject ? await desktop.listConversations(activeProject.projectId) : { projectId: '', conversations: [] };
        const selectedConversationId = selection?.conversationId ?? uiState.selectedConversationId;
        const activeConversation = conversationsResult.conversations.find((conversation) => conversation.conversationId === selectedConversationId)
            ?? conversationsResult.conversations[0]
            ?? null;
        const [opened, changesResult] = await Promise.all([
            activeProject && activeConversation
                ? desktop.openConversation(activeProject.projectId, activeConversation.conversationId)
                : null,
            activeProject ? desktop.listChanges(activeProject.projectId) : null,
        ]);
        const selectedModel = uiState.lastModel && modelsResult.models.some((candidate) => candidate.id === uiState.lastModel)
            ? uiState.lastModel
            : modelsResult.models[0]?.id ?? null;
        setModel(selectedModel);
        setReasoningEffort(uiState.lastReasoningEffort || modelsResult.models[0]?.defaultReasoningEffort || 'high');
        setSandbox(uiState.lastSandbox || 'workspace-write');
        setWorkspace({
            projects,
            conversations: conversationsResult.conversations,
            models: modelsResult.models,
            activeProject,
            preflight: activeProject ? (await desktop.preflightProject(activeProject.projectId)).preflight : null,
            activeConversation: opened?.conversation ?? activeConversation,
            messages: opened?.messages ?? [],
            changes: changesResult?.changes ?? null,
        });
    }, [desktop]);

    React.useEffect(() => {
        if (!desktop) {
            setAuthState('error');
            setError('Open this screen in the DevPilot desktop app.');
            return undefined;
        }
        let mounted = true;
        const check = async () => {
            try {
                const auth = await desktop.getCodexAuthStatus();
                if (!mounted) return;
                setAuthState(auth.signedIn ? 'signed-in' : 'signed-out');
                if (auth.signedIn) await refresh();
            } catch (cause) {
                if (!mounted) return;
                setAuthState('error');
                setError(messageFrom(cause));
            }
        };
        void check();
        return () => { mounted = false; };
    }, [desktop, refresh]);

    React.useEffect(() => {
        if (!desktop || authState !== 'signed-in') return undefined;
        return desktop.onRuntimeEvent((event) => {
            const projectId = typeof event.data.projectId === 'string' ? event.data.projectId : undefined;
            const conversationId = typeof event.data.conversationId === 'string' ? event.data.conversationId : undefined;
            if (conversationId && conversationId === workspace.activeConversation?.conversationId && isActivityEvent(event)) {
                setRuntimeEvents((current) => [...current, event].slice(-24));
            }
            void refresh({ projectId, conversationId });
        });
    }, [authState, desktop, refresh, workspace.activeConversation?.conversationId]);

    React.useEffect(() => {
        setRuntimeEvents([]);
    }, [workspace.activeConversation?.conversationId]);

    const signIn = React.useCallback(async () => {
        if (!desktop || busy) return;
        setBusy(true);
        setError(null);
        try {
            await desktop.startCodexLogin();
            const deadline = Date.now() + 305_000;
            const poll = async (): Promise<void> => {
                const auth = await desktop.getCodexAuthStatus();
                if (auth.signedIn) {
                    setAuthState('signed-in');
                    setBusy(false);
                    await refresh();
                    return;
                }
                if (Date.now() >= deadline) throw new Error('ChatGPT sign-in timed out. Please try again.');
                setTimeout(() => { void poll(); }, 1_500);
            };
            void poll().catch((cause) => { setError(messageFrom(cause)); setBusy(false); });
        } catch (cause) {
            setError(messageFrom(cause));
            setBusy(false);
        }
    }, [busy, desktop, refresh]);

    const openFolder = React.useCallback(async () => {
        if (!desktop || busy) return;
        setBusy(true);
        setError(null);
        try {
            const selected = await desktop.selectProjectFolder();
            if (!selected) return;
            const opened = await desktop.openProject(selected);
            await refresh({ projectId: opened.project.projectId, conversationId: null });
        } catch (cause) {
            setError(messageFrom(cause));
        } finally {
            setBusy(false);
        }
    }, [busy, desktop, refresh]);

    const selectConversation = React.useCallback(async (conversation: DevPilotConversation) => {
        if (!desktop || !workspace.activeProject) return;
        setBusy(true);
        try {
            await desktop.openConversation(workspace.activeProject.projectId, conversation.conversationId);
            await refresh({ projectId: workspace.activeProject.projectId, conversationId: conversation.conversationId });
        } catch (cause) {
            setError(messageFrom(cause));
        } finally {
            setBusy(false);
        }
    }, [desktop, refresh, workspace.activeProject]);

    const send = React.useCallback(async () => {
        const text = prompt.trim();
        if (!desktop || !workspace.activeProject || !text || busy) return;
        if (!model) {
            setError('No Codex model is available for this ChatGPT account.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            let conversation = workspace.activeConversation;
            if (!conversation) {
                const created = await desktop.createConversation({
                    projectId: workspace.activeProject.projectId,
                    model,
                    reasoningEffort,
                    sandbox,
                });
                conversation = created.conversation;
            }
            await desktop.sendConversationMessage({
                projectId: workspace.activeProject.projectId,
                conversationId: conversation.conversationId,
                text,
            });
            setPrompt('');
            await desktop.saveUiState({ lastModel: model, lastReasoningEffort: reasoningEffort, lastSandbox: sandbox });
            await refresh({ projectId: workspace.activeProject.projectId, conversationId: conversation.conversationId });
        } catch (cause) {
            setError(messageFrom(cause));
        } finally {
            setBusy(false);
        }
    }, [busy, desktop, model, prompt, reasoningEffort, refresh, sandbox, workspace.activeConversation, workspace.activeProject]);

    const cancel = React.useCallback(async () => {
        if (!desktop || !workspace.activeProject || !workspace.activeConversation) return;
        setBusy(true);
        try {
            await desktop.cancelConversationRun({ projectId: workspace.activeProject.projectId, conversationId: workspace.activeConversation.conversationId });
            await refresh({ projectId: workspace.activeProject.projectId, conversationId: workspace.activeConversation.conversationId });
        } catch (cause) {
            setError(messageFrom(cause));
        } finally {
            setBusy(false);
        }
    }, [desktop, refresh, workspace.activeConversation, workspace.activeProject]);

    if (authState === 'loading') return <LoadingScreen />;
    if (authState !== 'signed-in') return <SignInScreen busy={busy} error={error} onSignIn={signIn} />;

    return (
        <View style={styles.shell} testID="devpilot-native-desktop">
            <ConversationSidebar
                busy={busy}
                conversations={workspace.conversations}
                project={workspace.activeProject}
                selectedConversationId={workspace.activeConversation?.conversationId ?? null}
                onOpenFolder={openFolder}
                onSelect={selectConversation}
                onSettings={() => setShowSettings((value) => !value)}
            />
            <View style={styles.centerPane}>
                <ConversationHeader
                    conversation={workspace.activeConversation}
                    project={workspace.activeProject}
                    preflight={workspace.preflight}
                    running={isRunning(workspace.activeConversation?.state)}
                    onCancel={cancel}
                />
                {showSettings ? (
                    <SettingsPanel model={model} models={workspace.models} reasoningEffort={reasoningEffort} sandbox={sandbox} onModel={setModel} onReasoning={setReasoningEffort} onSandbox={setSandbox} />
                ) : (
                    <Transcript messages={workspace.messages} conversation={workspace.activeConversation} events={runtimeEvents} />
                )}
                <Composer
                    disabled={!workspace.activeProject || !model || busy}
                    model={model}
                    models={workspace.models}
                    reasoningEffort={reasoningEffort}
                    sandbox={sandbox}
                    value={prompt}
                    running={isRunning(workspace.activeConversation?.state)}
                    onChange={setPrompt}
                    onModel={setModel}
                    onReasoning={setReasoningEffort}
                    onSandbox={setSandbox}
                    onSend={send}
                    onCancel={cancel}
                />
                {error ? <Text style={styles.errorBanner}>{error}</Text> : null}
            </View>
            <ReviewPane project={workspace.activeProject} preflight={workspace.preflight} conversation={workspace.activeConversation} changes={workspace.changes} />
        </View>
    );
});

function SignInScreen(props: Readonly<{ busy: boolean; error: string | null; onSignIn: () => void }>) {
    return (
        <View style={styles.authShell} testID="devpilot-chatgpt-onboarding">
            <View style={styles.authCard}>
                <View style={styles.logoTile}><Ionicons name="hardware-chip-outline" size={32} color="#43B5FF" /></View>
                <Text style={styles.authKicker}>DEVPILOT DESKTOP</Text>
                <Text style={styles.authTitle}>Code with your local projects.</Text>
                <Text style={styles.authBody}>Sign in with ChatGPT to use Codex through DevPilot. Folders stay local; conversations and run context are stored with each project.</Text>
                <Pressable disabled={props.busy} onPress={props.onSignIn} style={[styles.primaryButton, props.busy ? styles.disabled : null]}>
                    {props.busy ? <ActivityIndicator color="#0D1117" /> : <Ionicons name="log-in-outline" size={20} color="#0D1117" />}
                    <Text style={styles.primaryButtonText}>{props.busy ? 'Waiting for ChatGPT sign-in…' : 'Sign in with ChatGPT'}</Text>
                </Pressable>
                {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
            </View>
        </View>
    );
}

function LoadingScreen() {
    return <View style={styles.authShell}><ActivityIndicator color="#43B5FF" size="large" /><Text style={styles.loadingText}>Starting DevPilot…</Text></View>;
}

function ConversationSidebar(props: Readonly<{
    project: DevPilotProject | null;
    conversations: readonly DevPilotConversation[];
    selectedConversationId: string | null;
    busy: boolean;
    onOpenFolder: () => void;
    onSelect: (conversation: DevPilotConversation) => void;
    onSettings: () => void;
}>) {
    const groups = groupConversations(props.conversations);
    return (
        <View style={styles.sidebar}>
            <View style={styles.brandRow}>
                <View style={styles.brandMark}><Ionicons name="hardware-chip-outline" size={22} color="#47B7FF" /></View>
                <View style={styles.brandCopy}><Text style={styles.brandName}>DevPilot</Text><Text style={styles.readyLabel}>● ready</Text></View>
                <Pressable onPress={props.onSettings} style={styles.iconButton} accessibilityLabel="DevPilot settings"><Ionicons name="settings-outline" size={20} color="#C9D1D9" /></Pressable>
            </View>
            <Pressable disabled={props.busy} onPress={props.onOpenFolder} style={styles.openFolderButton}>
                <Ionicons name="folder-open-outline" size={18} color="#C9D1D9" /><Text style={styles.openFolderText}>{props.project ? 'Open another folder' : 'Open Folder'}</Text>
            </Pressable>
            {props.project ? <View style={styles.projectBadge}><Ionicons name="folder-outline" size={14} color="#88A9C9" /><View style={styles.flex}><Text numberOfLines={1} style={styles.projectName}>{props.project.name}</Text><Text numberOfLines={1} style={styles.projectPath}>{props.project.path}</Text></View></View> : null}
            <ScrollView contentContainerStyle={styles.sidebarScroll}>
                {(['needs_attention', 'working', 'pinned', 'recent'] as const).map((group) => (
                    <ConversationGroup key={group} title={groupTitle(group)} conversations={groups[group]} selectedConversationId={props.selectedConversationId} onSelect={props.onSelect} />
                ))}
            </ScrollView>
            <View style={styles.sidebarFooter}><Text style={styles.footerText}>{props.project ? 'Choose a conversation or type a new prompt.' : 'Open a folder to begin.'}</Text></View>
        </View>
    );
}

function ConversationGroup(props: Readonly<{ title: string; conversations: readonly DevPilotConversation[]; selectedConversationId: string | null; onSelect: (conversation: DevPilotConversation) => void }>) {
    if (props.conversations.length === 0) return null;
    return <View style={styles.conversationGroup}><Text style={styles.groupTitle}>{props.title}</Text>{props.conversations.map((conversation) => (
        <Pressable key={conversation.conversationId} onPress={() => props.onSelect(conversation)} style={[styles.conversationRow, props.selectedConversationId === conversation.conversationId ? styles.conversationRowActive : null]}>
            <View style={[styles.stateDot, { backgroundColor: stateColor(conversation.state) }]} />
            <View style={styles.flex}><Text numberOfLines={1} style={styles.conversationTitle}>{conversation.title}</Text><Text numberOfLines={1} style={styles.conversationMeta}>{conversation.model} · {timeLabel(conversation.updatedAt)}</Text></View>
        </Pressable>
    ))}</View>;
}

function ConversationHeader(props: Readonly<{ conversation: DevPilotConversation | null; project: DevPilotProject | null; preflight: ProjectPreflight | null; running: boolean; onCancel: () => void }>) {
    return <View style={styles.header}>
        <View style={styles.flex}><Text numberOfLines={1} style={styles.headerTitle}>{props.conversation?.title ?? (props.project ? 'New conversation' : 'Choose a project folder')}</Text><Text numberOfLines={1} style={styles.headerSubtitle}>{props.project ? `${props.project.name}${props.preflight?.branch ? ` · ${props.preflight.branch}` : ''}${props.preflight?.dirty ? ' · changes present' : ''}` : 'Your coding workspace stays tied to one local folder.'}</Text></View>
        {props.running ? <Pressable onPress={props.onCancel} style={styles.stopButton}><Ionicons name="stop-circle-outline" size={18} color="#FFB4A9" /><Text style={styles.stopText}>Stop</Text></Pressable> : <View style={styles.statusPill}><View style={styles.statusDot} /><Text style={styles.statusText}>{props.conversation?.state ?? 'idle'}</Text></View>}
    </View>;
}

function Transcript(props: Readonly<{ messages: readonly ConversationMessage[]; conversation: DevPilotConversation | null; events: readonly RuntimeEvent[] }>) {
    if (!props.conversation) return <View style={styles.emptyCenter}><Ionicons name="chatbubbles-outline" size={34} color="#527D9C" /><Text style={styles.emptyTitle}>Start a conversation</Text><Text style={styles.emptyCopy}>Pick a local folder, select your Codex settings, and send the first instruction. DevPilot creates the conversation only then.</Text></View>;
    return <ScrollView style={styles.transcript} contentContainerStyle={styles.transcriptContent}>
        {props.messages.length === 0 ? <View style={styles.emptyTranscript}><Text style={styles.emptyCopy}>This conversation is ready for your first message.</Text></View> : null}
        {props.messages.map((message) => <View key={message.messageId} style={[styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage]}><Text style={styles.messageRole}>{message.role === 'user' ? 'YOU' : message.kind === 'thinking' ? 'DEVPILOT THINKING' : 'DEVPILOT'}</Text><Text style={styles.messageText}>{message.text}</Text><Text style={styles.messageTime}>{formatTimestamp(message.createdAt)}</Text></View>)}
        {props.events.map((event, index) => <RuntimeActivityCard key={`${event.event}-${index}`} event={event} />)}
        {isRunning(props.conversation.state) ? <View style={styles.activityCard}><ActivityIndicator size="small" color="#47B7FF" /><View style={styles.flex}><Text style={styles.activityTitle}>DevPilot is working</Text><Text style={styles.activityCopy}>Coordinator and Executors are reporting structured activity in this conversation.</Text></View></View> : null}
        {props.conversation.lastError ? <View style={styles.failureCard}><Text style={styles.failureTitle}>Run needs attention</Text><Text style={styles.failureCopy}>{props.conversation.lastError}</Text></View> : null}
    </ScrollView>;
}

function RuntimeActivityCard(props: Readonly<{ event: RuntimeEvent }>) {
    const data = props.event.data;
    const title = activityTitle(props.event.event);
    const detail = typeof data.message === 'string' ? data.message
        : typeof data.text === 'string' ? data.text
            : typeof data.name === 'string' ? data.name
                : typeof data.path === 'string' ? data.path
                    : typeof data.command === 'string' ? data.command
                        : 'Runtime activity recorded for this conversation.';
    const icon = props.event.event.startsWith('tool.') || props.event.event.startsWith('command.') ? 'terminal-outline'
        : props.event.event.startsWith('file.') ? 'document-text-outline'
            : props.event.event.startsWith('permission.') ? 'shield-outline'
                : 'hardware-chip-outline';
    return <View style={styles.activityCard}><Ionicons name={icon} size={17} color="#79C9FF" /><View style={styles.flex}><Text style={styles.activityTitle}>{title}</Text><Text numberOfLines={3} style={styles.activityCopy}>{detail}</Text></View></View>;
}

function Composer(props: Readonly<{
    value: string; disabled: boolean; running: boolean; model: string | null; models: readonly RuntimeModel[]; reasoningEffort: string; sandbox: string;
    onChange: (value: string) => void; onModel: (value: string | null) => void; onReasoning: (value: string) => void; onSandbox: (value: 'read-only' | 'workspace-write' | 'full-access') => void; onSend: () => void; onCancel: () => void;
}>) {
    const modelIndex = Math.max(0, props.models.findIndex((item) => item.id === props.model));
    const reasoningOptions = props.models.find((item) => item.id === props.model)?.reasoningEfforts ?? ['low', 'medium', 'high'];
    return <View style={styles.composer}><TextInput multiline value={props.value} onChangeText={props.onChange} editable={!props.disabled} placeholder="What would you like to work on?" placeholderTextColor="#64748B" style={styles.promptInput} accessibilityLabel="DevPilot conversation prompt" />
        <View style={styles.composerControls}>
            <ControlButton icon="sparkles-outline" label={props.model ?? 'No model'} disabled={props.models.length === 0} onPress={() => props.onModel(props.models[(modelIndex + 1) % Math.max(1, props.models.length)]?.id ?? null)} />
            <ControlButton icon="bulb-outline" label={props.reasoningEffort} disabled={false} onPress={() => props.onReasoning(reasoningOptions[(Math.max(0, reasoningOptions.indexOf(props.reasoningEffort)) + 1) % reasoningOptions.length] ?? 'high')} />
            <ControlButton icon="shield-checkmark-outline" label={props.sandbox} disabled={false} onPress={() => props.onSandbox(nextSandbox(props.sandbox))} />
            <View style={styles.flex} />
            {props.running ? <Pressable onPress={props.onCancel} style={styles.sendButton}><Ionicons name="stop" size={18} color="#0D1117" /></Pressable> : <Pressable disabled={props.disabled || !props.value.trim()} onPress={props.onSend} style={[styles.sendButton, (props.disabled || !props.value.trim()) ? styles.disabled : null]}><Ionicons name="arrow-up" size={20} color="#0D1117" /></Pressable>}
        </View>
    </View>;
}

function ControlButton(props: Readonly<{ icon: React.ComponentProps<typeof Ionicons>['name']; label: string; disabled: boolean; onPress: () => void }>) {
    return <Pressable disabled={props.disabled} onPress={props.onPress} style={[styles.controlButton, props.disabled ? styles.disabled : null]}><Ionicons name={props.icon} size={14} color="#9FB3C8" /><Text numberOfLines={1} style={styles.controlText}>{props.label}</Text></Pressable>;
}

function SettingsPanel(props: Readonly<{ model: string | null; models: readonly RuntimeModel[]; reasoningEffort: string; sandbox: string; onModel: (value: string | null) => void; onReasoning: (value: string) => void; onSandbox: (value: 'read-only' | 'workspace-write' | 'full-access') => void }>) {
    return <View style={styles.settingsPanel}><Text style={styles.settingsTitle}>Conversation settings</Text><Text style={styles.settingsCopy}>These controls are saved as UI preferences. Every run receives the selected model, reasoning effort, and sandbox policy from the DevPilot runtime.</Text>
        <Text style={styles.settingsLabel}>Codex model</Text>{props.models.map((item) => <Pressable key={item.id} onPress={() => props.onModel(item.id)} style={[styles.settingOption, props.model === item.id ? styles.settingOptionActive : null]}><Text style={styles.settingText}>{item.label}</Text></Pressable>)}
        <Text style={styles.settingsLabel}>Reasoning effort</Text><View style={styles.optionRow}>{['low', 'medium', 'high'].map((value) => <Pressable key={value} onPress={() => props.onReasoning(value)} style={[styles.chip, props.reasoningEffort === value ? styles.chipActive : null]}><Text style={styles.chipText}>{value}</Text></Pressable>)}</View>
        <Text style={styles.settingsLabel}>Sandbox</Text><View style={styles.optionRow}>{(['read-only', 'workspace-write', 'full-access'] as const).map((value) => <Pressable key={value} onPress={() => props.onSandbox(value)} style={[styles.chip, props.sandbox === value ? styles.chipActive : null]}><Text style={styles.chipText}>{value}</Text></Pressable>)}</View>
    </View>;
}

function ReviewPane(props: Readonly<{ project: DevPilotProject | null; preflight: ProjectPreflight | null; conversation: DevPilotConversation | null; changes: LocalGitChanges | null }>) {
    const desktop = React.useMemo(() => getDesktopClient(), []);
    const [scope, setScope] = React.useState<ReviewScope>('combined');
    const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
    const [diff, setDiff] = React.useState('');
    const [diffError, setDiffError] = React.useState<string | null>(null);
    const visibleFiles = (props.changes?.files ?? []).filter((file) => scope === 'combined' || (scope === 'included' ? file.included : file.pending));

    React.useEffect(() => {
        setSelectedPath((current) => visibleFiles.some((file) => file.path === current) ? current : (visibleFiles[0]?.path ?? null));
    }, [props.changes, scope]);

    React.useEffect(() => {
        if (!desktop || !props.project || !selectedPath || !props.changes?.available) {
            setDiff('');
            setDiffError(null);
            return undefined;
        }
        let active = true;
        setDiffError(null);
        void desktop.readChangeDiff({ projectId: props.project.projectId, path: selectedPath, scope }).then((result) => {
            if (active) setDiff(result.diff.diff);
        }).catch((cause) => {
            if (active) {
                setDiff('');
                setDiffError(messageFrom(cause));
            }
        });
        return () => { active = false; };
    }, [desktop, props.changes?.available, props.project, scope, selectedPath]);

    return <View style={styles.reviewPane}><View style={styles.reviewHeader}><Text style={styles.reviewTitle}>Review</Text><Ionicons name="git-branch-outline" size={18} color="#8EA4B8" /></View>
        <View style={styles.reviewTabs}>{(['included', 'pending', 'combined'] as const).map((item) => <Pressable key={item} onPress={() => setScope(item)}><Text style={scope === item ? styles.reviewTabActive : styles.reviewTab}>{item[0].toUpperCase()}{item.slice(1)}</Text></Pressable>)}</View>
        {props.project ? <><View style={styles.reviewCard}><Text style={styles.reviewLabel}>LOCAL PROJECT</Text><Text style={styles.reviewProject}>{props.project.name}</Text><Text style={styles.reviewCopy}>{props.changes?.available ? `${props.changes.branch ?? 'detached'} / ${props.changes.dirty ? `${props.changes.files.length} changed file${props.changes.files.length === 1 ? '' : 's'}` : 'clean working tree'}` : (props.changes?.issue ?? (props.preflight?.isGitRepository ? 'Git review unavailable' : 'Not a Git repository'))}</Text></View>
            {props.changes?.available && visibleFiles.length > 0 ? <><ScrollView style={styles.reviewFiles} contentContainerStyle={styles.reviewFilesContent}>{visibleFiles.map((file) => <Pressable key={file.path} onPress={() => setSelectedPath(file.path)} style={[styles.reviewFile, selectedPath === file.path ? styles.reviewFileActive : null]}><View style={styles.flex}><Text numberOfLines={1} style={styles.reviewFilePath}>{file.path}</Text><Text style={styles.reviewFileMeta}>{file.status} / +{file.additions ?? '?'} -{file.deletions ?? '?'}</Text></View></Pressable>)}</ScrollView>
                <ScrollView style={styles.diffPreview} contentContainerStyle={styles.diffPreviewContent}><Text selectable style={styles.diffText}>{(diffError ?? diff) || 'No diff is available for this file in the selected view.'}</Text></ScrollView></> : <View style={styles.reviewEmpty}><Ionicons name="git-compare-outline" size={26} color="#54778F" /><Text style={styles.reviewEmptyTitle}>{props.changes?.available ? 'No changes in this view' : 'Local review is ready'}</Text><Text style={styles.reviewEmptyCopy}>{props.changes?.available ? 'Choose another review filter or continue working in this project.' : 'Open a Git project to inspect its local changes and diffs.'}</Text></View>}</> : <View style={styles.reviewEmpty}><Text style={styles.reviewEmptyTitle}>No project selected</Text><Text style={styles.reviewEmptyCopy}>Open a folder to inspect its local Git status and changes.</Text></View>}
    </View>;
}

function LegacyReviewPane(props: Readonly<{ project: DevPilotProject | null; preflight: ProjectPreflight | null; conversation: DevPilotConversation | null }>) {
    return <View style={styles.reviewPane}><View style={styles.reviewHeader}><Text style={styles.reviewTitle}>Review</Text><Ionicons name="git-branch-outline" size={18} color="#8EA4B8" /></View>
        <View style={styles.reviewTabs}><Text style={styles.reviewTabActive}>Included</Text><Text style={styles.reviewTab}>Pending</Text><Text style={styles.reviewTab}>Combined</Text></View>
        {props.project ? <><View style={styles.reviewCard}><Text style={styles.reviewLabel}>LOCAL PROJECT</Text><Text style={styles.reviewProject}>{props.project.name}</Text><Text style={styles.reviewCopy}>{props.preflight?.isGitRepository ? `${props.preflight.branch ?? 'detached'} · ${props.preflight.dirty ? 'working tree changed' : 'clean working tree'}` : 'Not a Git repository'}</Text></View>
            <View style={styles.reviewEmpty}><Ionicons name="git-compare-outline" size={26} color="#54778F" /><Text style={styles.reviewEmptyTitle}>Changes appear here</Text><Text style={styles.reviewEmptyCopy}>{props.conversation ? 'DevPilot will stream changed-file and command results into this local review panel.' : 'Start a conversation to inspect and change this project.'}</Text></View></> : <View style={styles.reviewEmpty}><Text style={styles.reviewEmptyTitle}>No project selected</Text><Text style={styles.reviewEmptyCopy}>Open a folder to inspect its local Git status and changes.</Text></View>}
    </View>;
}

function groupConversations(conversations: readonly DevPilotConversation[]) {
    const groups: Record<'needs_attention' | 'working' | 'pinned' | 'recent', DevPilotConversation[]> = { needs_attention: [], working: [], pinned: [], recent: [] };
    for (const conversation of conversations) {
        if (conversation.state === 'needs_attention' || conversation.state === 'failed' || conversation.state === 'awaiting_permission' || conversation.state === 'awaiting_user') groups.needs_attention.push(conversation);
        else if (isRunning(conversation.state)) groups.working.push(conversation);
        else if (conversation.pinned) groups.pinned.push(conversation);
        else groups.recent.push(conversation);
    }
    return groups;
}

function groupTitle(group: 'needs_attention' | 'working' | 'pinned' | 'recent') {
    return ({ needs_attention: 'NEEDS ATTENTION', working: 'WORKING', pinned: 'PINNED', recent: 'RECENT' })[group];
}

function isRunning(state: ConversationState | undefined) { return state === 'starting' || state === 'working' || state === 'resuming' || state === 'cancelling'; }
function isActivityEvent(event: RuntimeEvent) { return /^(coordinator|executor|tool|command|file|permission|sandbox)\./.test(event.event); }
function activityTitle(name: string) { return name.split('.').map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' '); }
function stateColor(state: ConversationState) { return state === 'failed' || state === 'needs_attention' ? '#FF6B6B' : isRunning(state) ? '#4ADE80' : state === 'cancelled' ? '#FBBF24' : '#66798B'; }
function nextSandbox(value: string): 'read-only' | 'workspace-write' | 'full-access' { return value === 'read-only' ? 'workspace-write' : value === 'workspace-write' ? 'full-access' : 'read-only'; }
function timeLabel(value: number) { const minutes = Math.max(0, Math.floor((Date.now() - value * 1000) / 60_000)); return minutes < 1 ? 'now' : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`; }
function formatTimestamp(value: number) { return new Date(value * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function messageFrom(error: unknown) { return error instanceof Error ? error.message : 'DevPilot could not complete that action.'; }

const styles = StyleSheet.create({
    shell: { flex: 1, flexDirection: 'row', backgroundColor: '#0D1117' },
    authShell: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#0D1117' },
    authCard: { width: '100%', maxWidth: 520, padding: 34, gap: 16, borderRadius: 20, backgroundColor: '#121A23', borderWidth: 1, borderColor: '#283544' },
    logoTile: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#132B3E' }, authKicker: { color: '#47B7FF', fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }, authTitle: { color: '#F1F5F9', fontSize: 30, lineHeight: 36, fontWeight: '700' }, authBody: { color: '#9FB3C8', fontSize: 15, lineHeight: 22 }, primaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 12, backgroundColor: '#47B7FF' }, primaryButtonText: { color: '#0D1117', fontSize: 15, fontWeight: '800' }, errorText: { color: '#FFB4A9', fontSize: 13, lineHeight: 18 }, loadingText: { marginTop: 16, color: '#9FB3C8', fontSize: 14 },
    sidebar: { width: 320, borderRightWidth: 1, borderColor: '#263340', backgroundColor: '#0B1016', paddingTop: 18 }, brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingBottom: 18 }, brandMark: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#132B3E' }, brandCopy: { flex: 1 }, brandName: { color: '#F1F5F9', fontSize: 19, fontWeight: '800' }, readyLabel: { marginTop: 2, color: '#4ADE80', fontSize: 11, fontWeight: '700' }, iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }, openFolderButton: { flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 14, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 10, backgroundColor: '#18222D', borderWidth: 1, borderColor: '#2C3D4D' }, openFolderText: { color: '#D8E4EF', fontSize: 13, fontWeight: '700' }, projectBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginTop: 12, padding: 10, borderRadius: 10, backgroundColor: '#101923' }, flex: { flex: 1, minWidth: 0 }, projectName: { color: '#E5EDF5', fontSize: 12, fontWeight: '700' }, projectPath: { marginTop: 2, color: '#71859A', fontSize: 10 }, sidebarScroll: { padding: 14, gap: 18 }, conversationGroup: { gap: 5 }, groupTitle: { marginBottom: 4, color: '#71859A', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, conversationRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 9, paddingVertical: 9, borderRadius: 8 }, conversationRowActive: { backgroundColor: '#1B2936' }, stateDot: { width: 7, height: 7, borderRadius: 4 }, conversationTitle: { color: '#DCE7F1', fontSize: 13, fontWeight: '600' }, conversationMeta: { marginTop: 2, color: '#71859A', fontSize: 10 }, sidebarFooter: { padding: 15, borderTopWidth: 1, borderColor: '#1F2B36' }, footerText: { color: '#71859A', fontSize: 11, lineHeight: 16 },
    centerPane: { flex: 1, minWidth: 420, backgroundColor: '#101720' }, header: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 24, borderBottomWidth: 1, borderColor: '#263340' }, headerTitle: { color: '#F1F5F9', fontSize: 17, fontWeight: '700' }, headerSubtitle: { marginTop: 4, color: '#8EA4B8', fontSize: 12 }, statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: '#18222D' }, statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80' }, statusText: { color: '#B7C9D9', fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }, stopButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#7A3B37' }, stopText: { color: '#FFB4A9', fontSize: 12, fontWeight: '700' },
    transcript: { flex: 1 }, transcriptContent: { padding: 24, gap: 16 }, emptyCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 34 }, emptyTitle: { color: '#E8F0F7', fontSize: 20, fontWeight: '700' }, emptyCopy: { maxWidth: 430, color: '#8EA4B8', fontSize: 14, lineHeight: 21, textAlign: 'center' }, emptyTranscript: { alignItems: 'center', paddingVertical: 34 }, message: { maxWidth: 760, gap: 8, padding: 16, borderRadius: 12, borderWidth: 1 }, userMessage: { alignSelf: 'flex-end', backgroundColor: '#12324A', borderColor: '#245574' }, assistantMessage: { alignSelf: 'flex-start', backgroundColor: '#15202B', borderColor: '#2B3B4B' }, messageRole: { color: '#79C9FF', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, messageText: { color: '#E5EDF5', fontSize: 14, lineHeight: 21 }, messageTime: { color: '#71859A', fontSize: 10 }, activityCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 11, backgroundColor: '#132438', borderWidth: 1, borderColor: '#245574' }, activityTitle: { color: '#DCEBFA', fontSize: 13, fontWeight: '700' }, activityCopy: { marginTop: 2, color: '#8EA4B8', fontSize: 12, lineHeight: 17 }, failureCard: { gap: 5, padding: 14, borderRadius: 11, backgroundColor: '#371F25', borderWidth: 1, borderColor: '#75404B' }, failureTitle: { color: '#FFB4A9', fontSize: 13, fontWeight: '700' }, failureCopy: { color: '#E6BDC3', fontSize: 12, lineHeight: 18 },
    composer: { gap: 10, margin: 16, padding: 12, borderRadius: 14, backgroundColor: '#141F2A', borderWidth: 1, borderColor: '#304355' }, promptInput: { minHeight: 60, maxHeight: 160, padding: 3, color: '#E5EDF5', fontSize: 14, lineHeight: 20, textAlignVertical: 'top' }, composerControls: { flexDirection: 'row', alignItems: 'center', gap: 7 }, controlButton: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 170, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 7, backgroundColor: '#0E151E' }, controlText: { color: '#9FB3C8', fontSize: 10, fontWeight: '700' }, sendButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#47B7FF' }, disabled: { opacity: 0.45 }, errorBanner: { marginHorizontal: 16, marginBottom: 10, color: '#FFB4A9', fontSize: 12 },
    settingsPanel: { flex: 1, padding: 24, gap: 12 }, settingsTitle: { color: '#E5EDF5', fontSize: 19, fontWeight: '700' }, settingsCopy: { color: '#8EA4B8', fontSize: 13, lineHeight: 19 }, settingsLabel: { marginTop: 10, color: '#71859A', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }, settingOption: { padding: 11, borderRadius: 8, borderWidth: 1, borderColor: '#2B3B4B' }, settingOptionActive: { borderColor: '#47B7FF', backgroundColor: '#14324B' }, settingText: { color: '#DCE7F1', fontSize: 13 }, optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#2B3B4B' }, chipActive: { borderColor: '#47B7FF', backgroundColor: '#14324B' }, chipText: { color: '#B7C9D9', fontSize: 11, fontWeight: '700' },
    reviewPane: { width: 330, borderLeftWidth: 1, borderColor: '#263340', backgroundColor: '#0B1016', padding: 16, gap: 14 }, reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 1, borderColor: '#263340' }, reviewTitle: { color: '#E5EDF5', fontSize: 15, fontWeight: '700' }, reviewTabs: { flexDirection: 'row', gap: 9 }, reviewTab: { color: '#71859A', fontSize: 11, fontWeight: '700' }, reviewTabActive: { color: '#E5EDF5', fontSize: 11, fontWeight: '800' }, reviewCard: { gap: 5, padding: 13, borderRadius: 10, backgroundColor: '#151F2A', borderWidth: 1, borderColor: '#2B3B4B' }, reviewLabel: { color: '#71859A', fontSize: 9, fontWeight: '800', letterSpacing: 1 }, reviewProject: { color: '#E5EDF5', fontSize: 13, fontWeight: '700' }, reviewCopy: { color: '#8EA4B8', fontSize: 11, lineHeight: 16 }, reviewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 18 }, reviewEmptyTitle: { color: '#C4D3E0', fontSize: 14, fontWeight: '700', textAlign: 'center' }, reviewEmptyCopy: { color: '#71859A', fontSize: 12, lineHeight: 18, textAlign: 'center' }, reviewFiles: { maxHeight: 180, borderRadius: 10, borderWidth: 1, borderColor: '#263340', backgroundColor: '#101720' }, reviewFilesContent: { padding: 5, gap: 3 }, reviewFile: { paddingHorizontal: 9, paddingVertical: 8, borderRadius: 7 }, reviewFileActive: { backgroundColor: '#1B2E40' }, reviewFilePath: { color: '#D8E4EF', fontSize: 11, fontWeight: '700' }, reviewFileMeta: { marginTop: 3, color: '#71859A', fontSize: 10 }, diffPreview: { flex: 1, minHeight: 160, borderRadius: 10, borderWidth: 1, borderColor: '#263340', backgroundColor: '#0A0F15' }, diffPreviewContent: { padding: 10 }, diffText: { color: '#B7C9D9', fontFamily: 'monospace', fontSize: 10, lineHeight: 16 },
});
