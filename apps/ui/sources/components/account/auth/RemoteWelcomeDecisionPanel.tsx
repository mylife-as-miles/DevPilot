import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDesktopClient, type CodexAuthStatus, type RuntimeStatus } from '@devpilot/desktop/client';
import Animated, {
    Easing,
    interpolate,
    interpolateColor,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useLocalSetting } from '@/sync/store/hooks';
import { t } from '@/text';
import { devpilotServices, isElectronDesktop } from '@/config/devpilotServices';
import { writeDevPilotLocalSession } from '@/config/devpilotLocalSession';

import type { RemoteAuthEntryOptions } from './useRemoteAuthEntryOptions';
import { useReturningGreeting } from './useReturningGreeting';

// Premium-feel hover affordances on the welcome buttons. The whole button
// lifts 1px on hover and its content shifts:
//   - primary button → filled ink, the trailing arrow slides 4px right
//     (anticipates the forward action) and the whole pill dims slightly
//   - secondary button → ghost outline, the QR icon scales to 1.08 and the
//     background fades partway from surface.base toward surface.elevated
//     (subtle darken in light theme, subtle lighten in dark theme —
//     surface.elevated is defined per theme to flip in both directions).
//     We only fade halfway (SECONDARY_HOVER_BG_INTENSITY) so the hover tint
//     lands at a midpoint between the two tokens, which on light theme
//     reads as a softer in-between gray rather than the full elevated step.
// All animations share the same Material standard easing + 180ms duration so
// the two interactions read as one family. Native (iOS/Android) doesn't emit
// hover events, so this is automatically a web/Tauri-only enhancement.
const ICON_HOVER_TRANSLATE_PX = 4;
const ICON_HOVER_SCALE = 1.08;
const BUTTON_HOVER_LIFT_PX = 1;
const PRIMARY_HOVER_OPACITY = 0.92;
// How far the secondary button's bg fades toward surface.elevated on hover.
// 1 = full elevated; 0.5 = halfway between surface.base and surface.elevated,
// which lands at roughly #f8f8f8 in light theme (a softer in-between gray
// than the full elevated #f0f0f0) and ~#1d1a1a in dark theme.
const SECONDARY_HOVER_BG_INTENSITY = 0.5;
const ICON_HOVER_DURATION_MS = 180;
// Material "standard" easing curve. Avoids springs (too playful for a CTA).
const ICON_HOVER_EASING = Easing.bezier(0.4, 0, 0.2, 1);
const DECISION_ROW_PRESSED_STYLE = { opacity: 0.88 };

// Pressable made animatable so we can drive its style from a shared value.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type RemoteWelcomeDecisionPanelLayout = 'portrait' | 'landscape';
type AuthActionResult = void | Promise<void>;

export type RemoteWelcomeDecisionPanelProps = Readonly<{
    options: RemoteAuthEntryOptions;
    layout: RemoteWelcomeDecisionPanelLayout;
    isDesktopShell: boolean;
    onOpenSetup: () => void;
    onRestore: () => void;
    onProviderSignup: (providerId: string) => AuthActionResult;
    onAnonymousSignup: () => AuthActionResult;
    onMtlsLogin: () => AuthActionResult;
    onKeylessProviderLogin: (providerId: string) => AuthActionResult;
    onChangeRelay: () => void;
}>;

type DecisionActionRowProps = Readonly<{
    testID: string;
    title: string;
    subtitle?: string;
    primary?: boolean;
    iconName?: keyof typeof Ionicons.glyphMap;
    onPress: () => AuthActionResult;
}>;

function resolvePrimaryAction(
    options: RemoteAuthEntryOptions,
    props: Pick<
        RemoteWelcomeDecisionPanelProps,
        'onAnonymousSignup' | 'onKeylessProviderLogin' | 'onMtlsLogin' | 'onProviderSignup'
    >,
): () => AuthActionResult {
    switch (options.primarySignupKind) {
        case 'provider-keyed':
            return () => {
                if (options.providerId) props.onProviderSignup(options.providerId);
            };
        case 'mtls':
            return props.onMtlsLogin;
        case 'keyless':
            return () => {
                if (options.keylessProviderId) props.onKeylessProviderLogin(options.keylessProviderId);
            };
        case 'anonymous':
            return props.onAnonymousSignup;
    }
}

