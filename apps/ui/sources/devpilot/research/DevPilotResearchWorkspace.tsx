import type { HypothesisTreeNode, ResearchRunState } from '@devpilot/research';
import {
    extractDevPilotEventsFromMessages,
    reduceResearchRunEvents,
    selectActiveExecutors,
    selectBestScoringPath,
    selectHypothesisTree,
    selectPendingApprovals,
} from '@devpilot/research';
import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { useSessionMessages } from '@/sync/store/hooks';

const STATUS_COLORS = {
    running: '#14B8A6',
    completed: '#22C55E',
    done: '#22C55E',
    failed: '#EF4444',
    cancelled: '#94A3B8',
    pruned: '#94A3B8',
    merged: '#8B5CF6',
    'awaiting-input': '#F59E0B',
    pending: '#64748B',
    queued: '#64748B',
} as const;

function statusColor(status: string): string {
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? '#64748B';
}

export const DevPilotResearchWorkspace = React.memo((props: Readonly<{ sessionId: string }>) => {
    const { messages, isLoaded } = useSessionMessages(props.sessionId);
    const events = React.useMemo(() => extractDevPilotEventsFromMessages(messages), [messages]);
    const state = React.useMemo(() => reduceResearchRunEvents(props.sessionId, events), [events, props.sessionId]);
    const tree = React.useMemo(() => selectHypothesisTree(state), [state]);
    const bestPath = React.useMemo(() => new Set(selectBestScoringPath(state)), [state]);
    const activeExecutors = React.useMemo(() => selectActiveExecutors(state), [state]);
    const pendingApprovals = React.useMemo(() => selectPendingApprovals(state), [state]);
    const [selectedHypothesisId, setSelectedHypothesisId] = React.useState<string | null>(null);
    const selectedHypothesis = selectedHypothesisId ? state.hypotheses[selectedHypothesisId] : null;

    if (!isLoaded) {
        return <ResearchEmptyState icon="sync-outline" title="Loading research run" body="Reconstructing the live run from the DevPilot event stream." />;
    }

    if (events.length === 0) {
        return <ResearchEmptyState icon="flask-outline" title="No research run yet" body="Start this DevPilot session in Research mode. Coordinator, hypotheses, Executors, evidence, and reports will appear here as they stream." />;
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="devpilot-research-workspace">
            <View style={styles.hero}>
                <View style={styles.heroTitleRow}>
                    <View style={styles.iconTile}><Ionicons name="flask" size={18} color="#FFFFFF" /></View>
                    <View style={styles.flexCopy}>
                        <Text style={styles.eyebrow}>DEVPILOT RESEARCH RUN</Text>
                        <Text style={styles.title}>{state.task ?? 'Active research session'}</Text>
                        <Text style={styles.subtitle}>{state.projectPath ?? `Session ${state.sessionId}`}</Text>
                    </View>
                    <StatusPill status={state.status} />
                </View>
                <View style={styles.factRow}>
                    <Fact label="Cycle" value={state.totalCycles ? `${state.currentCycle}/${state.totalCycles}` : String(state.currentCycle)} />
                    <Fact label="Hypotheses" value={String(state.hypothesisOrder.length)} />
                    <Fact label="Executors" value={`${activeExecutors.length}/${state.executorOrder.length} active`} />
                    <Fact label="Evidence" value={String(state.evidence.length)} />
                    <Fact label="Tokens" value={state.usage.totalTokens.toLocaleString()} />
                </View>
            </View>

            {pendingApprovals.length > 0 ? (
                <View style={styles.approvalBanner}>
                    <Ionicons name="shield-checkmark-outline" size={20} color="#D97706" />
                    <View style={styles.flexCopy}>
                        <Text style={styles.cardTitle}>{pendingApprovals.length} approval{pendingApprovals.length === 1 ? '' : 's'} waiting</Text>
                        <Text style={styles.subtitle}>{pendingApprovals.map((item) => item.operation).join(' · ')}</Text>
                    </View>
                </View>
            ) : null}

            <Section title="Coordinator" icon="git-network-outline">
                <View style={styles.coordinatorGrid}>
                    <View style={styles.coordinatorActivity}>
                        <Text style={styles.label}>CURRENT ACTIVITY</Text>
                        <Text style={styles.body}>{state.coordinator.activity ?? 'Watching the event stream'}</Text>
                        {state.coordinator.pendingQuestion ? <Text style={styles.warningText}>{state.coordinator.pendingQuestion}</Text> : null}
                    </View>
                    <View style={styles.coordinatorFacts}>
                        <Fact label="Provider" value={state.provider ?? 'DevPilot'} />
                        <Fact label="Model" value={state.model ?? 'runtime default'} />
                        <Fact label="LLM turns" value={String(state.coordinator.turns)} />
                        <Fact label="Last event" value={state.coordinator.lastEvent ?? '—'} />
                    </View>
                </View>
            </Section>

            <Section title="Hypothesis Tree" icon="share-social-outline" accessory={`${state.hypothesisOrder.length} nodes`}>
                {tree.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.treeCanvas}>
                        <View style={styles.treeColumn}>
                            {tree.map((item) => (
                                <HypothesisBranch
                                    key={item.node.id}
                                    item={item}
                                    bestPath={bestPath}
                                    selectedId={selectedHypothesisId}
                                    onSelect={setSelectedHypothesisId}
                                />
                            ))}
                        </View>
                    </ScrollView>
                ) : <Text style={styles.emptyText}>Waiting for the Coordinator to propose a hypothesis.</Text>}
                {selectedHypothesis ? (
                    <View style={styles.selectionPanel}>
                        <Text style={styles.label}>SELECTED · {selectedHypothesis.id}</Text>
                        <Text style={styles.body}>{selectedHypothesis.hypothesis}</Text>
                        <Text style={styles.subtitle}>{selectedHypothesis.result ?? selectedHypothesis.insight ?? 'No result recorded yet.'}</Text>
                    </View>
                ) : null}
            </Section>

            <Section title="Parallel Executors" icon="people-outline" accessory={`${activeExecutors.length} active`}>
                <View style={styles.cardGrid}>
                    {state.executorOrder.map((id) => {
                        const executor = state.executors[id];
                        return executor ? <ExecutorCard key={id} executor={executor} /> : null;
                    })}
                    {state.executorOrder.length === 0 ? <Text style={styles.emptyText}>No Executors have been dispatched.</Text> : null}
                </View>
            </Section>

            <View style={styles.twoColumn}>
                <Section title="Evidence & Sources" icon="book-outline" accessory={String(state.evidence.length)} compact>
                    {state.evidence.map((item) => (
                        <View key={item.id} style={styles.listRow}>
                            <Ionicons name={item.url ? 'link-outline' : 'document-text-outline'} size={16} style={styles.listIcon} />
                            <View style={styles.flexCopy}>
                                <Text style={styles.cardTitle}>{item.title}</Text>
                                <Text style={styles.subtitle}>{[item.provider, item.channel, item.url ?? item.contentPath].filter(Boolean).join(' · ')}</Text>
                                {item.excerpt ? <Text numberOfLines={2} style={styles.body}>{item.excerpt}</Text> : null}
                            </View>
                        </View>
                    ))}
                    {state.evidence.length === 0 ? <Text style={styles.emptyText}>No source references captured yet.</Text> : null}
                </Section>
                <Section title="Reports & Memory" icon="archive-outline" accessory={String(state.artifacts.length)} compact>
                    {state.artifacts.map((item) => (
                        <View key={item.id} style={styles.listRow}>
                            <Ionicons name={item.kind === 'audit' ? 'shield-checkmark-outline' : item.kind === 'memory' ? 'bulb-outline' : 'document-text-outline'} size={16} style={styles.listIcon} />
                            <View style={styles.flexCopy}>
                                <Text style={styles.cardTitle}>{item.name}</Text>
                                <Text style={styles.subtitle}>{item.path ?? item.kind}</Text>
                            </View>
                            <Text style={styles.artifactKind}>{item.kind.toUpperCase()}</Text>
                        </View>
                    ))}
                    {state.artifacts.length === 0 ? <Text style={styles.emptyText}>Reports, memory, and audits will appear here.</Text> : null}
                </Section>
            </View>

            <Section title="Workspace Changes" icon="code-slash-outline" accessory={state.branch ?? undefined}>
                <View style={styles.fileList}>
                    {state.changedFiles.map((file) => <Text key={file} style={styles.mono}>M  {file}</Text>)}
                    {state.changedFiles.length === 0 ? <Text style={styles.emptyText}>No changed files reported.</Text> : null}
                </View>
            </Section>
        </ScrollView>
    );
});

