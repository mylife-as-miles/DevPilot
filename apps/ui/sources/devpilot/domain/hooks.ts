import * as React from 'react';

import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';

import {
    cancelSelectedDevPilotConversation,
    ensureDevPilotDesktopInitialized,
    getDevPilotDesktopState,
    isSelectedConversationWorking,
    openDevPilotProjectFolder,
    readDevPilotChangeDiff,
    refreshDevPilotProjectsAndConversations,
    refreshDevPilotReview,
    selectDevPilotConversation,
    selectDevPilotProject,
    sendDevPilotConversationMessage,
    setDevPilotModel,
    setDevPilotReasoningEffort,
    setDevPilotSandboxMode,
    subscribeDevPilotDesktopState,
} from './store';
import {
    buildDevPilotProviderDiffMap,
    buildDevPilotSessionListViewData,
    getSelectedDevPilotConversation,
    getSelectedDevPilotProject,
    mapDevPilotChangesToScmSnapshot,
    mapDevPilotMessageToHappierMessage,
} from './selectors';
import type { DevPilotDesktopState, ReviewScope, SandboxMode } from './types';

export function useDevPilotDesktopState(): DevPilotDesktopState {
    return React.useSyncExternalStore(
        subscribeDevPilotDesktopState,
        getDevPilotDesktopState,
        getDevPilotDesktopState,
    );
}

export function useEnsureDevPilotDesktopInitialized(enabled: boolean): void {
    React.useEffect(() => {
        if (!enabled) return;
        void ensureDevPilotDesktopInitialized(true);
    }, [enabled]);
}

export function useDevPilotSessionListViewData(enabled: boolean): SessionListViewItem[] | null {
    const state = useDevPilotDesktopState();
    useEnsureDevPilotDesktopInitialized(enabled);
    return React.useMemo(
        () => enabled ? buildDevPilotSessionListViewData(state) : null,
        [enabled, state],
    );
}

export function useDevPilotSessionListSummary(enabled: boolean): Readonly<{
    sessionsReady: boolean;
    visibleSessionCount: number;
}> {
    const data = useDevPilotSessionListViewData(enabled);
    return React.useMemo(() => {
        if (!enabled) return { sessionsReady: false, visibleSessionCount: 0 };
        if (!data) return { sessionsReady: false, visibleSessionCount: 0 };
        return {
            sessionsReady: true,
            visibleSessionCount: data.reduce((count, item) => count + (item.type === 'session' ? 1 : 0), 0),
        };
    }, [data, enabled]);
}

export function useDevPilotSelectedConversationViewModel(enabled: boolean) {
    const state = useDevPilotDesktopState();
    useEnsureDevPilotDesktopInitialized(enabled);
    const conversation = getSelectedDevPilotConversation(state);
    const project = getSelectedDevPilotProject(state);
    const messages = conversation
        ? (state.messagesByConversation[conversation.conversationId] ?? []).map(mapDevPilotMessageToHappierMessage)
        : [];
    const events = conversation
        ? state.eventsByConversation[conversation.conversationId] ?? []
        : [];
    return React.useMemo(() => ({
        state,
        conversation,
        project,
        messages,
        events,
        isWorking: isSelectedConversationWorking(),
    }), [conversation, events, messages, project, state]);
}

export function useDevPilotReviewViewModel(enabled: boolean) {
    const state = useDevPilotDesktopState();
    const project = getSelectedDevPilotProject(state);
    const changes = project ? state.changesByProject[project.projectId] ?? null : null;
    const snapshot = project ? mapDevPilotChangesToScmSnapshot(project.projectId, changes) : null;
    const providerDiffByPath = project ? buildDevPilotProviderDiffMap(state, project.projectId) : new Map<string, string>();

    React.useEffect(() => {
        if (!enabled || !project) return;
        void refreshDevPilotReview(project.projectId);
    }, [enabled, project?.projectId]);

    return React.useMemo(() => ({
        project,
        changes,
        snapshot,
        providerDiffByPath,
        loading: state.loading.review,
    }), [changes, project, providerDiffByPath, snapshot, state.loading.review]);
}

export const devPilotDesktopActions = Object.freeze({
    refresh: refreshDevPilotProjectsAndConversations,
    openProjectFolder: openDevPilotProjectFolder,
    selectProject: selectDevPilotProject,
    selectConversation: selectDevPilotConversation,
    sendMessage: sendDevPilotConversationMessage,
    cancelSelectedConversation: cancelSelectedDevPilotConversation,
    setModel: setDevPilotModel,
    setReasoningEffort: setDevPilotReasoningEffort,
    setSandboxMode: setDevPilotSandboxMode,
    refreshReview: refreshDevPilotReview,
    readDiff: readDevPilotChangeDiff,
});

export type { ReviewScope, SandboxMode };
