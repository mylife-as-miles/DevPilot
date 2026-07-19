import type { AcpConfigOption } from '@/sync/acp/configOptionsControl';
import type { ModelOption } from '@/sync/domains/models/modelOptions';
import type { ModelMode } from '@/sync/domains/permissions/permissionTypes';

import type { RuntimeModel } from './types';

export function buildDevPilotModelOptions(
    models: readonly RuntimeModel[],
): readonly ModelOption[] {
    return models.map((model) => ({
        value: model.id as ModelMode,
        label: model.label || model.id,
        description: 'Codex model from the local DevPilot runtime.',
    }));
}

export function selectDevPilotModelId(
    models: readonly RuntimeModel[],
    selectedModel: string | null,
): ModelMode | undefined {
    const model = selectedModel && models.some((candidate) => candidate.id === selectedModel)
        ? selectedModel
        : models[0]?.id ?? null;
    return model ? model as ModelMode : undefined;
}

export function formatDevPilotReasoningLabel(value: string): string {
    const lower = value.trim().toLowerCase();
    if (lower === 'xhigh' || lower === 'extra-high') return 'XHigh';
    return lower.length > 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : value;
}

export function getDevPilotReasoningEffortsForModel(
    models: readonly RuntimeModel[],
    selectedModel: string | null,
): readonly string[] {
    const selected = models.find((model) => model.id === selectedModel) ?? models[0] ?? null;
    return selected?.reasoningEfforts.length ? selected.reasoningEfforts : [];
}

export function buildDevPilotReasoningOptions(
    models: readonly RuntimeModel[],
    selectedModel: string | null,
    reasoningEffort: string,
): readonly AcpConfigOption[] {
    const efforts = getDevPilotReasoningEffortsForModel(models, selectedModel);
    if (efforts.length === 0) return [];

    return [
        {
            id: 'reasoning_effort',
            name: 'Reasoning',
            description: 'Controls how much thinking Codex uses for this DevPilot conversation.',
            category: 'Codex',
            type: 'select',
            currentValue: efforts.includes(reasoningEffort) ? reasoningEffort : efforts[0]!,
            options: efforts.map((effort) => ({
                value: effort,
                name: formatDevPilotReasoningLabel(effort),
                description: `${formatDevPilotReasoningLabel(effort)} reasoning`,
            })),
        },
    ];
}