function ResearchEmptyState(props: Readonly<{ icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }>) {
    const { theme } = useUnistyles();
    return (
        <View style={styles.emptyState} testID="devpilot-research-empty-state">
            <View style={styles.emptyIcon}><Ionicons name={props.icon} size={28} color={theme.colors.text.secondary} /></View>
            <Text style={styles.title}>{props.title}</Text>
            <Text style={styles.emptyBody}>{props.body}</Text>
        </View>
    );
}

function Section(props: Readonly<{ title: string; icon: React.ComponentProps<typeof Ionicons>['name']; accessory?: string; compact?: boolean; children: React.ReactNode }>) {
    return (
        <View style={[styles.section, props.compact ? styles.compactSection : null]}>
            <View style={styles.sectionHeader}>
                <Ionicons name={props.icon} size={17} style={styles.sectionIcon} />
                <Text style={styles.sectionTitle}>{props.title}</Text>
                {props.accessory ? <Text style={styles.sectionAccessory}>{props.accessory}</Text> : null}
            </View>
            {props.children}
        </View>
    );
}

function Fact(props: Readonly<{ label: string; value: string }>) {
    return (
        <View style={styles.fact}>
            <Text style={styles.label}>{props.label.toUpperCase()}</Text>
            <Text numberOfLines={1} style={styles.factValue}>{props.value}</Text>
        </View>
    );
}

