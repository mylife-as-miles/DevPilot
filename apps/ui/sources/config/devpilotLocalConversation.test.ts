import { describe, expect, it, vi } from 'vitest';

vi.mock('@devpilot/desktop/client', () => ({
    getDesktopClient: () => null,
}));

import {
    buildDevPilotLocalSessionForStorage,
    isDevPilotLocalConversationMetadata,
    mapDevPilotConversationMessagesToNormalizedMessages,
} from './devpilotLocalConversation';
import type { DevPilotDesktopState } from '@/devpilot/domain/types';

function makeState(overrides: Partial<DevPilotDesktopState> = {}): DevPilotDesktopState {
    return {
        initialized: true,
        authenticated: true,
        runtimeReady: true,
        projects: {
            'project-1': {
                projectId: 'project-1',
                name: 'Coal City',
                path: 'C:\\Users\\MILES\\Documents\\Coal City',
                createdAt: 1,
                lastOpenedAt: 2,
            },
        },
        conversations: {},
        messagesByConversation: {},
        eventsByConversation: {},
        selectedProjectId: 'project-1',
        selectedConversationId: 'conversation-1',
        models: [{
            id: 'gpt-5.5',
            label: 'gpt-5.5',
            reasoningEfforts: ['low', 'high'],
            defaultReasoningEffort: 'high',
        }],
        selectedModel: 'gpt-5.5',
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
        ...overrides,
    };
}

describe('devpilotLocalConversation storage bridge', () => {
    it('builds a plain Happier session marked as local DevPilot', () => {
        const session = buildDevPilotLocalSessionForStorage(makeState(), {
            conversationId: 'conversation-1',
            projectId: 'project-1',
            title: 'Map the evidence',
            state: 'working',
            createdAt: 1_000,
            updatedAt: 2_000,
            provider: 'codex',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
            sandbox: 'workspace-write',
            pinned: false,
            archived: false,
            activeRunId: 'run-1',
            lastError: null,
        });

        expect(session.encryptionMode).toBe('plain');
        expect(session.metadata?.flavor).toBe('codex');
        expect(session.metadata?.codexSessionId).toBe('conversation-1');
        expect(session.metadata?.path).toBe('C:\\Users\\MILES\\Documents\\Coal City');
        expect(session.permissionMode).toBe('safe-yolo');
        expect(session.modelMode).toBe('gpt-5.5');
        expect(isDevPilotLocalConversationMetadata(session.metadata)).toBe(true);
    });

    it('normalizes local DevPilot transcript rows for the Happier reducer', () => {
        const messages = mapDevPilotConversationMessagesToNormalizedMessages([
            {
                messageId: 'm-1',
                turnId: 't-1',
                role: 'user',
                text: 'Inspect this repo',
                kind: 'message',
                createdAt: 1_000,
            },
            {
                messageId: 'm-2',
                turnId: 't-1',
                role: 'assistant',
                text: 'I am checking the project.',
                kind: 'thinking',
                createdAt: 2_000,
            },
        ]);

        expect(messages[0]).toMatchObject({
            id: 'm-1',
            role: 'user',
            content: { type: 'text', text: 'Inspect this repo' },
        });
        expect(messages[1]).toMatchObject({
            id: 'm-2',
            role: 'agent',
            content: [{ type: 'thinking', thinking: 'I am checking the project.' }],
        });
    });
});
