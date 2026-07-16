import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

import { BRAND_PANE_FOREGROUND_MUTED } from './brandPaneTokens';

type Capability = Readonly<{ label: string; glyph: string }>;

const CAPABILITIES: readonly Capability[] = [
    { label: 'Hypotheses', glyph: '◇' },
    { label: 'Executors', glyph: '▶' },
    { label: 'Evidence', glyph: '▣' },
    { label: 'Git', glyph: '⎇' },
];

export type DevPilotCapabilityRowProps = Readonly<{
    tone?: 'on-dark' | 'on-light';
    justify?: 'flex-start' | 'center';
    testID?: string;
}>;

/** A compact product vocabulary for the DevPilot workspace, not a provider list. */
export const DevPilotCapabilityRow = React.memo(function DevPilotCapabilityRow(props: DevPilotCapabilityRowProps) {
    const { theme } = useUnistyles();
    const tone = props.tone ?? 'on-dark';
    const justify = props.justify ?? 'flex-start';
    const color = tone === 'on-dark' ? BRAND_PANE_FOREGROUND_MUTED : theme.colors.text.secondary;

    return (
        <View
            style={[styles.root, { justifyContent: justify }]}
            testID={props.testID ?? 'devpilot-capability-row'}
            accessibilityLabel="DevPilot capabilities: Hypotheses, Executors, Evidence, and Git"
        >
            {CAPABILITIES.map((capability) => (
                <View key={capability.label} style={styles.item} testID={`devpilot-capability-${capability.label.toLowerCase()}`}>
                    <Text style={[styles.glyph, { color }]} accessibilityElementsHidden>
                        {capability.glyph}
                    </Text>
                    <Text style={[styles.label, { color }]}>{capability.label}</Text>
                </View>
            ))}
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    root: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 14,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    glyph: {
        ...Typography.mono('semiBold'),
        fontSize: 14,
        lineHeight: 16,
    },
    label: {
        ...Typography.default('semiBold'),
        fontSize: 11,
        lineHeight: 16,
        letterSpacing: 0.15,
    },
}));