function StatusPill(props: Readonly<{ status: string }>) {
    const color = statusColor(props.status);
    return (
        <View style={[styles.statusPill, { borderColor: color, backgroundColor: `${color}18` }]}>
            <View style={[styles.statusDot, { backgroundColor: color }]} />
            <Text style={[styles.statusText, { color }]}>{props.status.replace('-', ' ')}</Text>
        </View>
    );
}

function HypothesisBranch(props: Readonly<{
    item: HypothesisTreeNode;
    bestPath: ReadonlySet<string>;
    selectedId: string | null;
    onSelect: (id: string) => void;
}>) {
    const node = props.item.node;
    const selected = props.selectedId === node.id;
    const best = props.bestPath.has(node.id);
    return (
        <View style={styles.treeBranch}>
            <Pressable onPress={() => props.onSelect(node.id)} style={[styles.hypothesisCard, selected ? styles.hypothesisSelected : null, best ? styles.hypothesisBest : null]}>
                <View style={styles.nodeHeader}>
                    <Text style={styles.nodeId}>{node.id}</Text>
                    <StatusPill status={node.status} />
                </View>
                <Text numberOfLines={2} style={styles.cardTitle}>{node.hypothesis}</Text>
                <Text style={styles.subtitle}>{node.score === null ? 'Unscored' : `Score ${node.score.toFixed(2)}`} · {node.evidenceCount} evidence</Text>
            </Pressable>
            {props.item.children.length > 0 ? (
                <View style={styles.childrenRow}>
                    {props.item.children.map((child) => <HypothesisBranch key={child.node.id} {...props} item={child} />)}
                </View>
            ) : null}
        </View>
    );
}

