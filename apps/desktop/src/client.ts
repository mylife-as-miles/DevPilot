/** Typed renderer boundary for the local DevPilot desktop shell. */

export type RuntimeStatus = Readonly<{
  ready: boolean;
  command: string | null;
  source: 'configured' | 'repository-virtual-environment' | 'path' | null;
  version: string | null;
  issue: string | null;
}>;

export type DesktopClient = Readonly<{
  getRuntimeStatus: () => Promise<RuntimeStatus>;
  selectProject: () => Promise<string | null>;
  launchAcp: (projectPath: string) => Promise<{ pid: number }>;
}>;

type DesktopGlobal = typeof globalThis & {
  __DEVPILOT_ELECTRON__?: Partial<DesktopClient>;
};

export function getDesktopClient(target: DesktopGlobal = globalThis): DesktopClient | null {
  const candidate = target.__DEVPILOT_ELECTRON__;
  return candidate
    && typeof candidate.getRuntimeStatus === 'function'
    && typeof candidate.selectProject === 'function'
    && typeof candidate.launchAcp === 'function'
    ? candidate as DesktopClient
    : null;
}
