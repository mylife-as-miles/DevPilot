import type { AgentUiConfig } from '@/agents/registry/registryUi';

export const DEVPILOT_UI: AgentUiConfig = {
    id: 'devpilot',
    icon: null,
    svgIconXml: null,
    tintColor: (theme) => theme.colors.accent.blue,
    avatarOverlay: {
        circleScale: 0.42,
        iconScale: ({ size }: { size: number }) => Math.round(size * 0.32),
    },
    cliGlyph: 'DP',
};
