export function isLocalDevPilotAllowedAppPath(input: Readonly<{
    pathname: string;
    localAcpSessionId: string;
    routeSessionId: string;
}>): boolean {
    const pathname = String(input.pathname || '/').replace(/\/+$/, '') || '/';
    if (pathname === '/') return true;

    if (
        input.localAcpSessionId
        && (
            pathname === `/session/${encodeURIComponent(input.localAcpSessionId)}`
            || (pathname.startsWith('/session/') && input.routeSessionId === input.localAcpSessionId)
        )
    ) {
        return true;
    }

    return pathname === '/settings'
        || pathname.startsWith('/settings/')
        || pathname === '/new'
        || pathname.startsWith('/new/')
        || pathname === '/session/recent'
        || pathname === '/session/archived'
        || pathname === '/automations'
        || pathname.startsWith('/automations/');
}
