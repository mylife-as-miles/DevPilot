import { describe, expect, it } from 'vitest';

import {
    buildDevPilotSessionListViewData,
    mapDevPilotChangesToScmSnapshot,
    mapDevPilotMessageToHappierMessage,
} from './selectors';
import type {
    DevPilotConversation,
    DevPilotDesktopState,
    DevPilotProject,
    LocalGitChanges,
} from './types';

const projectAlpha: DevPilotProject = {
    projectId: 'project-alpha',
    name: 'Alpha',
    path: 'C:\\work\\Alpha',
    createdAt: 1_000,
    lastOpenedAt: 1_000,
};

const projectBeta: DevPilotProject = {
    projectId: 'project-beta',
    name: 'Beta',
    path: 'C:\\work\\Beta',
    createdAt: 1_000,
    lastOpenedAt: 1_000,
};

function conversation(
    partial: Partial<DevPilotConversation> & Pick<DevPilotConversation, 'conversationId' | 'projectId' | 'state'>,
): DevPilotConversation {
    return {
        title: partial.conversationId,
        createdAt: 1_000,
        updatedAt: 1_000,
        provider: 'codex',
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        sandbox: 'workspace-write',
        pinned: false,
        archived: false,
        activeRunId: null,
        lastError: null,
        ...partial,
    };
}

function state(partial: Partial<DevPilotDesktopState> = {}): DevPilotDesktopState {
    return {
        initialized: true,
        authenticated: true,
        runtimeReady: true,
        projects: {
            [projectAlpha.projectId]: projectAlpha,
            [projectBeta.projectId]: projectBeta,
        },
        conversations: {},
        messagesByConversation: {},
        eventsByConversation: {},
        selectedProjectId: null,
        selectedConversationId: null,
        models: [],
        selectedModel: null,
        reasoningEffort: 'high',
        sandboxMode: 'workspace-write',
        changesByProject: {},
        selectedChangedFile: null,
        selectedDiff: null,
        diffByProjectPath: {},
        loading: {
            projects: false,
            conversations: false,
            conversation: false,
            review: false,
        },
        error: null,
        ...partial,
    };
}

describe('DevPilot renderer selectors', () => {
    it('groups native conversations into Happier session-list sections without server identities', () => {
        const list = buildDevPilotSessionListViewData(state({
            conversations: {
                attention: conversation({
                    conversationId: 'attention',
                    projectId: 'project-alpha',
                    state: 'needs_attention',
                    lastError: 'approval required',
                    updatedAt: 4_000,
                }),
                working: conversation({
                    conversationId: 'working',
                    projectId: 'project-alpha',
                    state: 'working',
                    activeRunId: 'run-1',
                    updatedAt: 3_000,
                }),
                pinned: conversation({
                    conversationId: 'pinned',
                    projectId: 'project-beta',
                    state: 'completed',
                    pinned: true,
                    updatedAt: 2_000,
                }),
                recent: conversation({
                    conversationId: 'recent',
                    projectId: 'project-beta',
                    state: 'completed',
                    updatedAt: 1_000,
                }),
                archived: conversation({
                    conversationId: 'archived',
                    projectId: 'project-beta',
                    state: 'completed',
                    archived: true,
                    updatedAt: 5_000,
                }),
            },
        }));

        expect(list?.map((item) => item.type === 'header' ? item.title : item.session.id)).toEqual([
            'Needs Attention',
            'attention',
            'Working',
            'working',
            'Pinned',
            'pinned',
            'Recent',
            'recent',
        ]);

        const rows = list?.filter((item): item is Extract<NonNullable<typeof list>[number], { type: 'session' }> => item.type === 'session') ?? [];
        expect(rows.every((row) => !('serverId' in row.session))).toBe(true);
        expect(rows.map((row) => row.session.metadata?.path)).toEqual([
            'C:\\work\\Alpha',
            'C:\\work\\Alpha',
            'C:\\work\\Beta',
            'C:\\work\\Beta',
        ]);
    });

    it('maps stored DevPilot messages into Happier transcript message models', () => {
        expect(mapDevPilotMessageToHappierMessage({
            messageId: 'message-user',
            turnId: 'turn-1',
            role: 'user',
            text: 'Run the tests',
            kind: 'message',
            createdAt: 2,
        })).toMatchObject({
            kind: 'user-text',
            id: 'message-user',
            text: 'Run the tests',
            createdAt: 2_000,
        });

        expect(mapDevPilotMessageToHappierMessage({
            messageId: 'message-thinking',
            turnId: 'turn-1',
            role: 'assistant',
            text: 'Inspecting project context',
            kind: 'thinking',
            createdAt: 3,
        })).toMatchObject({
            kind: 'agent-text',
            id: 'message-thinking',
            isThinking: true,
            createdAt: 3_000,
        });
    });

    it('maps native changes.list output to the read-only Happier review snapshot shape', () => {
        const changes: LocalGitChanges = {
            available: true,
            repository: 'C:\\work\\Alpha',
            branch: 'main',
            dirty: true,
            issue: null,
            files: [
                {
                    path: 'src/app.ts',
                    status: 'modified',
                    additions: 10,
                    deletions: 3,
                    included: true,
                    pending: false,
                },
                {
                    path: 'README.md',
                    status: 'untracked',
                    additions: 2,
                    deletions: 0,
                    included: false,
                    pending: true,
                },
            ],
        };

        const snapshot = mapDevPilotChangesToScmSnapshot('project-alpha', changes);

        expect(snapshot?.repo.backendId).toBe('git');
        expect(snapshot?.branch.head).toBe('main');
        expect(snapshot?.capabilities?.writeCommit).toBe(false);
        expect(snapshot?.entries.map((entry) => [entry.path, entry.kind, entry.hasIncludedDelta, entry.hasPendingDelta])).toEqual([
            ['src/app.ts', 'modified', true, false],
            ['README.md', 'untracked', false, true],
        ]);
        expect(snapshot?.totals).toMatchObject({
            includedFiles: 1,
            pendingFiles: 1,
            includedAdded: 10,
            includedRemoved: 3,
            pendingAdded: 2,
        });
    });
});
