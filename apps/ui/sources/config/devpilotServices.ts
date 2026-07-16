function readBoolean(value: string | undefined): boolean {
    return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function readOptionalUrl(value: string | undefined): string | null {
    const url = String(value ?? '').trim();
    return url || null;
}

/**
 * DevPilot's hosted services are deliberately opt-in for the local desktop
 * milestone. Compatibility environment variables remain supported elsewhere;
 * this configuration is the single product-facing decision point.
 */
export const devpilotServices = Object.freeze({
    apiUrl: readOptionalUrl(process.env.EXPO_PUBLIC_DEVPILOT_API_URL),
    relayUrl: readOptionalUrl(process.env.EXPO_PUBLIC_DEVPILOT_RELAY_URL),
    hostedServicesEnabled: readBoolean(process.env.EXPO_PUBLIC_DEVPILOT_HOSTED_SERVICES),
    localDesktopEnabled: readBoolean(process.env.EXPO_PUBLIC_DEVPILOT_DESKTOP),
});

export function isElectronDesktop(): boolean {
    return typeof globalThis !== 'undefined'
        && typeof (globalThis as { __DEVPILOT_ELECTRON__?: unknown }).__DEVPILOT_ELECTRON__ === 'object';
}
