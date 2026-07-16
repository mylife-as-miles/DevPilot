import * as React from 'react';
import { Animated } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

import { DevPilotCapabilityRow } from './DevPilotCapabilityRow';

describe('DevPilotCapabilityRow', () => {
    it('renders the four DevPilot capabilities', async () => {
        const screen = await renderScreen(<DevPilotCapabilityRow />);
        expect(screen.findByTestId('devpilot-capability-row')).toBeTruthy();
        for (const capability of ['hypotheses', 'executors', 'evidence', 'git']) {
            expect(screen.findByTestId(`devpilot-capability-${capability}`)).toBeTruthy();
        }
    });

    it('exposes a descriptive accessibility label without provider claims', async () => {
        const screen = await renderScreen(<DevPilotCapabilityRow />);
        const root = screen.findByTestId('devpilot-capability-row');
        expect(root?.props.accessibilityLabel).toContain('Hypotheses');
        expect(root?.props.accessibilityLabel).not.toContain('provider');
    });

    it('does not render any Animated.View', async () => {
        const screen = await renderScreen(<DevPilotCapabilityRow />);
        expect(screen.findAllByType(Animated.View).length).toBe(0);
    });
});
