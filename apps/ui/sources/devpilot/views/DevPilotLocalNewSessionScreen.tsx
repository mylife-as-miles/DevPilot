import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import type { AgentId } from '@/agents/catalog/catalog';
import { NewSessionWizard } from '@/components/sessions/new/components/NewSessionWizard';
import { newSessionScreenStyles } from '@/components/sessions/new/newSessionScreenStyles';
import { isMobileLayoutWidth } from '@/components/sessions/layout/isMobileLayoutWidth';
import { useChromeSafeAreaInsets } from '@/components/ui/layout/useChromeSafeAreaInsets';
import { useHeaderHeight } from '@/utils/platform/responsive';
import type { CLIAvailability } from '@/hooks/auth/useCLIDetection';
import {
    buildDevPilotModelOptions,
    buildDevPilotReasoningOptions,
    selectDevPilotModelId,
} from '@/devpilot/domain/composerOptions';
import {
    devPilotDesktopActions,
    useDevPilotDesktopState,
    useEnsureDevPilotDesktopInitialized,
} from '@/devpilot/domain/hooks';
import { getDevPilotDesktopState } from '@/devpilot/domain/store';
import { getSelectedDevPilotProject } from '@/devpilot/domain/selectors';
import {
    mapPermissionModeToSandbox,
    mapSandboxToPermissionMode,
} from '@/devpilot/domain/status';
import type { PermissionMode } from '@/sync/domains/permissions/permissionTypes';

const CODEX_AGENT_ID = 'codex' as AgentId;
const EMPTY_CLI_AVAILABILITY: CLIAvailability = Object.freeze({
    available: Object.freeze({}) as CLIAvailability['available'],
    login: Object.freeze({}) as CLIAvailability['login'],
    authStatus: Object.freeze({}) as CLIAvailability['authStatus'],
    resolvedPath: Object.freeze({}) as CLIAvailability['resolvedPath'],
    resolvedCommand: Object.freeze({}) as NonNullable<CLIAvailability['resolvedCommand']>,
    resolutionSource: Object.freeze({}) as CLIAvailability['resolutionSource'],
    tmux: null,
    isDetecting: false,
    timestamp: 0,
    refresh: () => undefined,
});

const EMPTY_AUTOCOMPLETE_SUGGESTIONS = async () => [];
const noop = () => undefined;

