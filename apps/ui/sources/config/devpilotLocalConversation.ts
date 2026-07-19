import * as React from 'react';

import { useEnsureDevPilotDesktopInitialized } from '@/devpilot/domain/hooks';
import {
    cancelSelectedDevPilotConversation,
    ensureDevPilotDesktopInitialized,
    getDevPilotDesktopState,
    isKnownDevPilotConversationId,
    selectDevPilotConversation,
    sendDevPilotConversationMessage,
} from '@/devpilot/domain/store';
import { isLocalDevPilotDesktopMode } from '@/config/devpilotLocalSession';

export const DEVPILOT_LOCAL_SERVER_ID = 'devpilot-local-ui';

function readConversationId(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const candidate = value as Record<string, unknown>;
    const id = candidate.id ?? candidate.sessionId ?? candidate.conversationId;
    return typeof id === 'string' ? id.trim() : '';
}

export function isDevPilotLocalConversation(session: unknown): boolean {
    if (!isLocalDevPilotDesktopMode()) return false;
    const conversationId = readConversationId(session);
    return conversationId.length > 0 && isKnownDevPilotConversationId(conversationId);
}

export function isDevPilotLocalConversationRoute(sessionId: string, _local: unknown): boolean {
    const normalized = sessionId.trim();
    return isLocalDevPilotDesktopMode() && normalized.length > 0 && isKnownDevPilotConversationId(normalized);
}

export function ensureDevPilotLocalConversationSeeded(local: unknown): string | null {
    const conversationId = readConversationId(local);
    return conversationId.length > 0 && isKnownDevPilotConversationId(conversationId) ? conversationId : null;
}

export function useDevPilotLocalConversationBridge(local: unknown): void {
    const conversationId = ensureDevPilotLocalConversationSeeded(local);
    React.useEffect(() => {
        if (!conversationId) return;
        void ensureDevPilotDesktopInitialized(true).then(() => selectDevPilotConversation(conversationId));
    }, [conversationId]);
}

export function useDevPilotConversationWorkspaceBridge(enabled: boolean): void {
    useEnsureDevPilotDesktopInitialized(enabled);
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
