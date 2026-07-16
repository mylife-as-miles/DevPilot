import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { getDesktopClient, type RuntimeStatus } from '@devpilot/desktop/client';

import { Text } from '@/components/ui/text/Text';

const bridge = getDesktopClient;

export const LocalDevPilotWelcome = React.memo(function LocalDevPilotWelcome() {
    const { theme } = useUnistyles();
    const [status, setStatus] = React.useState<RuntimeStatus | null>(null);
    const [projectPath, setProjectPath] = React.useState<string | null>(null);
    const [acpRunning, setAcpRunning] = React.useState(false);
    const [workspaceOpen, setWorkspaceOpen] = React.useState(false);
    const [prompt, setPrompt] = React.useState('');
    const [message, setMessage] = React.useState('Checking the local DevPilot runtime...');

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
        if (selected) {
            setProjectPath(selected);
            setAcpRunning(false);
            setWorkspaceOpen(false);
        }
    }, []);

    const launch = React.useCallback(async () => {
        if (!projectPath) return void chooseProject();
        const result = await bridge()?.launchAcp(projectPath);
        if (result) {
            setAcpRunning(true);
            setWorkspaceOpen(true);
            setMessage(`ACP is running for ${projectPath}.`);
        }
    }, [chooseProject, projectPath]);

    if (workspaceOpen && projectPath) {
        return <LocalResearchWorkspace
            projectPath={projectPath}
            prompt={prompt}
            onChangePrompt={setPrompt}
            onChangeProject={() => void chooseProject()}
        />;
    }

    return (
        <View style={[styles.root, { backgroundColor: theme.colors.background.canvas }]}>
            <View style={[styles.card, { backgroundColor: theme.colors.surface.base, borderColor: theme.colors.border.default }]}>
                <View style={styles.icon}><Ionicons name="flask-outline" size={28} color="#22A7F0" /></View>
                <Text style={[styles.title, { color: theme.colors.text.primary }]}>Set up DevPilot locally</Text>
                <Text style={[styles.body, { color: theme.colors.text.secondary }]}>{message}</Text>
                {status?.ready ? <Text style={[styles.meta, { color: theme.colors.text.tertiary }]}>{status.command} · {status.version ?? 'version verified'}</Text> : null}
                <Pressable onPress={refresh} style={[styles.secondary, { borderColor: theme.colors.border.default }]}><Text style={[styles.buttonText, { color: theme.colors.text.primary }]}>Retry detection</Text></Pressable>
                {status?.ready ? <>
                    <Pressable onPress={chooseProject} style={[styles.secondary, { borderColor: theme.colors.border.default }]}><Text style={[styles.buttonText, { color: theme.colors.text.primary }]}>{projectPath ? 'Change local project' : 'Select local project'}</Text></Pressable>
                    <Pressable onPress={acpRunning ? () => setWorkspaceOpen(true) : launch} style={styles.primary}>
                        <Text style={styles.primaryText}>{acpRunning ? 'Open research workspace' : projectPath ? 'Launch ACP and open workspace' : 'Select a project to continue'}</Text>
                    </Pressable>
                </> : null}
            </View>
        </View>
    );
});

const LocalResearchWorkspace = React.memo((props: Readonly<{ projectPath: string; prompt: string; onChangePrompt: (value: string) => void; onChangeProject: () => void }>) => {
    const { theme } = useUnistyles();
    return <View style={[workspaceStyles.root, { backgroundColor: theme.colors.background.canvas }]}>
        <View style={[workspaceStyles.sidebar, { backgroundColor: theme.colors.surface.base, borderColor: theme.colors.border.default }]}>
            <View style={workspaceStyles.brand}><View style={workspaceStyles.brandMark}><Ionicons name="flask" size={17} color="#fff" /></View><Text style={[workspaceStyles.brandName, { color: theme.colors.text.primary }]}>DevPilot</Text></View>
            <View style={workspaceStyles.navActive}><Ionicons name="flask-outline" size={18} color="#1583F7" /><Text style={workspaceStyles.navActiveText}>Research</Text></View>
            <View style={workspaceStyles.nav}><Ionicons name="folder-open-outline" size={18} color="#8290A5" /><Text style={[workspaceStyles.navText, { color: theme.colors.text.secondary }]}>Project context</Text></View>
            <View style={workspaceStyles.nav}><Ionicons name="document-text-outline" size={18} color="#8290A5" /><Text style={[workspaceStyles.navText, { color: theme.colors.text.secondary }]}>Reports</Text></View>
            <Pressable onPress={props.onChangeProject} style={[workspaceStyles.projectSwitch, { borderColor: theme.colors.border.default }]}><Ionicons name="swap-horizontal-outline" size={17} color="#8290A5" /><Text numberOfLines={1} style={[workspaceStyles.projectSwitchText, { color: theme.colors.text.secondary }]}>{props.projectPath}</Text></Pressable>
        </View>
        <View style={workspaceStyles.main}>
            <View style={[workspaceStyles.header, { borderColor: theme.colors.border.default }]}><View><Text style={[workspaceStyles.eyebrow, { color: theme.colors.text.tertiary }]}>LOCAL RESEARCH</Text><Text style={[workspaceStyles.headerTitle, { color: theme.colors.text.primary }]}>New research run</Text></View><View style={workspaceStyles.runtimePill}><View style={workspaceStyles.liveDot} /><Text style={workspaceStyles.runtimeText}>ACP connected</Text></View></View>
            <View style={workspaceStyles.content}>
                <View style={workspaceStyles.hero}><View style={workspaceStyles.heroIcon}><Ionicons name="sparkles" size={22} color="#1583F7" /></View><Text style={[workspaceStyles.heroTitle, { color: theme.colors.text.primary }]}>What should DevPilot investigate?</Text><Text style={[workspaceStyles.heroBody, { color: theme.colors.text.secondary }]}>DevPilot will coordinate focused research, test hypotheses, and assemble evidence from your local project.</Text></View>
                <View style={[workspaceStyles.composer, { backgroundColor: theme.colors.surface.base, borderColor: theme.colors.border.default }]}><TextInput multiline value={props.prompt} onChangeText={props.onChangePrompt} placeholder="Describe the question, decision, or problem to research..." placeholderTextColor="#8B98A9" style={[workspaceStyles.input, { color: theme.colors.text.primary }]} /><View style={[workspaceStyles.composerFooter, { borderColor: theme.colors.border.default }]}><Text style={[workspaceStyles.projectLabel, { color: theme.colors.text.tertiary }]} numberOfLines={1}>{props.projectPath}</Text><Pressable disabled={!props.prompt.trim()} style={[workspaceStyles.runButton, !props.prompt.trim() && workspaceStyles.runButtonDisabled]}><Ionicons name="arrow-up" size={17} color="#fff" /><Text style={workspaceStyles.runText}>Start research</Text></Pressable></View></View>
                <View style={workspaceStyles.cards}><WorkspaceFact icon="git-network-outline" title="Coordinator ready" body="Plans the investigation and routes work to Executors." /><WorkspaceFact icon="flash-outline" title="Executors on standby" body="Parallel specialists will collect and verify evidence." /><WorkspaceFact icon="shield-checkmark-outline" title="Local by default" body="Your project stays on this computer." /></View>
            </View>
        </View>
    </View>;
});