export function DevPilotLocalNewSessionScreen(): React.ReactElement {
    const state = useDevPilotDesktopState();
    useEnsureDevPilotDesktopInitialized(true);

    const router = useRouter();
    const { theme, rt } = useUnistyles();
    const safeArea = useChromeSafeAreaInsets();
    const headerHeight = useHeaderHeight();
    const { width: screenWidth } = useWindowDimensions();
    const popoverBoundaryRef = React.useRef<View>(null!);
    const suppressNextSecretAutoPromptKeyRef = React.useRef<string | null>(null);
    const [sessionPrompt, setSessionPrompt] = React.useState('');
    const [isCreating, setIsCreating] = React.useState(false);
    const [isOpeningFolder, setIsOpeningFolder] = React.useState(false);

    const project = getSelectedDevPilotProject(state);
    const modelOptions = React.useMemo(
        () => buildDevPilotModelOptions(state.models),
        [state.models],
    );
    const selectedModel = selectDevPilotModelId(state.models, state.selectedModel);
    const reasoningOptions = React.useMemo(
        () => buildDevPilotReasoningOptions(state.models, state.selectedModel, state.reasoningEffort),
        [state.models, state.reasoningEffort, state.selectedModel],
    );
    const isLoadingRuntime = !state.initialized || state.loading.projects || state.loading.conversations;
    const canCreate = Boolean(project && selectedModel && !isLoadingRuntime && !isCreating);
    const selectedIndicatorColor = rt.themeName === 'dark' ? theme.colors.text.primary : theme.colors.button.primary.background;
    const newSessionSidePadding = 16;
    const newSessionBottomPadding = Math.max(screenWidth < 420 ? 8 : 16, safeArea.bottom);

    const handleOpenFolder = React.useCallback(() => {
        setIsOpeningFolder(true);
        void devPilotDesktopActions.openProjectFolder()
            .finally(() => setIsOpeningFolder(false));
    }, []);

    const handleCreateSession = React.useCallback(() => {
        const prompt = sessionPrompt.trim();
        if (!prompt || !canCreate) return;
        setSessionPrompt('');
        setIsCreating(true);
        void devPilotDesktopActions.sendMessage(prompt)
            .then((conversationId) => {
                const nextConversationId = conversationId ?? getDevPilotDesktopState().selectedConversationId;
                if (nextConversationId) {
                    router.replace(`/session/${encodeURIComponent(nextConversationId)}` as never);
                } else {
                    setSessionPrompt(prompt);
                }
            })
            .catch(() => {
                setSessionPrompt(prompt);
            })
            .finally(() => setIsCreating(false));
    }, [canCreate, router, sessionPrompt]);

    const handleModelChange = React.useCallback((model: string) => {
        devPilotDesktopActions.setModel(model);
    }, []);

    const handlePermissionModeChange = React.useCallback((mode: PermissionMode) => {
        devPilotDesktopActions.setSandboxMode(mapPermissionModeToSandbox(mode));
    }, []);

    const handleReasoningChange = React.useCallback((configId: string, valueId: string) => {
        if (configId === 'reasoning_effort') {
            devPilotDesktopActions.setReasoningEffort(valueId);
        }
    }, []);

    return (
        <NewSessionWizard
            popoverBoundaryRef={popoverBoundaryRef}
            useColumnLayout={true}
            sectionPresentation={{
                backends: 'dropdown',
                models: 'dropdown',
                permissions: 'dropdown',
            }}
            localDevPilot={{
                selectedProjectName: project?.name ?? null,
                selectedProjectPath: project?.path ?? null,
                onOpenFolder: handleOpenFolder,
            }}
            layout={{
                theme,
                styles: newSessionScreenStyles,
                safeAreaTop: safeArea.top,
                safeAreaBottom: safeArea.bottom,
                headerHeight,
                newSessionTopPadding: 0,
                newSessionSidePadding,
                newSessionBottomPadding,
                shouldBottomAnchor: isMobileLayoutWidth(screenWidth),
            }}
            profiles={{
                useProfiles: false,
                profiles: [],
                favoriteProfileIds: [],
                setFavoriteProfileIds: noop,
                selectedProfileId: null,
                onPressDefaultEnvironment: noop,
                onPressProfile: noop,
                selectedMachineId: null,
                getProfileDisabled: () => false,
                getProfileSubtitleExtra: () => null,
                handleAddProfile: noop,
                openProfileEdit: noop,
                handleDuplicateProfile: noop,
                handleDeleteProfile: noop,
                suppressNextSecretAutoPromptKeyRef,
                openSecretRequirementModal: noop,
                profilesGroupTitles: { favorites: 'Favorites', custom: 'Custom', builtIn: 'Built-in' },
                getSecretOverrideReady: () => true,
                getSecretSatisfactionForProfile: () => ({ isSatisfied: true }),
            }}
            agent={{
                cliAvailability: EMPTY_CLI_AVAILABILITY,
                tmuxRequested: false,
                enabledAgentIds: [CODEX_AGENT_ID],
                isAgentSelectable: (agentId) => agentId === CODEX_AGENT_ID,
                agentType: CODEX_AGENT_ID,
                agentLabel: 'Codex',
                setAgentType: noop,
                selectedBackendEntry: null,
                modelOptions,
                modelOptionsProbe: {
                    phase: isLoadingRuntime ? 'loading' : 'idle',
                    onRefresh: devPilotDesktopActions.refresh,
                    refreshAccessibilityLabel: 'Refresh Codex models',
                    loadingAccessibilityLabel: 'Loading Codex models',
                    refreshingAccessibilityLabel: 'Refreshing Codex models',
                },
                favoriteModelSelections: [],
                setFavoriteModelSelections: noop,
                modelMode: selectedModel,
                setModelMode: handleModelChange,
                acpSessionModeOptions: [],
                acpSessionModeId: null,
                setAcpSessionModeId: undefined,
                acpConfigOptions: reasoningOptions,
                acpConfigOptionOverrides: null,
                setAcpConfigOptionOverride: handleReasoningChange,
                selectedIndicatorColor,
                profileMap: new Map(),
                permissionMode: mapSandboxToPermissionMode(state.sandboxMode),
                handlePermissionModeChange,
            }}
            machine={{
                machines: [],
                serverId: null,
                selectedMachine: null,
                recentMachines: [],
                favoriteMachineItems: [],
                useMachinePickerSearch: false,
                setSelectedMachineId: noop,
                getBestPathForMachine: () => project?.path ?? '',
                setSelectedPath: noop,
                favoriteMachines: [],
                setFavoriteMachines: noop,
                selectedPath: project?.path ?? '',
                recentPaths: project?.path ? [project.path] : [],
                usePathPickerSearch: false,
                favoriteDirectories: [],
                setFavoriteDirectories: noop,
            }}
            footer={{
                sessionPrompt,
                setSessionPrompt,
                handleCreateSession,
                canCreate,
                isCreating,
                onAbort: devPilotDesktopActions.cancelSelectedConversation,
                showAbortButton: isCreating,
                submitAccessibilityLabel: 'Send DevPilot prompt',
                emptyAutocompletePrefixes: [],
                emptyAutocompleteSuggestions: EMPTY_AUTOCOMPLETE_SUGGESTIONS,
                connectionStatus: {
                    text: isOpeningFolder
                        ? 'Opening folder'
                        : isLoadingRuntime
                            ? 'Loading workspace'
                            : project
                                ? 'Ready'
                                : 'Open a folder',
                    color: theme.colors.text.secondary,
                    dotColor: project
                        ? theme.colors.state.success.foreground
                        : theme.colors.text.secondary,
                    isPulsing: isOpeningFolder || isLoadingRuntime,
                },
                inputMaxHeight: 260,
                agentInputExtraActionChips: [],
                attachmentFlowId: 'devpilot-local-new-session',
            }}
        />
    );
}
