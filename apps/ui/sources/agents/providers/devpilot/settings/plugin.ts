import { DEVPILOT_PROVIDER_FIELDS } from '@happier-dev/agents';

import type { ProviderSettingsPlugin } from '@/agents/providers/shared/providerSettingsPlugin';

export const DEVPILOT_PROVIDER_SETTINGS_PLUGIN: ProviderSettingsPlugin = {
    providerId: 'devpilot',
    title: { key: 'settingsProviders.plugins.devpilot.title' },
    icon: { ionName: 'git-network-outline', color: '#2563EB' },
    settings: DEVPILOT_PROVIDER_FIELDS,
    uiSections: [
        {
            id: 'devpilotRuntime',
            title: { key: 'settingsProviders.plugins.devpilot.sections.runtime.title' },
            footer: { key: 'settingsProviders.plugins.devpilot.sections.runtime.footer' },
            fields: [
                {
                    key: 'devpilotExecutablePath',
                    kind: 'text',
                    title: { key: 'settingsProviders.plugins.devpilot.fields.devpilotExecutablePath.title' },
                    subtitle: { key: 'settingsProviders.plugins.devpilot.fields.devpilotExecutablePath.subtitle' },
                },
            ],
        },
    ],
    buildOutgoingMessageMetaExtras: () => ({}),
};
