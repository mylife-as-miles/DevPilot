import assert from 'node:assert/strict';
import test from 'node:test';

import { isLocalDevPilotAllowedAppPath } from './devpilotLocalRouteAccess.ts';

const localSession = 'session/with a space';
const allowed = (pathname: string, routeSessionId = '') => isLocalDevPilotAllowedAppPath({
    pathname,
    localAcpSessionId: localSession,
    routeSessionId,
});

test('allows only the local ACP session and local desktop shell routes', () => {
    assert.equal(allowed('/'), true);
    assert.equal(allowed(`/session/${encodeURIComponent(localSession)}`), true);
    assert.equal(allowed('/session/anything', localSession), true);
    assert.equal(allowed('/settings/appearance'), true);
    assert.equal(allowed('/new'), true);
    assert.equal(allowed('/automations/new'), true);
    assert.equal(allowed('/session/another-session', 'another-session'), false);
    assert.equal(allowed('/friends/manage'), false);
    assert.equal(allowed('/terminal/connect'), false);
});
