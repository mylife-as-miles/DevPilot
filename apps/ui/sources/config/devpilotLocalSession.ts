import * as React from 'react';

import { devpilotServices, isElectronDesktop } from '@/config/devpilotServices';
import { getDesktopClient } from '@devpilot/desktop/client';

const LOCAL_SESSION_STORAGE_KEY = 'devpilot.localDesktopSession.v1';
const LOCAL_SESSION_EVENT = 'devpilot:local-session-changed';

export type DevPilotLocalSession = Readonly<{
    mode: 'local-acp';
    projectPath: string;
    acpPid: number;
    acpSessionId: string | null;
    connectedAt: number;
}>;

function storageAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function isLocalDevPilotDesktopMode(): boolean {
    return (isElectronDesktop() || devpilotServices.localDesktopEnabled)
        && !devpilotServices.hostedServicesEnabled;
}

export function readDevPilotLocalSession(): DevPilotLocalSession | null {
    if (!storageAvailable()) return null;
    try {
        const raw = window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DevPilotLocalSession>;
        if (parsed.mode !== 'local-acp') return null;
        if (typeof parsed.projectPath !== 'string' || !parsed.projectPath.trim()) return null;
        if (typeof parsed.acpPid !== 'number' || !Number.isFinite(parsed.acpPid)) return null;
        if (typeof parsed.connectedAt !== 'number' || !Number.isFinite(parsed.connectedAt)) return null;
        return {
            mode: 'local-acp',
            projectPath: parsed.projectPath,
            acpPid: parsed.acpPid,
            acpSessionId: typeof parsed.acpSessionId === 'string' && parsed.acpSessionId.trim()
                ? parsed.acpSessionId
                : null,
            connectedAt: parsed.connectedAt,
        };
    } catch {
        return null;
    }
}

export function writeDevPilotLocalSession(session: DevPilotLocalSession): void {
    if (!storageAvailable()) return;
    window.localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, JSON.stringify(session));
    window.dispatchEvent(new Event(LOCAL_SESSION_EVENT));
}

export function clearDevPilotLocalSession(): void {
    if (!storageAvailable()) return;
    window.localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
    window.dispatchEvent(new Event(LOCAL_SESSION_EVENT));
}

export function useDevPilotLocalSession(): DevPilotLocalSession | null {
    const [session, setSession] = React.useState<DevPilotLocalSession | null>(() => readDevPilotLocalSession());

    React.useEffect(() => {
        if (!storageAvailable()) return undefined;
        const update = () => setSession(readDevPilotLocalSession());
        window.addEventListener(LOCAL_SESSION_EVENT, update);
        window.addEventListener('storage', update);
        update();
        return () => {
            window.removeEventListener(LOCAL_SESSION_EVENT, update);
            window.removeEventListener('storage', update);
        };
    }, []);

    React.useEffect(() => {
        const desktop = getDesktopClient();
        if (!desktop || !isElectronDesktop()) return;
        void desktop.restoreAcp().then((restored) => {
            if (!restored) return;
            writeDevPilotLocalSession({
                mode: 'local-acp',
                projectPath: restored.projectPath,
                acpPid: restored.pid,
                acpSessionId: restored.sessionId,
                connectedAt: Date.now(),
            });
        }).catch(() => {
            // The persisted record is advisory. A missing/moved project simply
            // returns to local setup instead of surfacing stale process state.
        });
    }, []);

    return session;
}
