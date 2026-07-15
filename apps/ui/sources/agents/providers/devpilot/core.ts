import type { AgentCoreConfig } from '@/agents/registry/registryCore';
import { buildCatalogProviderCliUiConfig } from '@/agents/providers/shared/buildCatalogProviderCliUiConfig';
import { buildAgentConnectedServicesUiConfig } from '@/agents/registry/buildAgentConnectedServicesUiConfig';
import { buildAgentLocalControlUiConfig } from '@/agents/registry/buildAgentLocalControlUiConfig';
import { buildAgentResumeUiConfig } from '@/agents/registry/buildAgentResumeUiConfig';
import { buildAgentSessionStorageUiConfig } from '@/agents/registry/buildAgentSessionStorageUiConfig';
import { buildAgentToolsUiConfig } from '@/agents/registry/buildAgentToolsUiConfig';
import { getAgentModelConfig, getAgentSessionModesKind } from '@happier-dev/agents';

export const DEVPILOT_CORE: AgentCoreConfig = {
    id: 'devpilot',
    displayNameKey: 'agentInput.agent.devpilot',
    subtitleKey: 'profiles.aiBackend.devpilotSubtitle',
    permissionModeI18nPrefix: 'agentInput.codexPermissionMode',
    availability: { experimental: false },
    connectedServices: buildAgentConnectedServicesUiConfig({ agentId: 'devpilot' }),
    uiConnectedService: { serviceId: null, label: 'DevPilot', connectRoute: null },
    flavorAliases: ['devpilot', 'dev-pilot'],
    cli: buildCatalogProviderCliUiConfig('devpilot'),
    permissions: { modeGroup: 'codexLike', promptProtocol: 'codexDecision' },
    sessionModes: { kind: getAgentSessionModesKind('devpilot') },
    model: getAgentModelConfig('devpilot'),
    resume: buildAgentResumeUiConfig({
        agentId: 'devpilot',
        uiVendorResumeIdLabelKey: null,
        uiVendorResumeIdCopiedKey: null,
    }),
    localControl: buildAgentLocalControlUiConfig({ agentId: 'devpilot' }),
    toolRendering: { hideUnknownToolsByDefault: false },
    tools: buildAgentToolsUiConfig({ agentId: 'devpilot' }),
    sessionStorage: buildAgentSessionStorageUiConfig({ agentId: 'devpilot' }),
    ui: {
        agentPickerIconName: 'git-network-outline',
        cliGlyphScale: 1.0,
        profileCompatibilityGlyphScale: 1.0,
    },
};
