import { describe, expect, it } from 'vitest';

import {
    buildDevPilotModelOptions,
    buildDevPilotReasoningOptions,
} from './composerOptions';
import type { RuntimeModel } from './types';

const models: readonly RuntimeModel[] = [
    {
        id: 'gpt-fast',
        label: 'GPT Fast',
        reasoningEfforts: ['low'],
        defaultReasoningEffort: 'low',
    },
    {
        id: 'gpt-deep',
        label: 'GPT Deep',
        reasoningEfforts: ['medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'high',
    },
];

describe('DevPilot composer options', () => {
    it('populates the model selector from models.list results', () => {
        expect(buildDevPilotModelOptions(models)).toEqual([
            {
                value: 'gpt-fast',
                label: 'GPT Fast',
                description: 'Codex model from the local DevPilot runtime.',
            },
            {
                value: 'gpt-deep',
                label: 'GPT Deep',
                description: 'Codex model from the local DevPilot runtime.',
            },
        ]);
    });

    it('builds reasoning options from the selected model capabilities', () => {
        const [reasoning] = buildDevPilotReasoningOptions(models, 'gpt-deep', 'xhigh');

        expect(reasoning?.id).toBe('reasoning_effort');
        expect(reasoning?.currentValue).toBe('xhigh');
        expect(reasoning?.options?.map((option) => option.value)).toEqual(['medium', 'high', 'xhigh']);
    });

    it('does not invent reasoning options when the runtime reports no capability', () => {
        expect(buildDevPilotReasoningOptions([
            {
                id: 'custom',
                label: 'Custom',
                reasoningEfforts: [],
                defaultReasoningEffort: '',
            },
        ], 'custom', 'high')).toEqual([]);
    });
});
