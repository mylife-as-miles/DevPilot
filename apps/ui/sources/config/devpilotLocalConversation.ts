import * as React from 'react';

import { useDevPilotDesktopState, useEnsureDevPilotDesktopInitialized } from '@/devpilot/domain/hooks';
import { buildDevPilotReasoningOptions } from '@/devpilot/domain/composerOptions';
import { mapDevPilotChangesToScmSnapshot } from '@/devpilot/domain/selectors';
import {
    isDevPilotAttentionState,
    isDevPilotWorkingState,
    mapSandboxToPermissionMode,
} from '@/devpilot/domain/status';
import type {
    ConversationMessage,
    DevPilotConversation,
    DevPilotDesktopState,
    DevPilotProject,
    RuntimeModel,
} from '@/devpilot/domain/types';
import {
    cancelSelectedDevPilotConversation,
    ensureDevPilotDesktopInitialized,
    getDevPilotDesktopState,
    isKnownDevPilotConversationId,
    selectDevPilotConversation,
    sendDevPilotConversationMessage,
} from '@/devpilot/domain/store';
import { isLocalDevPilotDesktopMode } from '@/config/devpilotLocalSession';
import { getStorage } from '@/sync/domains/state/storage';
import type { Metadata, Session } from '@/sync/domains/state/storageTypes';
import type { NormalizedMessage } from '@/sync/typesRaw/normalize';
import type { ModelMode } from '@/sync/domains/permissions/permissionTypes';
import {
    buildDevPilotLocalConversationMarker,
    DEVPILOT_LOCAL_METADATA_MARKER_KEY,
    isDevPilotLocalConversationMetadata,
} from '@/config/devpilotLocalConversationMarker';

export {
    DEVPILOT_LOCAL_METADATA_MARKER_KEY,
    isDevPilotLocalConversationMetadata,
} from '@/config/devpilotLocalConversationMarker';

export const DEVPILOT_LOCAL_SERVER_ID = 'devpilot-local-ui';

const LOCAL_AGENT_PROVIDER = 'codex';

function readConversationId(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const candidate = value as Record<string, unknown>;
    const metadata = candidate.metadata;
    const metadataConversationId =
        metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? (metadata as Record<string, unknown>).codexSessionId
            : null;
    const id = candidate.id ?? candidate.sessionId ?? candidate.conversationId ?? metadataConversationId;
    return typeof id === 'string' ? id.trim() : '';
}

function normalizeTimestampMs(value: unknown, fallback = Date.now()): number {
    const raw = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return raw > 0 && raw < 10_000_000_000 ? Math.trunc(raw * 1000) : Math.trunc(raw);
}

function basename(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? path;
}

function projectForConversation(
    state: DevPilotDesktopState,
    conversation: DevPilotConversation,
): DevPilotProject | null {
    return state.projects[conversation.projectId] ?? null;
}

function buildModelListForMetadata(
    models: readonly RuntimeModel[],
    conversation: DevPilotConversation,
): readonly RuntimeModel[] {
    if (models.length > 0) return models;
    return [{
        id: conversation.model,
        label: conversation.model,
        reasoningEfforts: conversation.reasoningEffort ? [conversation.reasoningEffort] : [],
        defaultReasoningEffort: conversation.reasoningEffort,
    }];
}

function cloneDevPilotReasoningOptionsForMetadata(
    options: ReturnType<typeof buildDevPilotReasoningOptions>,
): Array<ReturnType<typeof buildDevPilotReasoningOptions>[number]> {
    return options.map((option) => ({
        ...option,
        options: option.options?.map((child) => ({ ...child })),
    }));
}

