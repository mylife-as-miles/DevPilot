import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { Message } from '@/sync/domains/messages/messageTypes';
import type { ScmWorkingEntry, ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import type { ScmFileStatus } from '@/scm/scmStatusFiles';

import type {
    ChangedFile,
    ConversationMessage,
    DevPilotConversation,
    DevPilotConversationGroup,
    DevPilotConversationRowModel,
    DevPilotDesktopState,
    DevPilotProject,
    LocalGitChanges,
} from './types';
import { isDevPilotAttentionState, isDevPilotWorkingState } from './status';

const GROUPS: ReadonlyArray<Readonly<{
    id: DevPilotConversationGroup;
    title: string;
    headerKind: Extract<SessionListViewItem, { type: 'header' }>['headerKind'];
    groupKind: Extract<SessionListViewItem, { type: 'session' }>['groupKind'];
    section: Extract<SessionListViewItem, { type: 'session' }>['section'];
}>> = Object.freeze([
    { id: 'attention', title: 'Needs Attention', headerKind: 'attention', groupKind: 'attention', section: 'active' },
    { id: 'working', title: 'Working', headerKind: 'working', groupKind: 'working', section: 'active' },
    { id: 'pinned', title: 'Pinned', headerKind: 'pinned', groupKind: 'pinned', section: 'inactive' },
    { id: 'recent', title: 'Recent', headerKind: 'sessions', groupKind: 'date', section: 'inactive' },
]);

function normalizeTimestampMs(value: unknown): number {
    const raw = typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
    return raw > 0 && raw < 10_000_000_000 ? Math.trunc(raw * 1000) : Math.trunc(raw);
}

function compareUpdatedDesc(a: DevPilotConversation, b: DevPilotConversation): number {
    const updatedDelta = normalizeTimestampMs(b.updatedAt) - normalizeTimestampMs(a.updatedAt);
    if (updatedDelta !== 0) return updatedDelta;
    return String(a.conversationId).localeCompare(String(b.conversationId));
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

export function classifyDevPilotConversation(conversation: DevPilotConversation): DevPilotConversationGroup {
    if (isDevPilotAttentionState(conversation.state)) return 'attention';
    if (isDevPilotWorkingState(conversation.state)) return 'working';
    if (conversation.pinned) return 'pinned';
    return 'recent';
}

export function buildDevPilotConversationRowModel(
    state: DevPilotDesktopState,
    conversation: DevPilotConversation,
): DevPilotConversationRowModel {
    const project = projectForConversation(state, conversation);
    const projectName = project?.name || (project?.path ? basename(project.path) : 'Project');
    const projectPath = project?.path ?? '';
    return {
        id: conversation.conversationId,
        title: conversation.title || 'New conversation',
        subtitle: projectPath || projectName,
        status: conversation.state,
        pinned: conversation.pinned,
        updatedAt: normalizeTimestampMs(conversation.updatedAt),
        projectId: conversation.projectId,
        projectName,
        projectPath,
        model: conversation.model,
        reasoningEffort: conversation.reasoningEffort,
        requiresAttention: isDevPilotAttentionState(conversation.state),
    };
}

function buildRenderableSession(
    state: DevPilotDesktopState,
    conversation: DevPilotConversation,
): SessionListRenderableSession {
    const row = buildDevPilotConversationRowModel(state, conversation);
    const active = isDevPilotWorkingState(conversation.state) || isDevPilotAttentionState(conversation.state);
    const thinking = isDevPilotWorkingState(conversation.state);
    const updatedAt = row.updatedAt;
    const createdAt = normalizeTimestampMs(conversation.createdAt);
    const lastError = conversation.lastError;
    return {
        id: conversation.conversationId,
        seq: updatedAt,
        createdAt,
        updatedAt,
        meaningfulActivityAt: updatedAt,
        active,
        activeAt: updatedAt,
        archivedAt: conversation.archived ? updatedAt : null,
        pendingVersion: 0,
        pendingCount: 0,
        lastViewedSessionSeq: updatedAt,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: {
            name: row.title,
            summaryText: row.title,
            path: row.projectPath,
            homeDir: null,
            host: null,
            machineId: null,
            flavor: 'codex',
            directSessionV1: null,
            readStateV1: {
                v: 1,
                sessionSeq: updatedAt,
                pendingActivityAt: 0,
                updatedAt,
            },
        },
        thinking,
        thinkingAt: thinking ? updatedAt : 0,
        presence: active ? 'online' : updatedAt,
        latestTurnId: conversation.activeRunId,
        latestTurnStatus: null,
        latestTurnStatusObservedAt: active ? updatedAt : null,
        lastRuntimeIssue: lastError
            ? {
                v: 1,
                kind: 'provider',
                message: lastError,
                observedAt: updatedAt,
            } as any
            : null,
        latestReadyEventSeq: updatedAt,
        latestReadyEventAt: updatedAt,
        optimisticThinkingAt: thinking ? updatedAt : null,
        thinkingGraceUntil: null,
        owner: 'DevPilot',
        accessLevel: 'admin',
        canApprovePermissions: conversation.state === 'awaiting_permission',
        hasPendingPermissionRequests: conversation.state === 'awaiting_permission',
        hasPendingUserActionRequests: conversation.state === 'awaiting_user' || conversation.state === 'needs_attention',
        pendingRequestObservedAt: isDevPilotAttentionState(conversation.state) ? updatedAt : null,
        hasUnreadMessages: false,
        keepVisibleWhenInactive: true,
        metadataUnavailable: false,
    };
}

function buildSessionListItem(
    state: DevPilotDesktopState,
    conversation: DevPilotConversation,
    group: (typeof GROUPS)[number],
): Extract<SessionListViewItem, { type: 'session' }> {
    return {
        type: 'session',
        session: buildRenderableSession(state, conversation),
        section: group.section,
        groupKey: `devpilot:${group.id}`,
        groupKind: group.groupKind,
        pinned: conversation.pinned,
        attentionPromotionReason: group.id === 'attention' ? 'pending' as any : undefined,
        workingPlacementReason: group.id === 'working' ? 'working' : undefined,
        variant: 'default',
    };
}

export function buildDevPilotSessionListViewData(state: DevPilotDesktopState): SessionListViewItem[] | null {
    if (!state.initialized || state.loading.projects || state.loading.conversations) return null;
    const conversations = Object.values(state.conversations)
        .filter((conversation) => !conversation.archived)
        .sort(compareUpdatedDesc);

    const items: SessionListViewItem[] = [];
    for (const group of GROUPS) {
        const grouped = conversations.filter((conversation) => classifyDevPilotConversation(conversation) === group.id);
        if (grouped.length === 0) continue;
        items.push({
            type: 'header',
            title: group.title,
            headerKind: group.headerKind,
            groupKey: `devpilot:${group.id}`,
            sessionCount: grouped.length,
        });
        for (const conversation of grouped) {
            items.push(buildSessionListItem(state, conversation, group));
        }
    }
    return items;
}

export function mapDevPilotMessageToHappierMessage(message: ConversationMessage): Message {
    const createdAt = normalizeTimestampMs(message.createdAt);
    if (message.role === 'user') {
        return {
            kind: 'user-text',
            id: message.messageId,
            realID: message.messageId,
            localId: null,
            createdAt,
            text: message.text,
        };
    }

    return {
        kind: 'agent-text',
        id: message.messageId,
        realID: message.messageId,
        localId: null,
        createdAt,
        text: message.text,
        isThinking: message.kind === 'thinking' || message.role === 'system',
    };
}

function normalizeChangedFileKind(status: string): ScmWorkingEntry['kind'] {
    const lower = status.toLowerCase();
    if (lower.includes('renamed')) return 'renamed';
    if (lower.includes('copied')) return 'copied';
    if (lower.includes('deleted')) return 'deleted';
    if (lower.includes('untracked') || lower === '??') return 'untracked';
    if (lower.includes('added') || lower.includes('new')) return 'added';
    if (lower.includes('conflict')) return 'conflicted';
    return 'modified';
}

export function mapDevPilotChangesToScmSnapshot(
    projectId: string,
    changes: LocalGitChanges | null | undefined,
): ScmWorkingSnapshot | null {
    if (!changes) return null;
    const entries = changes.files.map<ScmWorkingEntry>((file) => {
        const additions = typeof file.additions === 'number' ? Math.max(0, file.additions) : 0;
        const deletions = typeof file.deletions === 'number' ? Math.max(0, file.deletions) : 0;
        return {
            path: file.path,
            previousPath: null,
            kind: normalizeChangedFileKind(file.status),
            includeStatus: file.included ? file.status : '',
            pendingStatus: file.pending ? file.status : '',
            hasIncludedDelta: file.included,
            hasPendingDelta: file.pending,
            stats: {
                includedAdded: file.included ? additions : 0,
                includedRemoved: file.included ? deletions : 0,
                pendingAdded: file.pending ? additions : 0,
                pendingRemoved: file.pending ? deletions : 0,
                isBinary: false,
            },
        };
    });

    return {
        projectKey: projectId,
        fetchedAt: Date.now(),
        repo: {
            isRepo: changes.available,
            rootPath: changes.repository,
            backendId: 'git',
            mode: '.git',
            defaultBranch: null,
            worktrees: [],
            remotes: [],
        },
        capabilities: {
            writeInclude: false,
            writeExclude: false,
            writeDiscard: false,
            writeCommit: false,
            writeRemoteFetch: false,
            writeRemotePull: false,
            writeRemotePush: false,
            changeSetModel: 'working-copy',
            operationLabels: {
                commit: 'Commit',
            },
        } as any,
        branch: {
            head: changes.branch,
            upstream: null,
            ahead: 0,
            behind: 0,
            detached: false,
        },
        stashCount: 0,
        operationState: null,
        hostingProvider: null,
        pullRequest: null,
        hasConflicts: entries.some((entry) => entry.kind === 'conflicted'),
        entries,
        totals: {
            includedFiles: entries.filter((entry) => entry.hasIncludedDelta).length,
            pendingFiles: entries.filter((entry) => entry.hasPendingDelta).length,
            untrackedFiles: entries.filter((entry) => entry.kind === 'untracked').length,
            includedAdded: entries.reduce((sum, entry) => sum + entry.stats.includedAdded, 0),
            includedRemoved: entries.reduce((sum, entry) => sum + entry.stats.includedRemoved, 0),
            pendingAdded: entries.reduce((sum, entry) => sum + entry.stats.pendingAdded, 0),
            pendingRemoved: entries.reduce((sum, entry) => sum + entry.stats.pendingRemoved, 0),
        },
    };
}

export function mapDevPilotChangedFileToScmFileStatus(file: ChangedFile): ScmFileStatus {
    const normalizedPath = file.path.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');
    const fileName = parts.pop() || normalizedPath;
    return {
        fileName,
        filePath: parts.join('/'),
        fullPath: normalizedPath,
        status: normalizeChangedFileKind(file.status),
        isIncluded: file.included,
        linesAdded: typeof file.additions === 'number' ? Math.max(0, file.additions) : 0,
        linesRemoved: typeof file.deletions === 'number' ? Math.max(0, file.deletions) : 0,
        isBinary: false,
    };
}

export function buildDevPilotProviderDiffMap(state: DevPilotDesktopState, projectId: string): ReadonlyMap<string, string> {
    const prefix = `${projectId}\u0000`;
    const entries: Array<[string, string]> = [];
    for (const [key, diff] of Object.entries(state.diffByProjectPath)) {
        if (!key.startsWith(prefix)) continue;
        const path = key.slice(prefix.length);
        entries.push([path, diff]);
    }
    return new Map(entries);
}

export function getSelectedDevPilotProject(state: DevPilotDesktopState): DevPilotProject | null {
    return state.selectedProjectId ? state.projects[state.selectedProjectId] ?? null : null;
}

export function getSelectedDevPilotConversation(state: DevPilotDesktopState): DevPilotConversation | null {
    return state.selectedConversationId ? state.conversations[state.selectedConversationId] ?? null : null;
}