function DecisionActionRow(props: DecisionActionRowProps): React.ReactElement {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const reducedMotion = useReducedMotionPreference();
    const [isHovered, setIsHovered] = React.useState(false);
    const [isPressed, setIsPressed] = React.useState(false);
    // Single 0→1 progress drives every hover-related animation on the button:
    // the lift translateY, the primary's opacity dim, the secondary's bg
    // colour fade, and the icon slide/scale. Keeping them on one timeline
    // means they start and finish together and read as one motion.
    const hoverProgress = useSharedValue(0);

    React.useEffect(() => {
        const target = isHovered ? 1 : 0;
        if (reducedMotion) {
            hoverProgress.value = target;
            return;
        }
        hoverProgress.value = withTiming(target, {
            duration: ICON_HOVER_DURATION_MS,
            easing: ICON_HOVER_EASING,
        });
    }, [isHovered, reducedMotion, hoverProgress]);

    const isPrimary = props.primary === true;
    const supportsHoverAnimation = Platform.OS === 'web';
    const primaryBg = theme.colors.button.primary.background;
    const primaryTint = theme.colors.button.primary.tint;
    const surfaceRest = theme.colors.surface.base;
    const surfaceHover = theme.colors.surface.elevated;

    // Outer animated style — applied to the Pressable itself.
    //   - Both buttons: lift translateY: 0 → -1
    //   - Primary: dim opacity: 1 → 0.92
    //   - Secondary: background fades partway from surface.base toward surface.elevated
    const containerAnimatedStyle = useAnimatedStyle(() => {
        const lift = interpolate(hoverProgress.value, [0, 1], [0, -BUTTON_HOVER_LIFT_PX]);
        if (isPrimary) {
            return {
                transform: [{ translateY: lift }],
                opacity: interpolate(hoverProgress.value, [0, 1], [1, PRIMARY_HOVER_OPACITY]),
            };
        }
        const bgProgress = interpolate(
            hoverProgress.value,
            [0, 1],
            [0, SECONDARY_HOVER_BG_INTENSITY],
        );
        return {
            transform: [{ translateY: lift }],
            backgroundColor: interpolateColor(
                bgProgress,
                [0, 1],
                [surfaceRest, surfaceHover],
            ),
        };
    }, [isPrimary, primaryBg, surfaceRest, surfaceHover]);

    // Inner animated style — applied to the icon's Animated.View only.
    //   - Primary: arrow slides right (translateX)
    //   - Secondary: icon scales up
    const iconAnimatedStyle = useAnimatedStyle(() => {
        if (isPrimary) {
            const translateX = interpolate(hoverProgress.value, [0, 1], [0, ICON_HOVER_TRANSLATE_PX]);
            return { transform: [{ translateX }] };
        }
        const scale = interpolate(hoverProgress.value, [0, 1], [1, ICON_HOVER_SCALE]);
        return { transform: [{ scale }] };
    }, [isPrimary]);

    const foregroundColor = isPrimary ? primaryTint : theme.colors.text.primary;
    const subtitleColor = isPrimary ? primaryTint : theme.colors.text.secondary;
    const content = (
        <>
            <View testID={`${props.testID}-text`} style={styles.decisionActionTextBlock}>
                <Text testID={`${props.testID}-title`} style={[styles.decisionActionTitle, { color: foregroundColor }]}>
                    {props.title}
                </Text>
                {props.subtitle ? (
                    <Text testID={`${props.testID}-subtitle`} style={[styles.decisionActionSubtitle, { color: subtitleColor }]}>
                        {props.subtitle}
                    </Text>
                ) : null}
            </View>
            {props.iconName ? (
                supportsHoverAnimation ? (
                    <Animated.View style={iconAnimatedStyle}>
                        <Ionicons
                            testID={`${props.testID}-icon`}
                            name={props.iconName}
                            size={20}
                            color={foregroundColor}
                        />
                    </Animated.View>
                ) : (
                    <View>
                        <Ionicons
                            testID={`${props.testID}-icon`}
                            name={props.iconName}
                            size={20}
                            color={foregroundColor}
                        />
                    </View>
                )
            ) : null}
        </>
    );
    const baseStyle = [
        styles.decisionActionRow,
        isPrimary
            ? {
                backgroundColor: primaryBg,
                borderColor: primaryBg,
            }
            : {
                // The rest backgroundColor is also baked in here so
                // the button reads correctly on first paint before
                // the animated value evaluates. The interpolation
                // above then takes over on hover.
                backgroundColor: surfaceRest,
                borderColor: theme.colors.border.default,
            },
        isPressed ? DECISION_ROW_PRESSED_STYLE : null,
    ];

    if (!supportsHoverAnimation) {
        return (
            <Pressable
                testID={props.testID}
                accessibilityRole="button"
                accessibilityLabel={props.title}
                onPressIn={() => setIsPressed(true)}
                onPressOut={() => setIsPressed(false)}
                onPress={() => {
                    void props.onPress();
                }}
                style={baseStyle}
            >
                {content}
            </Pressable>
        );
    }

    return (
        <AnimatedPressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={props.title}
            onHoverIn={() => setIsHovered(true)}
            onHoverOut={() => setIsHovered(false)}
            onPressIn={() => setIsPressed(true)}
            onPressOut={() => setIsPressed(false)}
            onPress={() => {
                void props.onPress();
            }}
            style={[
                ...baseStyle,
                containerAnimatedStyle,
            ]}
        >
            {content}
        </AnimatedPressable>
    );
}

