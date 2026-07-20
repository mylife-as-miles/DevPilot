export const DEVPILOT_LOCAL_METADATA_MARKER_KEY = 'devpilotLocalV1';

export type DevPilotLocalConversationMarker = Readonly<{
    v: 1;
    provider: 'devpilot';
    mode: 'local-desktop';
}>;

export function buildDevPilotLocalConversationMarker(): DevPilotLocalConversationMarker {
    return {
        v: 1,
        provider: 'devpilot',
        mode: 'local-desktop',
    };
}

export function isDevPilotLocalConversationMetadata(metadata: unknown): boolean {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
    const marker = (metadata as Record<string, unknown>)[DEVPILOT_LOCAL_METADATA_MARKER_KEY];
    return Boolean(
        marker
        && typeof marker === 'object'
        && !Array.isArray(marker)
        && (marker as Record<string, unknown>).v === 1
        && (marker as Record<string, unknown>).provider === 'devpilot'
        && (marker as Record<string, unknown>).mode === 'local-desktop',
    );
}
