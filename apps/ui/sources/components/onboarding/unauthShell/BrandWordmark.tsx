import * as React from 'react';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

export type BrandWordmarkProps = Readonly<{
    /** Height in px for the DevPilot mark. Default 32. */
    height?: number;
    testID?: string;
}>;

/**
 * The DevPilot wordmark for the unauthenticated brand pane.
 */
export const BrandWordmark = React.memo(function BrandWordmark(props: BrandWordmarkProps) {
    const { theme } = useUnistyles();
    const height = props.height ?? 32;
    const styles = stylesheet;
    return (
        <View testID={props.testID ?? 'brand-wordmark'} style={styles.root}>
            <Image
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                source={require('@/assets/images/devpilot-bot.png')}
                contentFit="contain"
                style={{ height, width: height }}
            />
            <Text
                style={[
                    Typography.default('semiBold'),
                    styles.label,
                    { color: theme.dark ? '#F8FAFC' : '#0F172A', fontSize: Math.round(height * 0.86) },
                ]}
            >
                DevPilot
            </Text>
        </View>
    );
});

const stylesheet = StyleSheet.create(() => ({
    root: {
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
    },
    label: {
        letterSpacing: -1.1,
    },
}));