const WorkspaceFact = (props: Readonly<{ icon: keyof typeof Ionicons.glyphMap; title: string; body: string }>) => <View style={workspaceStyles.fact}><Ionicons name={props.icon} size={19} color="#1583F7" /><Text style={workspaceStyles.factTitle}>{props.title}</Text><Text style={workspaceStyles.factBody}>{props.body}</Text></View>;

const styles = StyleSheet.create(() => ({ root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, card: { width: '100%', maxWidth: 520, alignItems: 'center', gap: 14, padding: 32, borderWidth: 1, borderRadius: 18 }, icon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#22A7F018' }, title: { fontSize: 26, fontWeight: '700' }, body: { fontSize: 15, lineHeight: 22, textAlign: 'center' }, meta: { fontSize: 12, textAlign: 'center' }, secondary: { width: '100%', alignItems: 'center', paddingVertical: 11, borderWidth: 1, borderRadius: 10 }, primary: { width: '100%', alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: '#0A84FF' }, buttonText: { fontSize: 14, fontWeight: '600' }, primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' } }));
const workspaceStyles = StyleSheet.create(() => ({ root: { flex: 1, flexDirection: 'row' }, sidebar: { width: 244, padding: 18, borderRightWidth: 1 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 38, paddingHorizontal: 5 }, brandMark: { width: 31, height: 31, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1583F7' }, brandName: { fontSize: 18, fontWeight: '800' }, nav: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, marginBottom: 4 }, navActive: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, marginBottom: 4, borderRadius: 9, backgroundColor: '#1583F714' }, navText: { fontSize: 14, fontWeight: '600' }, navActiveText: { color: '#1583F7', fontSize: 14, fontWeight: '700' }, projectSwitch: { position: 'absolute', left: 18, right: 18, bottom: 20, flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderRadius: 9, padding: 10 }, projectSwitchText: { flex: 1, fontSize: 12 }, main: { flex: 1 }, header: { height: 86, paddingHorizontal: 42, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: '800' }, headerTitle: { fontSize: 21, fontWeight: '750', marginTop: 3 }, runtimePill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#17B26A14', borderRadius: 999 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#17B26A' }, runtimeText: { color: '#16845A', fontSize: 12, fontWeight: '700' }, content: { flex: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: 82 }, hero: { maxWidth: 620, alignItems: 'center', marginBottom: 32 }, heroIcon: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#1583F712', marginBottom: 16 }, heroTitle: { fontSize: 28, fontWeight: '800', textAlign: 'center' }, heroBody: { fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 10 }, composer: { width: '100%', maxWidth: 720, borderWidth: 1, borderRadius: 14, overflow: 'hidden' }, input: { minHeight: 128, padding: 18, fontSize: 15, lineHeight: 22, textAlignVertical: 'top', outlineStyle: 'none' }, composerFooter: { minHeight: 58, paddingHorizontal: 14, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14 }, projectLabel: { flex: 1, fontSize: 12 }, runButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 9, backgroundColor: '#1583F7' }, runButtonDisabled: { opacity: 0.45 }, runText: { color: '#fff', fontSize: 13, fontWeight: '800' }, cards: { width: '100%', maxWidth: 720, flexDirection: 'row', gap: 12, marginTop: 28 }, fact: { flex: 1, minHeight: 130, padding: 16, borderRadius: 12, backgroundColor: '#FFFFFFA8', borderWidth: 1, borderColor: '#E8ECF2' }, factTitle: { marginTop: 13, color: '#172033', fontSize: 13, fontWeight: '800' }, factBody: { marginTop: 5, color: '#66758A', fontSize: 12, lineHeight: 17 } }));
