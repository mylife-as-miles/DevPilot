import type { ConversationState, SandboxMode } from './types';

export const DEVPILOT_ATTENTION_STATES = new Set<ConversationState>([
    'needs_attention',
    'awaiting_user',
    'awaiting_permission',
    'failed',
]);

export const DEVPILOT_WORKING_STATES = new Set<ConversationState>([
    'starting',
    'working',
    'resuming',
    'cancelling',
]);

export const DEVPILOT_RECENT_STATES = new Set<ConversationState>([
    'idle',
    'completed',
    'cancelled',
    'interrupted',
]);

export function isDevPilotWorkingState(state: ConversationState | null | undefined): boolean {
    return Boolean(state && DEVPILOT_WORKING_STATES.has(state));
}

export function isDevPilotAttentionState(state: ConversationState | null | undefined): boolean {
    return Boolean(state && DEVPILOT_ATTENTION_STATES.has(state));
}

export function normalizeDevPilotSandboxMode(value: unknown): SandboxMode {
    return value === 'read-only' || value === 'full-access' || value === 'workspace-write'
        ? value
        : 'workspace-write';
}

export function mapSandboxToPermissionMode(value: SandboxMode): 'read-only' | 'safe-yolo' | 'yolo' {
    switch (value) {
        case 'read-only':
            return 'read-only';
        case 'full-access':
            return 'yolo';
        case 'workspace-write':
        default:
            return 'safe-yolo';
    }
}

export function mapPermissionModeToSandbox(value: string): SandboxMode {
    switch (value) {
        case 'read-only':
            return 'read-only';
        case 'yolo':
            return 'full-access';
        case 'safe-yolo':
        case 'default':
        default:
            return 'workspace-write';
    }
}
