import { z } from 'zod';
import { buildSettingArtifacts, type SettingDefinitionMap } from '@happier-dev/protocol';

import type { ProviderSettingsDefinition } from '../types.js';

export function normalizeDevPilotExecutablePath(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function resolveDevPilotSpawnExtrasFromSettings(settings: Readonly<Record<string, unknown>>): Readonly<{
  devpilotExecutablePath?: string;
}> {
  const devpilotExecutablePath = normalizeDevPilotExecutablePath(settings.devpilotExecutablePath);
  return devpilotExecutablePath ? { devpilotExecutablePath } : {};
}

export const DEVPILOT_PROVIDER_FIELDS = {
  devpilotExecutablePath: {
    schema: z.string(),
    default: '',
    description: 'Optional machine-local override for the DevPilot runtime executable path',
    storageScope: 'local',
    analytics: {
      trackCurrentState: true,
      trackChanges: true,
      valueKind: 'presence',
      privacy: 'presence_only',
      identityScope: 'device_user',
      serializeCurrent: (value: string) => normalizeDevPilotExecutablePath(value).length > 0,
    },
  },
} as const satisfies SettingDefinitionMap;

const DEVPILOT_PROVIDER_ARTIFACTS = buildSettingArtifacts(DEVPILOT_PROVIDER_FIELDS);

export const DEVPILOT_PROVIDER_SETTINGS_DEFAULTS = Object.freeze(DEVPILOT_PROVIDER_ARTIFACTS.defaults);

export function buildDevPilotProviderSettingsShape(_zod: typeof z) {
  return DEVPILOT_PROVIDER_ARTIFACTS.shape;
}

export const DEVPILOT_PROVIDER_SETTINGS_DEFINITION: ProviderSettingsDefinition = Object.freeze({
  providerId: 'devpilot',
  fields: DEVPILOT_PROVIDER_ARTIFACTS.definitions,
  buildOutgoingMessageMetaExtras: () => ({}),
  resolveSpawnExtras: ({ settings }) => resolveDevPilotSpawnExtrasFromSettings(settings),
});