function buildDevPilotLocalMetadata(
    state: DevPilotDesktopState,
    conversation: DevPilotConversation,
): Metadata {
    const project = projectForConversation(state, conversation);
    const projectPath = project?.path ?? '';
    const projectName = project?.name || (projectPath ? basename(projectPath) : 'Project');
    const updatedAt = normalizeTimestampMs(conversation.updatedAt);
    const modelList = buildModelListForMetadata(state.models, conversation);
    const currentModelId = conversation.model || state.selectedModel || modelList[0]?.id || '';
    const reasoningOptions = cloneDevPilotReasoningOptionsForMetadata(buildDevPilotReasoningOptions(
        modelList,
        currentModelId,
        conversation.reasoningEffort || state.reasoningEffort,
    ));

    return {
        name: conversation.title || `DevPilot session: ${projectName}`,
        summary: {
            text: conversation.title || projectName,
            updatedAt,
        },
        path: projectPath,
        homeDir: undefined,
        host: '',
        machineId: undefined,
        flavor: LOCAL_AGENT_PROVIDER,
        codexSessionId: conversation.conversationId,
        codexBackendMode: 'appServer',
        permissionMode: mapSandboxToPermissionMode(conversation.sandbox),
        permissionModeUpdatedAt: updatedAt,
        modelOverrideV1: {
            v: 1,
            updatedAt,
            modelId: currentModelId,
        },
        sessionModelsV1: {
            v: 1,
            provider: LOCAL_AGENT_PROVIDER,
            updatedAt,
            currentModelId,
            availableModels: modelList.map((model) => ({
                id: model.id,
                name: model.label || model.id,
                description: 'Codex model from the local DevPilot runtime.',
                modelOptions: cloneDevPilotReasoningOptionsForMetadata(buildDevPilotReasoningOptions(
                    modelList,
                    model.id,
                    model.defaultReasoningEffort || conversation.reasoningEffort,
                )),
            })),
        },
        sessionConfigOptionsV1: {
            v: 1,
            provider: LOCAL_AGENT_PROVIDER,
            updatedAt,
            configOptions: reasoningOptions,
        },
        sessionConfigOptionOverridesV1: {
            v: 1,
            updatedAt,
            overrides: {
                reasoning_effort: {
                    value: conversation.reasoningEffort || state.reasoningEffort,
                    updatedAt,
                },
            },
        },
        readStateV1: {
            v: 1,
            sessionSeq: updatedAt,
            pendingActivityAt: 0,
            updatedAt,
        },
        [DEVPILOT_LOCAL_METADATA_MARKER_KEY]: buildDevPilotLocalConversationMarker(),
    } as Metadata;
}


export function buildDevPilotLocalSessionForStorage(
    state: DevPilotDesktopState,
    conversation: DevPilotConversation,
): Session {
    const updatedAt = normalizeTimestampMs(conversation.updatedAt);
    const createdAt = normalizeTimestampMs(conversation.createdAt, updatedAt);
    const active = isDevPilotWorkingState(conversation.state) || isDevPilotAttentionState(conversation.state);
    const thinking = isDevPilotWorkingState(conversation.state);
    const permissionMode = mapSandboxToPermissionMode(conversation.sandbox);
    const metadata = buildDevPilotLocalMetadata(state, conversation);

    return {
        id: conversation.conversationId,
        seq: updatedAt,
        encryptionMode: 'plain',
        createdAt,
        updatedAt,
        meaningfulActivityAt: updatedAt,
        active,
        activeAt: updatedAt,
        archivedAt: conversation.archived ? updatedAt : null,
        pendingVersion: 0,
        pendingCount: 0,
        lastViewedSessionSeq: updatedAt,
        pendingPermissionRequestCount: conversation.state === 'awaiting_permission' ? 1 : 0,
        pendingUserActionRequestCount: conversation.state === 'awaiting_user' || conversation.state === 'needs_attention' ? 1 : 0,
        pendingRequestObservedAt: isDevPilotAttentionState(conversation.state) ? updatedAt : null,
        latestTurnId: conversation.activeRunId,
        latestTurnStatus: null,
        latestTurnStatusObservedAt: active ? updatedAt : null,
        lastRuntimeIssue: conversation.lastError
            ? {
                v: 1,
                scope: 'primary_session',
                status: 'failed',
                code: 'devpilot_runtime_error',
                source: 'provider_status_error',
                occurredAt: updatedAt,
                sanitizedPreview: conversation.lastError,
            } satisfies NonNullable<Session['lastRuntimeIssue']>
            : null,
        latestReadyEventSeq: updatedAt,
        latestReadyEventAt: updatedAt,
        metadata,
        metadataVersion: updatedAt,
        agentState: {
            controlledByUser: false,
            localControl: {
                attached: true,
                topology: 'exclusive',
                remoteWritable: true,
                canAttach: false,
                canDetach: false,
            },
            capabilities: {
                inFlightSteerSupported: false,
                inFlightSteerAvailable: false,
            },
        },
        agentStateVersion: updatedAt,
        thinking,
        thinkingAt: thinking ? updatedAt : 0,
        presence: active ? 'online' : updatedAt,
        optimisticThinkingAt: thinking ? updatedAt : null,
        thinkingGraceUntil: null,
        permissionMode,
        permissionModeUpdatedAt: updatedAt,
        modelMode: (conversation.model || state.selectedModel || 'default') as ModelMode,
        modelModeUpdatedAt: updatedAt,
        owner: 'DevPilot',
        accessLevel: 'admin',
        canApprovePermissions: conversation.state === 'awaiting_permission',
    };
}

