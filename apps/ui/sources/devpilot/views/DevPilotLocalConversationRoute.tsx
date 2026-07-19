import { Ionicons, Octicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { DEFAULT_AGENT_ID } from '@/agents/catalog/catalog';
import { AgentInput } from '@/components/sessions/agentInput';
import { AgentContentView } from '@/components/sessions/transcript/AgentContentView';
import { MessageView } from '@/components/sessions/transcript/MessageView';
import { ChangedFilesReview } from '@/components/sessions/files/content/ChangedFilesReview';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import {
    devPilotDesktopActions,
    useDevPilotReviewViewModel,
    useDevPilotSelectedConversationViewModel,
} from '@/devpilot/domain/hooks';
import {
    ensureDevPilotDesktopInitialized,
    getDevPilotDesktopState,
    selectDevPilotConversation,
} from '@/devpilot/domain/store';
import {
    mapDevPilotChangedFileToScmFileStatus,
} from '@/devpilot/domain/selectors';
import {
    mapPermissionModeToSandbox,
    mapSandboxToPermissionMode,
} from '@/devpilot/domain/status';
import type { DevPilotRuntimeActivity, RuntimeModel } from '@/devpilot/domain/types';
import type { ModelOption } from '@/sync/domains/models/modelOptions';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import type { Metadata } from '@/sync/domains/state/storageTypes';
import type { Message } from '@/sync/domains/messages/messageTypes';
import type { AcpConfigOption } from '@/sync/acp/configOptionsControl';

type DevPilotLocalConversationRouteProps = Readonly<{
    conversationId?: string | null;
}>;

const styles = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        minHeight: 0,
        flexDirection: 'row',
        backgroundColor: theme.colors.surface.base,
    },
    conversationPane: {
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        borderRightWidth: 1,
        borderRightColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
    },
    reviewPane: {
        width: 420,
        minWidth: 320,
        maxWidth: 520,
        minHeight: 0,
        backgroundColor: theme.colors.surface.base,
    },
    header: {
        height: 64,
        paddingHorizontal: 24,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        backgroundColor: theme.colors.surface.base,
    },
    headerTitle: {
        color: theme.colors.text.primary,
        fontSize: 18,
        lineHeight: 24,
        ...Typography.default('semiBold'),
    },
    headerSubtitle: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        lineHeight: 18,
        ...Typography.default(),
    },
    statusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: theme.colors.surface.inset,
    },
    statusText: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    greenDot: {
        width: 7,
        height: 7,
        borderRadius: 999,
        backgroundColor: theme.colors.state.success.foreground,
    },
    amberDot: {
        width: 7,
        height: 7,
        borderRadius: 999,
        backgroundColor: theme.colors.state.warning.foreground,
    },
    transcriptScroll: {
        flex: 1,
        minHeight: 0,
    },
    transcriptContent: {
        width: '100%',
        maxWidth: 860,
        alignSelf: 'center',
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 36,
        gap: 8,
    },
    centeredState: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        gap: 16,
    },
    centeredIcon: {
        opacity: 0.75,
    },
    emptyTitle: {
        color: theme.colors.text.primary,
        fontSize: 22,
        lineHeight: 28,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    emptyBody: {
        color: theme.colors.text.secondary,
        fontSize: 15,
        lineHeight: 22,
        maxWidth: 500,
        textAlign: 'center',
        ...Typography.default(),
    },
    primaryAction: {
        marginTop: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 11,
        backgroundColor: theme.colors.button.primary.background,
    },
    primaryActionText: {
        color: theme.colors.button.primary.tint,
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    composerOuter: {
        paddingHorizontal: 20,
        paddingBottom: 18,
        paddingTop: 8,
        backgroundColor: theme.colors.surface.base,
    },
    errorBar: {
        marginHorizontal: 24,
        marginTop: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: theme.colors.state.danger.background,
    },
    errorText: {
        color: theme.colors.state.danger.foreground,
        fontSize: 13,
        ...Typography.default(),
    },
    reviewHeader: {
        height: 64,
        paddingHorizontal: 18,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: theme.colors.surface.base,
    },
    reviewTitle: {
        color: theme.colors.text.primary,
        fontSize: 16,
        ...Typography.default('semiBold'),
    },
    reviewAction: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
    },
    reviewEmpty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 8,
    },
    reviewEmptyTitle: {
        color: theme.colors.text.primary,
        fontSize: 15,
        textAlign: 'center',
        ...Typography.default('semiBold'),
    },
    reviewEmptyBody: {
        color: theme.colors.text.secondary,
        fontSize: 13,
        lineHeight: 19,
        textAlign: 'center',
        ...Typography.default(),
    },
}));

