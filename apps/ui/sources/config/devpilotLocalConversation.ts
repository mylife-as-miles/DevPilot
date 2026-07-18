import * as React from 'react';

/**
 * Compatibility boundary for inactive hosted-session routes. The native
 * desktop renders DevPilotDesktopApp directly and never synthesizes a Happier
 * session, machine, account, or transport marker.
 */
export const DEVPILOT_LOCAL_SERVER_ID = 'devpilot-local-ui';

export function isDevPilotLocalConversation(_session: unknown): boolean {
    return false;
}

export function isDevPilotLocalConversationRoute(_sessionId: string, _local: unknown): boolean {
    return false;
}

export function ensureDevPilotLocalConversationSeeded(_local: unknown): string | null {
    return null;
}

export function useDevPilotLocalConversationBridge(_local: unknown): void {
    React.useEffect(() => undefined, []);
}

export function useDevPilotConversationWorkspaceBridge(_enabled: boolean): void {
    React.useEffect(() => undefined, []);
}

export async function submitDevPilotLocalConversationMessage(_sessionId: string, _text: string): Promise<void> {
    throw new Error('Open the DevPilot desktop workspace to send a conversation message.');
}

export async function abortDevPilotLocalConversation(_sessionId: string): Promise<void> {
    throw new Error('Open the DevPilot desktop workspace to stop a conversation run.');
}
