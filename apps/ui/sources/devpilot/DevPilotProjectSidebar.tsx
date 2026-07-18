import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import { getDesktopClient, type DevPilotWorkspace } from '@devpilot/desktop/client';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { seedDevPilotLocalWorkspace } from '@/config/devpilotLocalAcpSession';

const stylesheet = StyleSheet.create((theme) => ({
    root: {
        flex: 1,
        minHeight: 0,
    },
    content: {
        paddingHorizontal: 8,
        paddingBottom: 96,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    empty: {
        paddingHorizontal: 16,
        paddingTop: 24,
        gap: 8,
    },
    emptyTitle: {
        color: theme.colors.text.primary,
        fontSize: 15,
        ...Typography.default('semiBold'),
    },
    emptyBody: {
        color: theme.colors.text.secondary,
        fontSize: 13,
        lineHeight: 19,
        ...Typography.default(),
    },
    project: {
        paddingTop: 14,
        paddingBottom: 4,
    },
    projectName: {
        paddingHorizontal: 8,
        color: theme.colors.text.secondary,
        fontSize: 12,
        ...Typography.default('semiBold'),
    },
    task: {
        minHeight: 38,
        paddingHorizontal: 10,
        borderRadius: 8,
        justifyContent: 'center',
        gap: 2,
    },
    taskActive: {
        backgroundColor: theme.colors.background.canvas,
    },
    taskTitle: {
        color: theme.colors.text.primary,
        fontSize: 14,
        ...Typography.default(),
    },
    taskMeta: {
        color: theme.colors.text.secondary,
        fontSize: 11,
        ...Typography.default(),
    },
    noTasks: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: theme.colors.text.secondary,
        fontSize: 12,
        ...Typography.default(),
    },
}));

function taskStatusLabel(status: string): string {
    if (status === 'starting' || status === 'running') return 'Working';
    if (status === 'failed') return 'Needs attention';
    if (status === 'cancelled') return 'Cancelled';
    if (status === 'interrupted') return 'Stopped';
    return '';
}

export const DevPilotProjectSidebar = React.memo(function DevPilotProjectSidebar(): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const desktop = React.useMemo(() => getDesktopClient(), []);
    const [workspace, setWorkspace] = React.useState<DevPilotWorkspace | null>(null);

    React.useEffect(() => {
        if (!desktop) return undefined;
        let active = true;
        const apply = (next: DevPilotWorkspace) => {
            if (!active) return;
            setWorkspace(next);
            seedDevPilotLocalWorkspace(next);
        };
        void desktop.getWorkspace().then(apply).catch(() => {
            if (active) setWorkspace({ version: 1, selectedProjectId: null, selectedTaskId: null, projects: [] });
        });
        const remove = desktop.onWorkspaceChanged(apply);
        return () => {
            active = false;
            remove();
        };
    }, [desktop]);

    const openTask = React.useCallback(async (taskId: string) => {
        if (!desktop) return;
        const next = await desktop.activateTask(taskId);
        seedDevPilotLocalWorkspace(next);
        router.push(`/session/${encodeURIComponent(taskId)}` as never);
    }, [desktop, router]);

    const selectProject = React.useCallback(async (projectId: string) => {
        if (!desktop) return;
        const next = await desktop.activateProject(projectId);
        setWorkspace(next);
        seedDevPilotLocalWorkspace(next);
    }, [desktop]);

    if (!workspace) {
        return <View style={styles.loading}><ActivitySpinner size="small" color={theme.colors.text.secondary} /></View>;
    }

    if (workspace.projects.length === 0) {
        return (
            <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No projects yet</Text>
                <Text style={styles.emptyBody}>Start a new task to choose a folder. DevPilot will remember it as a project.</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.root} contentContainerStyle={styles.content}>
            {workspace.projects.map((project) => (
                <View key={project.id} style={styles.project}>
                    <Pressable onPress={() => { void selectProject(project.id); }}>
                        <Text numberOfLines={1} style={styles.projectName}>{project.name}</Text>
                    </Pressable>
                    {project.tasks.length === 0 ? (
                        <Text style={styles.noTasks}>No tasks</Text>
                    ) : project.tasks.map((task) => {
                        const status = taskStatusLabel(task.status);
                        return (
                            <Pressable
                                key={task.id}
                                onPress={() => { void openTask(task.id); }}
                                style={[styles.task, workspace.selectedTaskId === task.id ? styles.taskActive : null]}
                            >
                                <Text numberOfLines={1} style={styles.taskTitle}>{task.title}</Text>
                                {status ? <Text style={styles.taskMeta}>{status}</Text> : null}
                            </Pressable>
                        );
                    })}
                </View>
            ))}
        </ScrollView>
    );
});