export function mapDevPilotConversationMessagesToNormalizedMessages(
    messages: readonly ConversationMessage[],
): NormalizedMessage[] {
    return messages.map((message, index) => {
        const createdAt = normalizeTimestampMs(message.createdAt);
        const seq = index + 1;
        if (message.role === 'user') {
            return {
                id: message.messageId,
                seq,
                localId: null,
                createdAt,
                role: 'user',
                content: { type: 'text', text: message.text },
                isSidechain: false,
            } satisfies NormalizedMessage;
        }

        return {
            id: message.messageId,
            seq,
            localId: null,
            createdAt,
            role: 'agent',
            content: [{
                type: message.kind === 'thinking' || message.role === 'system' ? 'thinking' : 'text',
                ...(message.kind === 'thinking' || message.role === 'system'
                    ? { thinking: message.text }
                    : { text: message.text }),
                uuid: message.messageId,
                parentUUID: null,
            }],
            isSidechain: false,
        } as NormalizedMessage;
    });
}

export function syncDevPilotLocalConversationsToHappierStorage(state: DevPilotDesktopState): void {
    const storageApi = getStorage().getState();
    const conversations = Object.values(state.conversations).filter((conversation) => !conversation.archived);
    const nextConversationIds = new Set(conversations.map((conversation) => conversation.conversationId));

    for (const session of Object.values(storageApi.sessions)) {
        if (!isDevPilotLocalConversationMetadata(session.metadata)) continue;
        if (nextConversationIds.has(session.id)) continue;
        storageApi.deleteSession(session.id);
    }

    const sessions = conversations.map((conversation) => buildDevPilotLocalSessionForStorage(state, conversation));
    if (sessions.length > 0) {
        storageApi.applySessions(sessions);
    }

    for (const conversation of conversations) {
        const messages = state.messagesByConversation[conversation.conversationId] ?? [];
        storageApi.applyMessages(
            conversation.conversationId,
            mapDevPilotConversationMessagesToNormalizedMessages(messages),
        );
        storageApi.applyMessagesLoaded(conversation.conversationId);

        const changes = state.changesByProject[conversation.projectId] ?? null;
        storageApi.updateSessionProjectScmSnapshot(
            conversation.conversationId,
            mapDevPilotChangesToScmSnapshot(conversation.projectId, changes),
        );
        storageApi.updateSessionProjectScmSnapshotError(conversation.conversationId, null);
    }

    storageApi.applyReady();
}

export function isDevPilotLocalConversation(session: unknown): boolean {
    if (!isLocalDevPilotDesktopMode()) return false;
    if (session && typeof session === 'object' && !Array.isArray(session)) {
        const metadata = (session as Record<string, unknown>).metadata;
        if (isDevPilotLocalConversationMetadata(metadata)) return true;
    }
    const conversationId = readConversationId(session);
    return conversationId.length > 0 && isKnownDevPilotConversationId(conversationId);
}

export function ensureDevPilotLocalConversationSeeded(local: unknown): string | null {
    const conversationId = readConversationId(local);
    return conversationId.length > 0 && isKnownDevPilotConversationId(conversationId) ? conversationId : null;
}

export function useDevPilotLocalConversationBridge(local: unknown): void {
    const conversationId = ensureDevPilotLocalConversationSeeded(local);
    const state = useDevPilotDesktopState();
    useEnsureDevPilotDesktopInitialized(true);

    React.useEffect(() => {
        if (!isLocalDevPilotDesktopMode()) return;
        syncDevPilotLocalConversationsToHappierStorage(state);
    }, [state]);

    React.useEffect(() => {
        if (!conversationId) return;
        void ensureDevPilotDesktopInitialized(true).then(() => selectDevPilotConversation(conversationId));
    }, [conversationId]);
}

export function useDevPilotConversationWorkspaceBridge(enabled: boolean): void {
    const state = useDevPilotDesktopState();
    useEnsureDevPilotDesktopInitialized(enabled);

    React.useEffect(() => {
        if (!enabled || !isLocalDevPilotDesktopMode()) return;
        syncDevPilotLocalConversationsToHappierStorage(state);
    }, [enabled, state]);
}

export async function submitDevPilotLocalConversationMessage(sessionId: string, text: string): Promise<void> {
    await ensureDevPilotDesktopInitialized(true);
    const normalized = sessionId.trim();
    const state = getDevPilotDesktopState();
    if (normalized && state.selectedConversationId !== normalized && state.conversations[normalized]) {
        await selectDevPilotConversation(normalized);
    }
    await sendDevPilotConversationMessage(text);
}

export async function abortDevPilotLocalConversation(sessionId: string): Promise<void> {
    await ensureDevPilotDesktopInitialized(true);
    const normalized = sessionId.trim();
    const state = getDevPilotDesktopState();
    if (normalized && state.selectedConversationId !== normalized && state.conversations[normalized]) {
        await selectDevPilotConversation(normalized);
    }
    await cancelSelectedDevPilotConversation();
}
