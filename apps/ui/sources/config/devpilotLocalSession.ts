import * as React from 'react';

import { devpilotServices, isElectronDesktop } from '@/config/devpilotServices';

/**
 * Compatibility boundary for browser-only Happier routes.
 *
 * The Electron desktop does not persist runtime identities in browser storage:
 * projects and conversations belong to the Python runtime.  Returning null
 * also retires stale local-session records created by earlier previews.
 */
export type DevPilotLocalSession = Readonly<{
    projectPath: string;
    conversationId: string | null;
    connectedAt: number;
}>;

export function isLocalDevPilotDesktopMode(): boolean {
    return isElectronDesktop() && !devpilotServices.hostedServicesEnabled;
}

export function readDevPilotLocalSession(): DevPilotLocalSession | null {
    return null;
}

export function writeDevPilotLocalSession(_session: DevPilotLocalSession): void {
    // Project/conversation persistence is owned by devpilot.sdk.
}

export function clearDevPilotLocalSession(): void {
    // No renderer-owned runtime session record remains.
}

export function useDevPilotLocalSession(): DevPilotLocalSession | null {
    return React.useMemo(() => null, []);
}