function basename(path: string | null | undefined): string {
    const normalized = String(path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? 'Project';
}

function formatStateLabel(state: string | null | undefined, working: boolean): string {
    if (working) return 'Working';
    switch (state) {
        case 'needs_attention':
        case 'awaiting_user':
        case 'awaiting_permission':
            return 'Needs attention';
        case 'failed':
            return 'Failed';
        case 'completed':
            return 'Complete';
        case 'cancelled':
            return 'Cancelled';
        case 'interrupted':
            return 'Interrupted';
        case 'idle':
        default:
            return 'Idle';
    }
}

function buildModelOptions(models: readonly RuntimeModel[], selectedModel: string | null): readonly ModelOption[] {
    const dynamic = models.map((model) => ({
        value: model.id,
        label: model.label || model.id,
        description: 'Codex model from the local DevPilot runtime.',
    }));
    if (dynamic.length > 0) return dynamic;
    return [
        {
            value: selectedModel ?? 'codex',
            label: selectedModel ?? 'Codex',
            description: 'Codex model from the local DevPilot runtime.',
        },
    ];
}

function formatReasoningLabel(value: string): string {
    const lower = value.trim().toLowerCase();
    if (lower === 'xhigh' || lower === 'extra-high') return 'XHigh';
    return lower.length > 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : value;
}

function buildReasoningOptions(
    models: readonly RuntimeModel[],
    selectedModel: string | null,
    reasoningEffort: string,
): readonly AcpConfigOption[] {
    const selected = models.find((model) => model.id === selectedModel) ?? models[0] ?? null;
    const efforts = selected?.reasoningEfforts.length ? selected.reasoningEfforts : ['low', 'medium', 'high'];
    return [
        {
            id: 'reasoning_effort',
            name: 'Reasoning',
            description: 'Controls how much thinking Codex uses for this DevPilot conversation.',
            category: 'Codex',
            type: 'select',
            currentValue: efforts.includes(reasoningEffort) ? reasoningEffort : efforts[0] ?? reasoningEffort,
            options: efforts.map((effort) => ({
                value: effort,
                name: formatReasoningLabel(effort),
                description: `${formatReasoningLabel(effort)} reasoning`,
            })),
        },
    ];
}

function buildMetadata(projectPath: string | null, conversationTitle: string | null): Metadata {
    return ({
        name: conversationTitle ?? 'DevPilot conversation',
        summaryText: conversationTitle ?? 'DevPilot conversation',
        path: projectPath ?? '',
        homeDir: null,
        host: '',
        machineId: null,
        flavor: 'codex',
        directSessionV1: null,
    } as unknown) as Metadata;
}

function activityKind(activity: DevPilotRuntimeActivity): 'tool' | 'command' | 'file' | 'status' {
    if (activity.event.startsWith('tool.')) return 'tool';
    if (activity.event.startsWith('command.')) return 'command';
    if (activity.event.startsWith('file.')) return 'file';
    return 'status';
}

function activityState(activity: DevPilotRuntimeActivity): 'running' | 'completed' | 'error' {
    if (activity.tone === 'error') return 'error';
    if (activity.tone === 'working') return 'running';
    return 'completed';
}

function mapActivityToTranscriptMessage(activity: DevPilotRuntimeActivity): Message | null {
    const kind = activityKind(activity);
    if (kind === 'status') {
        if (!activity.event.startsWith('run.') && activity.event !== 'user.input_required') {
            return null;
        }
        return {
            kind: 'agent-text',
            id: `devpilot-event:${activity.id}`,
            realID: `devpilot-event:${activity.id}`,
            localId: null,
            createdAt: activity.createdAt,
            text: activity.detail ? `${activity.title}\n\n${activity.detail}` : activity.title,
            isThinking: activity.tone === 'working',
        };
    }

    return {
        kind: 'tool-call',
        id: `devpilot-event:${activity.id}`,
        realID: `devpilot-event:${activity.id}`,
        localId: null,
        createdAt: activity.createdAt,
        tool: {
            id: activity.id,
            name: kind === 'command' ? 'Terminal' : kind === 'file' ? 'File' : 'Tool',
            state: activityState(activity),
            input: {
                event: activity.event,
                detail: activity.detail,
            },
            createdAt: activity.createdAt,
            startedAt: activity.createdAt,
            completedAt: activity.tone === 'working' ? null : activity.createdAt,
            description: activity.detail ? `${activity.title}: ${activity.detail}` : activity.title,
            ...(activity.tone === 'error' ? { result: activity.detail ?? activity.title } : {}),
        },
        children: [],
    };
}

function mergeTranscriptMessages(messages: readonly Message[], activities: readonly DevPilotRuntimeActivity[]): readonly Message[] {
    const byId = new Map<string, Message>();
    for (const message of messages) {
        byId.set(message.id, message);
    }
    for (const activity of activities) {
        const mapped = mapActivityToTranscriptMessage(activity);
        if (!mapped) continue;
        if (byId.has(mapped.id)) continue;
        byId.set(mapped.id, mapped);
    }
    return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function DevPilotLocalConversationRoute(props: DevPilotLocalConversationRouteProps) {
    const stylesForTheme = styles;
    const { theme } = useUnistyles();
    const [composerValue, setComposerValue] = React.useState('');
    const conversationVm = useDevPilotSelectedConversationViewModel(true);
    const reviewVm = useDevPilotReviewViewModel(true);
    const requestedConversationId = String(props.conversationId ?? '').trim();
    const conversation = conversationVm.conversation;
    const project = conversationVm.project;
    const selectedProjectName = project?.name ?? basename(project?.path);
    const sessionId = conversation?.conversationId ?? (requestedConversationId || 'devpilot-local-draft');

    React.useEffect(() => {
        if (!requestedConversationId) return;
        if (conversation?.conversationId === requestedConversationId) return;
        void ensureDevPilotDesktopInitialized(true).then(() => selectDevPilotConversation(requestedConversationId));
    }, [conversation?.conversationId, requestedConversationId]);

    const modelOptions = React.useMemo(
        () => buildModelOptions(conversationVm.state.models, conversationVm.state.selectedModel),
        [conversationVm.state.models, conversationVm.state.selectedModel],
    );
    const reasoningOptions = React.useMemo(
        () => buildReasoningOptions(
            conversationVm.state.models,
            conversationVm.state.selectedModel,
            conversationVm.state.reasoningEffort,
        ),
        [conversationVm.state.models, conversationVm.state.reasoningEffort, conversationVm.state.selectedModel],
    );
    const metadata = React.useMemo(
        () => buildMetadata(project?.path ?? null, conversation?.title ?? null),
        [conversation?.title, project?.path],
    );
    const transcriptMessages = React.useMemo(
        () => mergeTranscriptMessages(conversationVm.messages, conversationVm.events),
        [conversationVm.events, conversationVm.messages],
    );
    const changedFiles = React.useMemo(
        () => (reviewVm.changes?.files ?? []).map(mapDevPilotChangedFileToScmFileStatus),
        [reviewVm.changes?.files],
    );

    const handleOpenFolder = React.useCallback(() => {
        void devPilotDesktopActions.openProjectFolder();
    }, []);
    const handleSend = React.useCallback(() => {
        const text = composerValue.trim();
        if (!text) return;
        setComposerValue('');
        void devPilotDesktopActions.sendMessage(text).then(() => {
            const nextConversationId = getDevPilotDesktopState().selectedConversationId;
            if (!nextConversationId || nextConversationId === requestedConversationId) return;
            router.replace(`/session/${encodeURIComponent(nextConversationId)}` as never);
        }).catch(() => {
            setComposerValue(text);
        });
    }, [composerValue, requestedConversationId]);
    const handleModelChange = React.useCallback((model: string) => {
        devPilotDesktopActions.setModel(model);
    }, []);
    const handlePermissionChange = React.useCallback((mode: PermissionMode) => {
        devPilotDesktopActions.setSandboxMode(mapPermissionModeToSandbox(mode));
    }, []);
    const handleReasoningChange = React.useCallback((configId: string, valueId: string) => {
        if (configId === 'reasoning_effort') devPilotDesktopActions.setReasoningEffort(valueId);
    }, []);
    const handleReviewRefresh = React.useCallback(() => {
        if (!reviewVm.project) return;
        void devPilotDesktopActions.refreshReview(reviewVm.project.projectId);
    }, [reviewVm.project]);
    const handleReviewFilePress = React.useCallback((file: { fullPath: string }) => {
        if (!reviewVm.project) return;
        void devPilotDesktopActions.readDiff(reviewVm.project.projectId, file.fullPath, 'combined');
    }, [reviewVm.project]);
    const autocompleteSuggestions = React.useCallback(async () => [], []);
    const statusLabel = formatStateLabel(conversation?.state, conversationVm.isWorking);
    const selectedModel = conversationVm.state.selectedModel ?? modelOptions[0]?.value ?? 'codex';
    const error = conversationVm.state.error;

    const input = (
        <View style={stylesForTheme.composerOuter}>
            <AgentInput
                value={composerValue}
                placeholder={project ? 'What would you like to work on?' : 'Open a folder to start using DevPilot'}
                onChangeText={setComposerValue}
                sessionId={sessionId}
                onSend={handleSend}
                submitAccessibilityLabel="Send DevPilot prompt"
                permissionMode={mapSandboxToPermissionMode(conversationVm.state.sandboxMode)}
                onPermissionModeChange={handlePermissionChange}
                modelMode={selectedModel}
                onModelModeChange={handleModelChange}
                modelOptionsOverride={modelOptions}
                acpConfigOptionsOverride={reasoningOptions}
                onAcpConfigOptionChange={handleReasoningChange}
                metadata={metadata}
                onAbort={devPilotDesktopActions.cancelSelectedConversation}
                showAbortButton={conversationVm.isWorking}
                connectionStatus={{
                    text: statusLabel,
                    color: theme.colors.text.secondary,
                    dotColor: conversationVm.isWorking
                        ? theme.colors.state.warning.foreground
                        : theme.colors.state.success.foreground,
                    isPulsing: conversationVm.isWorking,
                }}
                autocompletePrefixes={[]}
                autocompleteSuggestions={autocompleteSuggestions}
                isSendDisabled={!project || conversationVm.isWorking}
                currentPath={project?.path ?? null}
                onPathClick={handleOpenFolder}
                agentType={DEFAULT_AGENT_ID}
                agentLabel="Codex"
                panelMaxHeightMode="host-constrained"
            />
        </View>
    );

    let transcriptContent: React.ReactNode;
    if (!conversationVm.state.initialized || conversationVm.state.loading.projects || conversationVm.state.loading.conversations) {
        transcriptContent = (
            <View style={stylesForTheme.centeredState}>
                <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                <Text style={stylesForTheme.emptyBody}>Loading DevPilot projects and conversations…</Text>
            </View>
        );
    } else if (!project) {
        transcriptContent = (
            <View style={stylesForTheme.centeredState}>
                <Octicons name="repo" size={36} color={theme.colors.text.secondary} style={stylesForTheme.centeredIcon} />
                <Text style={stylesForTheme.emptyTitle}>Open a folder to start using DevPilot.</Text>
                <Text style={stylesForTheme.emptyBody}>
                    DevPilot keeps each conversation tied to the project folder you choose.
                </Text>
                <Pressable style={stylesForTheme.primaryAction} onPress={handleOpenFolder}>
                    <Ionicons name="folder-open-outline" size={18} color={theme.colors.button.primary.tint} />
                    <Text style={stylesForTheme.primaryActionText}>Open Folder</Text>
                </Pressable>
            </View>
        );
    } else if (transcriptMessages.length === 0) {
        transcriptContent = (
            <View style={stylesForTheme.centeredState}>
                <Ionicons name="chatbubbles-outline" size={40} color={theme.colors.text.secondary} style={stylesForTheme.centeredIcon} />
                <Text style={stylesForTheme.emptyTitle}>What would you like to work on?</Text>
                <Text style={stylesForTheme.emptyBody}>
                    Ask the first question for {selectedProjectName}. DevPilot creates a conversation only when you send.
                </Text>
            </View>
        );
    } else {
        transcriptContent = (
            <ScrollView
                style={stylesForTheme.transcriptScroll}
                contentContainerStyle={stylesForTheme.transcriptContent}
                keyboardShouldPersistTaps="handled"
            >
                {transcriptMessages.map((message) => (
                    <MessageView
                        key={message.id}
                        message={message}
                        metadata={metadata}
                        sessionId={sessionId}
                    />
                ))}
            </ScrollView>
        );
    }

    return (
        <View style={stylesForTheme.root}>
            <View style={stylesForTheme.conversationPane}>
                <View style={stylesForTheme.header}>
                    <View>
                        <Text style={stylesForTheme.headerTitle}>{conversation?.title ?? 'DevPilot'}</Text>
                        <Text style={stylesForTheme.headerSubtitle}>
                            {project ? `${project.name} · ${project.path}` : 'Choose a project folder'}
                        </Text>
                    </View>
                    <View style={stylesForTheme.statusPill}>
                        <View style={conversationVm.isWorking ? stylesForTheme.amberDot : stylesForTheme.greenDot} />
                        <Text style={stylesForTheme.statusText}>{statusLabel}</Text>
                    </View>
                </View>
                {error ? (
                    <View style={stylesForTheme.errorBar}>
                        <Text style={stylesForTheme.errorText}>{error}</Text>
                    </View>
                ) : null}
                <AgentContentView
                    content={transcriptContent}
                    input={input}
                    safeAreaBottom={0}
                />
            </View>
            <View style={stylesForTheme.reviewPane}>
                <View style={stylesForTheme.reviewHeader}>
                    <Text style={stylesForTheme.reviewTitle}>Review</Text>
                    <Pressable style={stylesForTheme.reviewAction} onPress={handleReviewRefresh}>
                        <Ionicons name="refresh-outline" size={20} color={theme.colors.text.secondary} />
                    </Pressable>
                </View>
                {!reviewVm.project ? (
                    <View style={stylesForTheme.reviewEmpty}>
                        <Text style={stylesForTheme.reviewEmptyTitle}>No project selected</Text>
                        <Text style={stylesForTheme.reviewEmptyBody}>Open a folder to inspect its local Git status and changes.</Text>
                    </View>
                ) : reviewVm.loading && !reviewVm.snapshot ? (
                    <View style={stylesForTheme.reviewEmpty}>
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                        <Text style={stylesForTheme.reviewEmptyBody}>Loading project changes…</Text>
                    </View>
                ) : changedFiles.length === 0 ? (
                    <View style={stylesForTheme.reviewEmpty}>
                        <Octicons name="git-pull-request" size={28} color={theme.colors.text.secondary} />
                        <Text style={stylesForTheme.reviewEmptyTitle}>No changes in this project.</Text>
                        <Text style={stylesForTheme.reviewEmptyBody}>DevPilot will show file changes here as Codex works.</Text>
                    </View>
                ) : (
                    <ChangedFilesReview
                        theme={theme}
                        sessionId={sessionId}
                        snapshot={reviewVm.snapshot}
                        changedFilesViewMode="repository"
                        attributionReliability="high"
                        allRepositoryChangedFiles={changedFiles}
                        turnAttributedFiles={[]}
                        turnRepositoryOnlyFiles={[]}
                        sessionAttributedFiles={[]}
                        repositoryOnlyFiles={changedFiles}
                        suppressedInferredCount={0}
                        maxFiles={200}
                        maxChangedLines={20_000}
                        onFilePress={handleReviewFilePress}
                        rowDensity="compact"
                        providerDiffByPath={reviewVm.providerDiffByPath}
                        reviewCommentsEnabled={false}
                    />
                )}
            </View>
        </View>
    );
}
