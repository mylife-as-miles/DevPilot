import * as React from 'react';

import { isElectronDesktop } from '@/config/devpilotServices';
import { isLocalDevPilotDesktopMode } from '@/config/devpilotLocalSession';

const LOCAL_WORKSPACE_STORAGE_KEY = 'devpilot.localWorkspaceActive.v1';
const LOCAL_WORKSPACE_EVENT = 'devpilot:local-workspace-changed';

function storageAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function isDevPilotLocalWorkspaceEnabled(): boolean {
    return (isElectronDesktop() || isLocalDevPilotDesktopMode()) && storageAvailable();
}

export function readDevPilotLocalWorkspaceActive(): boolean {
    if (!storageAvailable()) return false;
    return window.localStorage.getItem(LOCAL_WORKSPACE_STORAGE_KEY) === 'true';
}

export function activateDevPilotLocalWorkspace(): void {
    if (!storageAvailable()) return;
    window.localStorage.setItem(LOCAL_WORKSPACE_STORAGE_KEY, 'true');
    window.dispatchEvent(new Event(LOCAL_WORKSPACE_EVENT));
}

export function useDevPilotLocalWorkspaceActive(): boolean {
    const [active, setActive] = React.useState(readDevPilotLocalWorkspaceActive);

    React.useEffect(() => {
        if (!storageAvailable()) return undefined;
        const update = () => setActive(readDevPilotLocalWorkspaceActive());
        window.addEventListener(LOCAL_WORKSPACE_EVENT, update);
        window.addEventListener('storage', update);
        update();
        return () => {
            window.removeEventListener(LOCAL_WORKSPACE_EVENT, update);
            window.removeEventListener('storage', update);
        };
    }, []);

    return active;
}
