import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getDesktopClient, type RuntimeStatus } from '@devpilot/desktop/client';

import { Text } from '@/components/ui/text/Text';

const bridge = getDesktopClient;

export const LocalDevPilotWelcome = React.memo(function LocalDevPilotWelcome() {
    const { theme } = useUnistyles();
    const [status, setStatus] = React.useState<RuntimeStatus | null>(null);
    const [projectPath, setProjectPath] = React.useState<string | null>(null);
    const [message, setMessage] = React.useState('Checking the local DevPilot runtime…');

    const refresh = React.useCallback(async () => {
        const desktop = bridge();
        if (!desktop) return;
        const next = await desktop.getRuntimeStatus();
        setStatus(next);
        setMessage(next.ready ? 'DevPilot is ready on this computer.' : (next.issue ?? 'DevPilot was not found.'));
    }, []);

    React.useEffect(() => { void refresh(); }, [refresh]);

    const chooseProject = React.useCallback(async () => {
        const selected = await bridge()?.selectProject();
        if (selected) setProjectPath(selected);
    }, []);

    const launch = React.useCallback(async () => {
        if (!projectPath) return void chooseProject();
        const result = await bridge()?.launchAcp(projectPath);
        if (result) setMessage(`ACP is running for ${projectPath}. Start a Research Run to begin.`);
    }, [chooseProject, projectPath]);

    return (
        <View style={[styles.root, { backgroundColor: theme.colors.background.canvas }]}>
            <View style={[styles.card, { backgroundColor: theme.colors.surface.base, borderColor: theme.colors.border.default }]}>
                <View style={styles.icon}><Ionicons name="flask-outline" size={28} color="#22A7F0" /></View>
                <Text style={[styles.title, { color: theme.colors.text.primary }]}>Set up DevPilot locally</Text>
                <Text style={[styles.body, { color: theme.colors.text.secondary }]}>{message}</Text>
                {status?.ready ? <Text style={[styles.meta, { color: theme.colors.text.tertiary }]}>{status.command} · {status.version ?? 'version verified'}</Text> : null}
                <Pressable onPress={refresh} style={[styles.secondary, { borderColor: theme.colors.border.default }]}>
                    <Text style={[styles.buttonText, { color: theme.colors.text.primary }]}>Retry detection</Text>
                </Pressable>
                {status?.ready ? <>
                    <Pressable onPress={chooseProject} style={[styles.secondary, { borderColor: theme.colors.border.default }]}>
                        <Text style={[styles.buttonText, { color: theme.colors.text.primary }]}>{projectPath ? 'Change local project' : 'Select local project'}</Text>
                    </Pressable>
                    <Pressable onPress={launch} style={styles.primary}>
                        <Text style={styles.primaryText}>{projectPath ? 'Launch ACP and start a Research Run' : 'Select a project to continue'}</Text>
                    </Pressable>
                </> : null}
            </View>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 520, alignItems: 'center', gap: 14, padding: 32, borderWidth: 1, borderRadius: 18 },
    icon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#22A7F018' },
    title: { fontSize: 26, fontWeight: '700' },
    body: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
    meta: { fontSize: 12, textAlign: 'center' },
    secondary: { width: '100%', alignItems: 'center', paddingVertical: 11, borderWidth: 1, borderRadius: 10 },
    primary: { width: '100%', alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: '#0A84FF' },
    buttonText: { fontSize: 14, fontWeight: '600' },
    primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
}));
