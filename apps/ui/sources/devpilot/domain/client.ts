import { getDesktopClient, type DesktopClient } from '@devpilot/desktop/client';

export function readDevPilotDesktopClient(): DesktopClient | null {
    return getDesktopClient();
}

export function getRequiredDevPilotDesktopClient(): DesktopClient {
    const client = readDevPilotDesktopClient();
    if (!client) {
        throw new Error('DevPilot desktop runtime is unavailable.');
    }
    return client;
}

export async function withDevPilotTimeout<T>(
    label: string,
    promise: Promise<T>,
    timeoutMs = 10_000,
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`DevPilot desktop runtime timed out while handling ${label}.`));
        }, Math.max(1_000, timeoutMs));
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}