function formatShortProjectPath(projectPath: string | null): string {
    if (!projectPath) return 'No project selected';
    const parts = projectPath.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) return projectPath;
    return `...\\${parts.slice(-2).join('\\')}`;
}

function runtimePathForCopy(runtime: RuntimeStatus | null): string {
    return runtime?.source === 'bundled-runtime'
        ? 'Bundled DevPilot runtime'
        : runtime?.command ?? 'Bundled DevPilot runtime';
}

function LocalDevPilotSessionPanel(): React.ReactElement {
    const styles = stylesheet;
    const desktop = React.useMemo(() => getDesktopClient(), []);
    const [runtime, setRuntime] = React.useState<RuntimeStatus | null>(null);
    const [codexAuth, setCodexAuth] = React.useState<CodexAuthStatus | null>(null);
    const [projectPath, setProjectPath] = React.useState<string | null>(null);
    const [acpPid, setAcpPid] = React.useState<number | null>(null);
    const [acpSessionId, setAcpSessionId] = React.useState<string | null>(null);
    const [busy, setBusy] = React.useState<'runtime' | 'auth' | 'project' | 'launch' | null>('runtime');
    const [error, setError] = React.useState<string | null>(null);

    const refreshRuntime = React.useCallback(async () => {
        setBusy('runtime');
        setError(null);
        try {
            if (!desktop) {
                setRuntime({
                    ready: false,
                    command: null,
                    source: null,
                    version: null,
                    issue: 'Open DevPilot in the desktop shell to start a local ACP session.',
                });
                return;
            }
            const nextRuntime = await desktop.getRuntimeStatus();
            setRuntime(nextRuntime);
            setCodexAuth(nextRuntime.ready ? await desktop.getCodexAuthStatus() : null);
        } catch (caught) {
            setRuntime(null);
            setError(caught instanceof Error ? caught.message : 'DevPilot runtime detection failed.');
        } finally {
            setBusy(null);
        }
    }, [desktop]);

    React.useEffect(() => {
        void refreshRuntime();
    }, [refreshRuntime]);

    React.useEffect(() => {
        if (!projectPath || acpPid === null) return;
        writeDevPilotLocalSession({
            mode: 'local-acp',
            projectPath,
            acpPid,
            acpSessionId,
            connectedAt: Date.now(),
        });
    }, [acpPid, acpSessionId, projectPath]);

    const chooseProject = React.useCallback(async () => {
        if (!desktop) return;
        setBusy('project');
        setError(null);
        try {
            const selected = await desktop.selectProject();
            if (selected) {
                setProjectPath(selected);
                setAcpPid(null);
                setAcpSessionId(null);
            }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Project selection failed.');
        } finally {
            setBusy(null);
        }
    }, [desktop]);

    const signInWithCodex = React.useCallback(async () => {
        if (!desktop) return;
        setBusy('auth');
        setError(null);
        try {
            await desktop.startCodexLogin();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not start Codex sign-in.');
        } finally {
            setBusy(null);
        }
    }, [desktop]);

    const launchAcp = React.useCallback(async () => {
        if (!desktop) return;
        if (!projectPath) {
            await chooseProject();
            return;
        }
        setBusy('launch');
        setError(null);
        try {
            const result = await desktop.launchAcp(projectPath);
            setAcpPid(result.pid);
            setAcpSessionId(result.sessionId);
            writeDevPilotLocalSession({
                mode: 'local-acp',
                projectPath,
                acpPid: result.pid,
                acpSessionId: result.sessionId,
                connectedAt: Date.now(),
            });
        } catch (caught) {
            setAcpPid(null);
            setAcpSessionId(null);
            setError(caught instanceof Error ? caught.message : 'ACP launch failed.');
        } finally {
            setBusy(null);
        }
    }, [chooseProject, desktop, projectPath]);

    const runtimeReady = runtime?.ready === true;
    const codexReady = codexAuth?.signedIn === true;
    const isRunning = acpPid !== null;
    const statusTitle = error
        ? 'Session needs attention'
        : isRunning
            ? 'ACP session running'
            : projectPath
                ? 'Project selected'
                : !runtimeReady
                    ? busy === 'runtime'
                        ? 'Checking DevPilot'
                        : 'Runtime unavailable'
                    : busy === 'auth'
                        ? 'Opening Codex sign-in'
                        : codexReady
                            ? 'Codex connected'
                            : 'Connect Codex'
    const statusBody = error
        ? error
        : isRunning
            ? `devpilot acp --stdio is running for ${formatShortProjectPath(projectPath)}.`
            : projectPath
                ? 'Launch the local ACP bridge and start a DevPilot session from this workspace.'
                : !runtimeReady
                    ? runtime?.issue ?? 'DevPilot is not ready on this computer yet.'
                    : codexReady
                        ? 'Your account is ready. Choose a project only when you want DevPilot to start a session there.'
                        : codexAuth?.message ?? 'Sign in with your ChatGPT account to use Codex.';
    const primaryTitle = busy === 'auth'
        ? 'Opening Codex sign-in...'
        : !codexReady
            ? 'Sign in with Codex'
            : busy === 'launch'
                ? 'Launching ACP...'
                : isRunning
                    ? 'ACP session running'
                    : projectPath
                        ? 'Launch ACP session'
                        : 'Choose a project for this session';
    const primarySubtitle = projectPath
        ? formatShortProjectPath(projectPath)
        : !codexReady
            ? 'Uses the DevPilot CLI OAuth flow in your browser'
            : 'DevPilot only works inside the folder you choose';

    return (
        <View testID="welcome-decision-panel" style={styles.decisionPanel}>
            <View style={styles.headingBlock}>
                <Text testID="devpilot-session-title" accessibilityRole="header" style={styles.questionTitle}>
                    Connect DevPilot
                </Text>
                <Text testID="devpilot-session-subtitle" accessibilityRole="header" style={styles.questionSubtitleTitle}>
                    Codex workspace
                </Text>
                <Text testID="devpilot-session-body" style={styles.questionBody}>
                    Sign in with Codex first. When you start a session, choose the local project DevPilot should work in.
                </Text>
            </View>
            <View testID="devpilot-local-session-status" style={styles.localSessionBlock}>
                <View style={styles.localSessionTitleRow}>
                    <View style={[styles.localSessionDot, isRunning ? styles.localSessionDotLive : null]} />
                    <Text style={styles.localSessionTitle}>{statusTitle}</Text>
                </View>
                <Text style={styles.localSessionBody}>{statusBody}</Text>
                <Text numberOfLines={1} style={styles.localSessionMeta}>
                    {runtimePathForCopy(runtime)}
                </Text>
            </View>
            <View style={styles.actionStack}>
                <DecisionActionRow
                    testID="devpilot-retry-runtime"
                    title={busy === 'runtime' ? 'Checking runtime...' : 'Retry runtime detection'}
                    iconName="refresh"
                    onPress={refreshRuntime}
                />
                {runtimeReady ? (
                    !codexReady ? (
                        <>
                            <DecisionActionRow
                                testID="devpilot-sign-in-codex"
                                primary
                                title={primaryTitle}
                                subtitle={primarySubtitle}
                                iconName="key-outline"
                                onPress={signInWithCodex}
                            />
                            <DecisionActionRow
                                testID="devpilot-refresh-codex"
                                title="I’ve signed in"
                                subtitle="Check the Codex account connection"
                                iconName="checkmark-circle-outline"
                                onPress={refreshRuntime}
                            />
                        </>
                    ) : (
                        <>
                    <DecisionActionRow
                        testID="devpilot-select-project"
                        title={projectPath ? 'Change local project' : 'Select local project'}
                        subtitle={projectPath ? formatShortProjectPath(projectPath) : 'Choose the folder for this DevPilot session'}
                        iconName="folder-open-outline"
                        onPress={chooseProject}
                    />
                    <DecisionActionRow
                        testID="devpilot-launch-acp"
                        primary
                        title={primaryTitle}
                        subtitle={primarySubtitle}
                        iconName={isRunning ? 'checkmark-circle-outline' : 'terminal-outline'}
                        onPress={isRunning ? () => undefined : launchAcp}
                    />
                        </>
                    )
                ) : null}
            </View>
        </View>
    );
}

