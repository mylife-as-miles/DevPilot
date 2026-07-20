import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createExpoRouterMock, renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('@/assets/images/logotype-light.png', () => ({ default: 'logotype-light' }));
vi.mock('@/assets/images/logotype-dark.png', () => ({ default: 'logotype-dark' }));

const expoRouterMock = createExpoRouterMock({
    router: { push: vi.fn(), replace: vi.fn() },
});
vi.mock('expo-router', () => expoRouterMock.module);

const mainViewSpy = vi.hoisted(() => vi.fn());
const devPilotLocalNewSessionSpy = vi.hoisted(() => vi.fn());
const workspaceBridgeSpy = vi.hoisted(() => vi.fn());

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: false,
        credentials: null,
        login: vi.fn(async () => {}),
        logout: vi.fn(async () => {}),
    }),
}));

vi.mock('@/config/devpilotServices', () => ({
    devpilotServices: {
        apiUrl: null,
        relayUrl: null,
        hostedServicesEnabled: false,
        localDesktopEnabled: true,
    },
    isElectronDesktop: () => true,
}));

vi.mock('@/config/devpilotLocalSession', () => ({
    isLocalDevPilotDesktopMode: () => true,
    readDevPilotLocalSession: () => null,
    writeDevPilotLocalSession: () => {},
    clearDevPilotLocalSession: () => {},
    useDevPilotLocalSession: () => null,
}));

vi.mock('@/config/devpilotLocalConversation', () => ({
    useDevPilotConversationWorkspaceBridge: (enabled: boolean) => workspaceBridgeSpy(enabled),
}));

vi.mock('@/components/navigation/shell/MainView', () => ({
    MainView: (props: { variant: 'phone' | 'sidebar' }) => {
        mainViewSpy(props);
        return React.createElement('MainView', props);
    },
}));

vi.mock('@/devpilot/views/DevPilotLocalNewSessionScreen', () => ({
    DevPilotLocalNewSessionScreen: () => {
        devPilotLocalNewSessionSpy();
        return React.createElement('DevPilotLocalNewSessionScreen');
    },
}));

vi.mock('@/utils/platform/responsive', () => ({
    useIsTablet: () => true,
}));

vi.mock('@/components/account/auth/RemoteWelcomeDecisionPanel', () => ({
    RemoteWelcomeDecisionPanel: () => React.createElement('RemoteWelcomeDecisionPanel'),
}));

vi.mock('@/components/onboarding/unauthShell', () => ({
    UnauthenticatedSplitShell: (props: { children?: React.ReactNode; testID?: string }) =>
        React.createElement('UnauthenticatedSplitShell', { testID: props.testID }, props.children),
    useApplyBrandHeroSeen: () => vi.fn(),
}));

vi.mock('@/sync/domains/pending/pendingTerminalConnect', () => ({
    getPendingTerminalConnect: () => null,
}));

vi.mock('@/sync/domains/pending/pendingSetupIntent', () => ({
    getPendingSetupIntent: () => null,
    setPendingSetupIntent: vi.fn(),
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: vi.fn(async () => ({ status: 'ready', features: { capabilities: { auth: { methods: [] } } } })),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverUrl: null }),
}));

vi.mock('@/utils/platform/tauri', () => ({
    isTauriDesktop: () => false,
}));

vi.mock('@/encryption/libsodium.lib', () => ({
    default: {
        crypto_sign_seed_keypair: () => ({
            publicKey: new Uint8Array(),
            privateKey: new Uint8Array(),
        }),
    },
}));

describe('/ local DevPilot desktop route', () => {
    beforeEach(() => {
        vi.resetModules();
        mainViewSpy.mockClear();
        devPilotLocalNewSessionSpy.mockClear();
        workspaceBridgeSpy.mockClear();
    });

    afterEach(standardCleanup);

    it('renders the local workspace primary pane immediately instead of the unauthenticated shell', async () => {
        const Screen = (await import('@/app/(app)/index')).default;
        const screen = await renderScreen(React.createElement(Screen));

        expect(mainViewSpy).not.toHaveBeenCalled();
        expect(devPilotLocalNewSessionSpy).toHaveBeenCalledTimes(1);
        expect(workspaceBridgeSpy).toHaveBeenCalledWith(true);
        expect(screen.findAllByType('DevPilotLocalNewSessionScreen' as any)).toHaveLength(1);
        expect(screen.findAllByType('UnauthenticatedSplitShell' as any)).toHaveLength(0);
    });
});
