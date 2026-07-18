/** Typed renderer boundary for the local DevPilot desktop shell. */

export type RuntimeStatus = Readonly<{
  ready: boolean;
  command: string | null;
  source: 'bundled-runtime' | 'configured' | 'repository-virtual-environment' | 'path' | null;
  version: string | null;
  issue: string | null;
}>;

export type CodexAuthStatus = Readonly<{
  runtimeReady: boolean;
  signedIn: boolean;
  message: string;
}>;

export type AcpSession = Readonly<{
  pid: number;
  sessionId: string;
}>;

export type RestoredAcpSession = AcpSession & Readonly<{
  projectPath: string;
  historicalAcpSessionId: string | null;
}>;

export type AcpUpdate = Readonly<{
  sessionId?: string;
  update?: Readonly<{
    sessionUpdate?: string;
    content?: Readonly<{ type?: string; text?: string }>;
    _meta?: Readonly<{ devpilot?: Readonly<{ type?: string; [key: string]: unknown }> }>;
  }>;
}>;

export type RuntimeLogEntry = Readonly<{
  timestamp: number;
  stream: 'stderr';
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
}>;

export type PreflightResult = Readonly<{
  ready: boolean;
  checks: readonly Readonly<{ id: string; status: 'pass' | 'warn' | 'fail'; message: string; remediation?: string }> [];
}>;

export type DesktopClient = Readonly<{
  getRuntimeStatus: () => Promise<RuntimeStatus>;
  getCodexAuthStatus: () => Promise<CodexAuthStatus>;
  startCodexLogin: () => Promise<Readonly<{ pid: number; alreadyRunning: boolean }>>;
  selectProject: () => Promise<string | null>;
  launchAcp: (projectPath: string) => Promise<AcpSession>;
  restoreAcp: () => Promise<RestoredAcpSession | null>;
  startAcpPrompt: (sessionId: string, prompt: string) => Promise<unknown>;
  cancelAcpRun: (sessionId: string) => Promise<unknown>;
  preflight: (projectPath: string, options?: Record<string, unknown>) => Promise<PreflightResult>;
  getRuntimeLogs: () => Promise<readonly RuntimeLogEntry[]>;
  clearRuntimeLogs: () => Promise<void>;
  onRuntimeLog: (listener: (entry: RuntimeLogEntry) => void) => () => void;
  onAcpUpdate: (listener: (update: AcpUpdate) => void) => () => void;
}>;

type DesktopGlobal = typeof globalThis & {
  __DEVPILOT_ELECTRON__?: Partial<DesktopClient>;
};

export function getDesktopClient(target: DesktopGlobal = globalThis): DesktopClient | null {
  const candidate = target.__DEVPILOT_ELECTRON__;
  return candidate
    && typeof candidate.getRuntimeStatus === 'function'
    && typeof candidate.getCodexAuthStatus === 'function'
    && typeof candidate.startCodexLogin === 'function'
    && typeof candidate.selectProject === 'function'
    && typeof candidate.launchAcp === 'function'
    && typeof candidate.restoreAcp === 'function'
    && typeof candidate.startAcpPrompt === 'function'
    && typeof candidate.cancelAcpRun === 'function'
    && typeof candidate.preflight === 'function'
    && typeof candidate.getRuntimeLogs === 'function'
    && typeof candidate.clearRuntimeLogs === 'function'
    && typeof candidate.onRuntimeLog === 'function'
    && typeof candidate.onAcpUpdate === 'function'
    ? candidate as DesktopClient
    : null;
}
