import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getDesktopClient, type DevPilotWorkspace } from '@devpilot/desktop/client';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { seedDevPilotLocalWorkspace } from '@/config/devpilotLocalAcpSession';

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        backgroundColor: theme.colors.background.canvas,
    },
    panel: {
        width: '100%',
        maxWidth: 720,
        alignSelf: 'center',
        gap: 16,
    },
    title: {
        color: theme.colors.text.primary,
        fontSize: 26,
        ...Typography.default('semiBold'),
    },
    helper: {
        color: theme.colors.text.secondary,
        fontSize: 15,
        lineHeight: 22,
        ...Typography.default(),
    },
    projectButton: {
        minHeight: 48,
        paddingHorizontal: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        borderRadius: 10,
        justifyContent: 'center',
    },
    projectLabel: {
        color: theme.colors.text.primary,
        fontSize: 14,
        ...Typography.default('semiBold'),
    },
    projectPath: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        marginTop: 2,
        ...Typography.default(),
    },
    input: {
        minHeight: 144,
        padding: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        borderRadius: 10,
        color: theme.colors.text.primary,
        backgroundColor: theme.colors.background.canvas,
        fontSize: 16,
        lineHeight: 23,
        textAlignVertical: 'top',
        ...Typography.default(),
    },
    action: {
        minHeight: 46,
        paddingHorizontal: 18,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.button.primary.background,
    },
    actionDisabled: {
        opacity: 0.55,
    },
    actionText: {
        color: theme.colors.button.primary.tint,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    error: {
        color: theme.colors.text.primary,
        fontSize: 13,
        ...Typography.default(),
    },
}));

function selectedProject(workspace: DevPilotWorkspace | null) {
    if (!workspace) return null;
    return workspace.projects.find((project) => project.id === workspace.selectedProjectId) ?? workspace.projects[0] ?? null;
}

export const DevPilotNewTaskScreen = React.memo(function DevPilotNewTaskScreen(): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const desktop = React.useMemo(() => getDesktopClient(), []);
    const [workspace, setWorkspace] = React.useState<DevPilotWorkspace | null>(null);
    const [prompt, setPrompt] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const project = selectedProject(workspace);

    React.useEffect(() => {
        if (!desktop) return undefined;
        let active = true;
        const apply = (next: DevPilotWorkspace) => {
            if (!active) return;
            setWorkspace(next);
            seedDevPilotLocalWorkspace(next);
        };
        void desktop.getWorkspace().then(apply).catch(() => {
            if (active) setError('DevPilot could not load your projects.');
        });
        const remove = desktop.onWorkspaceChanged(apply);
        return () => {
            active = false;
            remove();
        };
    }, [desktop]);

    const chooseProject = React.useCallback(async () => {
        if (!desktop) return;
        setError(null);
        const next = await desktop.addProject();
        if (!next) return;
        setWorkspace(next);
        seedDevPilotLocalWorkspace(next);
    }, [desktop]);

    const startTask = React.useCallback(async () => {
        if (!desktop || busy) return;
        const text = prompt.trim();
        if (!text) {
            setError('Describe what you would like DevPilot to work on.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            let currentWorkspace = workspace;
            let currentProject = selectedProject(currentWorkspace);
            if (!currentProject) {
                currentWorkspace = await desktop.addProject();
                if (!currentWorkspace) {
                    setBusy(false);
                    return;
                }
                currentProject = selectedProject(currentWorkspace);
            }
            if (!currentProject) throw new Error('Choose a project before starting a task.');
            const created = await desktop.createTask(currentProject.id, { prompt: text });
            seedDevPilotLocalWorkspace(created.workspace);
            router.replace(`/session/${encodeURIComponent(created.task.id)}` as never);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'DevPilot could not start this task.');
        } finally {
            setBusy(false);
        }
    }, [busy, desktop, prompt, router, workspace]);

    return (
        <View style={styles.root}>
            <View style={styles.panel}>
                <Text style={styles.title}>New task</Text>
                <Text style={styles.helper}>Choose a project folder, then describe the work. ACP starts only after you send this first task.</Text>
                <Pressable style={styles.projectButton} onPress={() => { void chooseProject(); }}>
                    <Text style={styles.projectLabel}>{project ? project.name : 'Choose project folder'}</Text>
                    <Text numberOfLines={1} style={styles.projectPath}>{project ? project.path : 'Folders are saved as projects; nothing runs yet.'}</Text>
                </Pressable>
                <TextInput
                    value={prompt}
                    onChangeText={setPrompt}
                    placeholder="What would you like to work on?"
                    placeholderTextColor={theme.colors.text.secondary}
                    multiline
                    style={styles.input}
                    editable={!busy}
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Pressable style={[styles.action, busy ? styles.actionDisabled : null]} disabled={busy} onPress={() => { void startTask(); }}>
                    <Text style={styles.actionText}>{busy ? 'Starting DevPilot...' : 'Start task'}</Text>
                </Pressable>
            </View>
        </View>
    );
});
