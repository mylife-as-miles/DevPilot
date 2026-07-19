import * as React from 'react';
import { useRouter } from 'expo-router';

import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { useAuth } from '@/auth/context/AuthContext';
import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { markSessionOpenRequestedForSessionUiTelemetry } from '@/sync/runtime/performance/sessionUiTelemetry';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { buildScopedSessionRouteHref } from './sessionRouteServerScope';
import { isLocalDevPilotDesktopMode } from '@/config/devpilotLocalSession';
import {
    isKnownDevPilotConversationId,
    selectDevPilotConversation,
} from '@/devpilot/domain/conversations';

export function useNavigateToSession() {
    const router = useRouter();
    const auth = useAuth();

    return React.useCallback(async (sessionId: string, opts?: Readonly<{ serverId?: string }>) => {
        if (isLocalDevPilotDesktopMode() && isKnownDevPilotConversationId(sessionId)) {
            fireAndForget(selectDevPilotConversation(sessionId), { tag: 'DevPilot.navigateConversation.open' });
            const href = buildScopedSessionRouteHref({
                sessionId,
                serverId: null,
            });
            markSessionOpenRequestedForSessionUiTelemetry({
                sessionId,
                source: 'navigate-hook',
            });
            router.navigate(href, {
                dangerouslySingular() {
                    return 'session';
                },
            });
            return;
        }

        const targetServerId = String(opts?.serverId ?? '').trim() || resolveServerIdForSessionIdFromLocalCache(sessionId);
        const href = buildScopedSessionRouteHref({
            sessionId,
            serverId: targetServerId || null,
        });
        markSessionOpenRequestedForSessionUiTelemetry({
            sessionId,
            source: 'navigate-hook',
        });
        router.navigate(href, {
            dangerouslySingular(name, params) {
                return 'session';
            },
        });

        if (targetServerId) {
            // Keep route navigation independent; the explicit server scope lets hydration recover if switching fails.
            fireAndForget(setActiveServerAndSwitch({
                serverId: targetServerId,
                scope: 'device',
                refreshAuth: auth.refreshFromActiveServer,
            }));
        }
    }, [auth.refreshFromActiveServer, router]);
}