function ExecutorCard(props: Readonly<{ executor: ResearchRunState['executors'][string] }>) {
    const executor = props.executor;
    return (
        <View style={styles.executorCard}>
            <View style={styles.nodeHeader}>
                <View style={styles.executorTitle}>
                    <View style={[styles.avatar, { backgroundColor: statusColor(executor.status) }]}><Text style={styles.avatarText}>{executor.id.slice(0, 2).toUpperCase()}</Text></View>
                    <View style={styles.flexCopy}>
                        <Text style={styles.cardTitle}>{executor.id}</Text>
                        <Text style={styles.subtitle}>{executor.hypothesisId ? `Hypothesis ${executor.hypothesisId}` : 'Independent Executor'}</Text>
                    </View>
                </View>
                <StatusPill status={executor.status} />
            </View>
            <Text numberOfLines={2} style={styles.body}>{executor.task ?? executor.hypothesis ?? 'Waiting for task details'}</Text>
            {executor.latestMessage ? <Text numberOfLines={2} style={styles.activity}>{executor.latestMessage}</Text> : null}
            <View style={styles.executorFacts}>
                <Text style={styles.subtitle}>{executor.branch ?? 'isolated worktree'}</Text>
                <Text style={styles.subtitle}>{executor.changedFiles.length} files · {executor.tests.length} tests</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    screen: { flex: 1, backgroundColor: theme.colors.surface.base },
    content: { padding: 18, paddingBottom: 48, gap: 14, width: '100%', maxWidth: 1280, alignSelf: 'center' },
    hero: { padding: 18, gap: 16, borderRadius: 16, backgroundColor: theme.colors.surface.inset, borderWidth: 1, borderColor: theme.colors.border.default },
    heroTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    iconTile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#5B5BD6' },
    flexCopy: { flex: 1, minWidth: 0, gap: 3 },
    eyebrow: { color: '#6D6ADF', fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
    title: { color: theme.colors.text.primary, fontSize: 20, lineHeight: 26, fontWeight: '700' },
    subtitle: { color: theme.colors.text.secondary, fontSize: 12, lineHeight: 17 },
    body: { color: theme.colors.text.primary, fontSize: 13, lineHeight: 19 },
    label: { color: theme.colors.text.tertiary, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
    factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    fact: { minWidth: 92, flexGrow: 1, paddingHorizontal: 11, paddingVertical: 8, gap: 2, borderRadius: 9, backgroundColor: theme.colors.surface.base, borderWidth: 1, borderColor: theme.colors.border.default },
    factValue: { color: theme.colors.text.primary, fontSize: 12, fontWeight: '700' },
    statusPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: 10, lineHeight: 13, fontWeight: '800', textTransform: 'uppercase' },
    approvalBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 12, borderWidth: 1, borderColor: '#F59E0B66', backgroundColor: '#F59E0B12' },
    warningText: { color: '#D97706', fontSize: 12, lineHeight: 17, fontWeight: '600' },
    section: { padding: 14, gap: 12, borderRadius: 14, backgroundColor: theme.colors.surface.inset, borderWidth: 1, borderColor: theme.colors.border.default },
    compactSection: { flex: 1, minWidth: 280 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    sectionIcon: { color: theme.colors.text.secondary },
    sectionTitle: { flex: 1, color: theme.colors.text.primary, fontSize: 14, fontWeight: '700' },
    sectionAccessory: { color: theme.colors.text.secondary, fontSize: 11, fontWeight: '600' },
    coordinatorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    coordinatorActivity: { flex: 2, minWidth: 240, gap: 6, padding: 12, borderRadius: 10, backgroundColor: theme.colors.surface.base },
    coordinatorFacts: { flex: 1, minWidth: 220, flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    treeCanvas: { minWidth: '100%', paddingVertical: 4 },
    treeColumn: { gap: 10 },
    treeBranch: { alignItems: 'flex-start', gap: 9 },
    childrenRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 28, borderLeftWidth: 1, borderLeftColor: theme.colors.border.default },
    hypothesisCard: { width: 220, padding: 11, gap: 7, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border.default, backgroundColor: theme.colors.surface.base },
    hypothesisSelected: { borderColor: '#5B5BD6', borderWidth: 2 },
    hypothesisBest: { backgroundColor: '#5B5BD610' },
    nodeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    nodeId: { color: '#6D6ADF', fontSize: 10, fontWeight: '800' },
    cardTitle: { color: theme.colors.text.primary, fontSize: 12, lineHeight: 17, fontWeight: '700' },
    selectionPanel: { gap: 4, padding: 11, borderRadius: 9, backgroundColor: '#5B5BD60D', borderWidth: 1, borderColor: '#5B5BD633' },
    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    executorCard: { flexGrow: 1, flexBasis: 300, maxWidth: 520, minWidth: 260, gap: 9, padding: 12, borderRadius: 11, backgroundColor: theme.colors.surface.base, borderWidth: 1, borderColor: theme.colors.border.default },
    executorTitle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
    avatar: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
    avatarText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
    activity: { color: '#6D6ADF', fontSize: 11, lineHeight: 16 },
    executorFacts: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    twoColumn: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
    listIcon: { color: theme.colors.text.secondary, marginTop: 1 },
    artifactKind: { color: theme.colors.text.tertiary, fontSize: 9, fontWeight: '800' },
    fileList: { gap: 6, padding: 10, borderRadius: 9, backgroundColor: theme.colors.surface.base },
    mono: { color: theme.colors.text.primary, fontSize: 11, fontFamily: 'monospace' },
    emptyText: { color: theme.colors.text.tertiary, fontSize: 12, fontStyle: 'italic' },
    emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32, backgroundColor: theme.colors.surface.base },
    emptyIcon: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface.inset, borderWidth: 1, borderColor: theme.colors.border.default },
    emptyBody: { maxWidth: 460, color: theme.colors.text.secondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
}));