export function RemoteWelcomeDecisionPanel(props: RemoteWelcomeDecisionPanelProps): React.ReactElement {
    if ((isElectronDesktop() || devpilotServices.localDesktopEnabled) && !devpilotServices.hostedServicesEnabled) {
        return <LocalDevPilotSessionPanel />;
    }

    return <RemoteRelayWelcomeDecisionPanel {...props} />;
}

function RemoteRelayWelcomeDecisionPanel(props: RemoteWelcomeDecisionPanelProps): React.ReactElement {
    const { options } = props;
    const styles = stylesheet;
    const primarySignupAction = resolvePrimaryAction(options, props);
    // Returning users (those who have authenticated on this device before) get
    // a warmer copy variant — a randomly-rotating warm greeting + an inverted
    // button hierarchy (Login becomes primary because that's the most likely
    // intent for a returning visit). The flag is flipped in
    // AuthContext.loginWithCredentials and preserved on logout, so it remains
    // true across re-installs of the session — exactly like the brand-hero
    // seen flag.
    const isReturningUser = useLocalSetting('hasCompletedAuthOnce');
    const returningGreeting = useReturningGreeting();
    // First-time visitors see the "Happier is the control room… your account is
    // a private key" explainer body. Returning users don't need it — they
    // already know what they're signing into — so we hide it for them.
    const shouldRenderFirstTimeCopy = options.serverAvailability !== 'loading'
        && options.showAuthActions
        && options.showAnonymousSignup
        && !isReturningUser;

    if (options.serverAvailability === 'unavailable' || options.serverAvailability === 'incompatible') {
        return (
            <View testID="welcome-decision-panel" style={styles.decisionPanel}>
                <View testID="welcome-server-unavailable" style={styles.serverUnavailableBlock}>
                    <Text testID="welcome-server-unavailable-title" style={styles.serverUnavailableTitle}>
                        {options.serverAvailability === 'incompatible'
                            ? t('welcome.serverIncompatibleTitle')
                            : t('welcome.serverUnavailableTitle')}
                    </Text>
                    <Text style={styles.serverUnavailableBody}>
                        {options.serverAvailability === 'incompatible'
                            ? t('welcome.serverIncompatibleBody', { serverUrl: options.serverUrlForCopy })
                            : t('welcome.serverUnavailableBody', { serverUrl: options.serverUrlForCopy })}
                    </Text>
                </View>
                <View style={styles.actionStack}>
                    <DecisionActionRow
                        testID="welcome-change-relay"
                        title={t('setupOnboarding.changeRelayAction')}
                        iconName="git-network-outline"
                        onPress={props.onChangeRelay}
                    />
                    <DecisionActionRow
                        testID="welcome-retry-server"
                        title={t('common.retry')}
                        iconName="refresh"
                        onPress={options.retryServerCheck}
                    />
                </View>
            </View>
        );
    }

    return (
        <View testID="welcome-decision-panel" style={styles.decisionPanel}>
            {/*
              * The mobile wordmark is rendered by WorkflowPanel (absolutely
              * pinned to the top-left of the pane) so it stays anchored at the
              * top of the screen while the welcome content sits at the bottom
              * — same coordinates as the brand hero's wordmark so users see
              * the same logo position across both mobile screens.
              */}
            <View style={styles.headingBlock}>
                <Text testID="welcome-question-title" accessibilityRole="header" style={styles.questionTitle}>
                    {isReturningUser ? returningGreeting.title : t('welcome.welcomeQuestionTitle')}
                </Text>
                <Text testID="welcome-question-subtitle" accessibilityRole="header" style={styles.questionSubtitleTitle}>
                    {isReturningUser ? returningGreeting.subtitle : t('welcome.welcomeQuestionSubtitle')}
                </Text>
                {shouldRenderFirstTimeCopy ? (
                    <Text testID="welcome-private-key-copy" style={styles.questionBody}>
                        {t('welcome.welcomeQuestionBody')}
                    </Text>
                ) : null}
            </View>
            {options.showTerminalConnectIntent ? (
                <View testID="welcome-terminal-connect-intent" style={styles.intentBlock}>
                    <Text style={styles.intentTitle}>{t('terminal.connectTerminal')}</Text>
                    <Text style={styles.intentBody}>{t('modals.pleaseSignInFirst')}</Text>
                </View>
            ) : null}
            {options.showSetupIntent ? (
                <View testID="welcome-setup-intent" style={styles.intentBlock}>
                    <Text style={styles.intentTitle}>{t('setupOnboarding.resumeIntentTitle')}</Text>
                    <Text style={styles.intentBody}>{t('setupOnboarding.resumeIntentBody')}</Text>
                </View>
            ) : null}
            {options.serverAvailability === 'loading' ? (
                <View style={styles.serverLoadingBlock}>
                    <ActivitySpinner />
                    <Text testID="welcome-server-loading" style={styles.serverLoadingText}>
                        {t('common.loading')}
                    </Text>
                </View>
            ) : null}
            {options.showAuthActions ? (
                <View style={styles.actionStack}>
                    {(() => {
                        // First-time visitors see Start fresh as the primary CTA
                        // (the expected action when arriving for the first time).
                        // Returning users see Login as the primary CTA — they
                        // almost certainly want to sign back into their existing
                        // account, so we give the filled black slot to Login and
                        // demote Start fresh to the bordered card below.
                        const startFreshButton = options.showAnonymousSignup ? (
                            <DecisionActionRow
                                testID="welcome-primary-start"
                                primary={!isReturningUser}
                                title={isReturningUser ? t('welcome.welcomeReturningStartFreshButton') : t('welcome.welcomePrimaryButton')}
                                subtitle={isReturningUser ? t('welcome.welcomeReturningStartFreshSubtitle') : t('welcome.welcomePrimarySubtitle')}
                                iconName="arrow-forward"
                                onPress={props.onAnonymousSignup}
                            />
                        ) : (
                            <DecisionActionRow
                                testID={
                                    options.primarySignupKind === 'provider-keyed'
                                        ? 'welcome-signup-provider'
                                        : 'welcome-create-account'
                                }
                                primary
                                title={options.primarySignupTitle}
                                iconName={options.primarySignupKind === 'mtls' ? 'shield-checkmark-outline' : 'arrow-forward'}
                                onPress={primarySignupAction}
                            />
                        );
                        const loginButton = (
                            <DecisionActionRow
                                testID="welcome-secondary-login"
                                primary={isReturningUser && options.showAnonymousSignup}
                                title={isReturningUser && options.showAnonymousSignup
                                    ? t('welcome.welcomeReturningLoginButton')
                                    : t('welcome.welcomeSecondaryButton')}
                                subtitle={t('welcome.welcomeSecondarySubtitle')}
                                iconName="qr-code-outline"
                                onPress={props.onRestore}
                            />
                        );
                        const inlineExtras = (
                            <>
                                {options.showMtlsLogin && !options.mtlsPrimary ? (
                                    <DecisionActionRow
                                        testID="welcome-mtls-login"
                                        title={options.mtlsTitle}
                                        iconName="shield-checkmark-outline"
                                        onPress={props.onMtlsLogin}
                                    />
                                ) : null}
                                {options.showProviderSignup && options.showAnonymousSignup && options.providerId ? (
                                    <DecisionActionRow
                                        testID="welcome-signup-provider"
                                        title={options.providerSignupTitle}
                                        iconName="arrow-forward"
                                        onPress={() => props.onProviderSignup(options.providerId!)}
                                    />
                                ) : null}
                                {options.showKeylessProviderLogin && !options.keylessPrimary && options.keylessProviderId ? (
                                    <DecisionActionRow
                                        testID="welcome-login-provider"
                                        title={options.providerKeylessTitle}
                                        iconName="arrow-forward"
                                        onPress={() => props.onKeylessProviderLogin(options.keylessProviderId!)}
                                    />
                                ) : null}
                            </>
                        );
                        // Returning anonymous: Login first (primary), extras,
                        // then Start fresh as a bordered secondary. Anything
                        // else keeps the original first-time ordering with
                        // Login last.
                        return isReturningUser && options.showAnonymousSignup ? (
                            <>
                                {loginButton}
                                {inlineExtras}
                                {startFreshButton}
                            </>
                        ) : (
                            <>
                                {startFreshButton}
                                {inlineExtras}
                                {loginButton}
                            </>
                        );
                    })()}
                </View>
            ) : null}
        </View>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    decisionPanel: {
        width: '100%',
        alignItems: 'center',
        gap: 24,
    },
    headingBlock: {
        width: '100%',
        maxWidth: 520,
        // No vertical gap between the two title lines — matches the brand
        // tagline's `Start anywhere. / Continue everywhere.` rhythm, where
        // line-height == font-size and the lines sit flush against each other.
    },
    questionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 44,
        // line-height == font-size mirrors the brand tagline (48/48). At 44px
        // this gives the same tight, deliberate vertical spacing the planet
        // tagline uses on the left pane.
        lineHeight: 44,
        color: theme.colors.text.primary,
        textAlign: 'left',
    },
    questionSubtitleTitle: {
        ...Typography.default('semiBold'),
        fontSize: 44,
        lineHeight: 44,
        color: theme.colors.text.secondary,
        textAlign: 'left',
    },
    questionBody: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 24,
        color: theme.colors.text.secondary,
        marginTop: 22,
        maxWidth: 440,
    },
    intentBlock: {
        width: '100%',
        maxWidth: 560,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 20,
    },
    intentTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        color: theme.colors.text.primary,
        textAlign: 'center',
        marginBottom: 6,
    },
    intentBody: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        lineHeight: 20,
    },
    serverUnavailableBlock: {
        width: '100%',
        maxWidth: 560,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 20,
    },
    serverUnavailableTitle: {
        ...Typography.default('semiBold'),
        fontSize: 22,
        lineHeight: 28,
        color: theme.colors.text.primary,
        textAlign: 'center',
        marginBottom: 8,
    },
    serverUnavailableBody: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        lineHeight: 20,
    },
    serverLoadingBlock: {
        width: '100%',
        maxWidth: 560,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    serverLoadingText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.secondary,
        textAlign: 'center',
        marginTop: 10,
    },
    localSessionBlock: {
        width: '100%',
        maxWidth: 560,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 4,
    },
    localSessionTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
    },
    localSessionDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors.text.tertiary,
    },
    localSessionDotLive: {
        backgroundColor: '#17B26A',
    },
    localSessionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        lineHeight: 22,
        color: theme.colors.text.primary,
    },
    localSessionBody: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.secondary,
        lineHeight: 20,
    },
    localSessionMeta: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.text.tertiary,
        lineHeight: 17,
        marginTop: 10,
    },
    actionStack: {
        width: '100%',
        maxWidth: 520,
        gap: 12,
    },
    decisionActionRow: {
        minHeight: 66,
        borderRadius: 14,
        borderWidth: 1,
        paddingHorizontal: 18,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
    },
    decisionActionTextBlock: {
        flex: 1,
        gap: 0,
    },
    decisionActionTitle: {
        ...Typography.default('semiBold'),
        fontSize: 16,
        lineHeight: 22,
    },
    decisionActionSubtitle: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
    },
}));
