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

export type DevPilotTaskStatus = 'draft' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export type DevPilotTaskMessage = Readonly<{
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  kind: 'message' | 'thinking';
  createdAt: number;
}>;

export type DevPilotTask = Readonly<{
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  status: DevPilotTaskStatus;
  acpSessionId: string | null;
  model: string;
  reasoningEffort: string;
  messages: readonly DevPilotTaskMessage[];
}>;

export type DevPilotProject = Readonly<{
  id: string;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
  tasks: readonly DevPilotTask[];
}>;

export type DevPilotWorkspace = Readonly<{
  version: 1;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  projects: readonly DevPilotProject[];
}>;

export type CreateDevPilotTaskInput = Readonly<{
  prompt: string;
  model?: string;
  reasoningEffort?: string;
}>;

export type DevPilotTaskUpdate = Readonly<{
  taskId: string;
  type: 'status' | 'acp-update';
  status?: DevPilotTaskStatus;
  error?: string;
  update?: AcpUpdate;
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
  getWorkspace: () => Promise<DevPilotWorkspace>;
  addProject: () => Promise<DevPilotWorkspace | null>;
  activateProject: (projectId: string) => Promise<DevPilotWorkspace>;
  activateTask: (taskId: string) => Promise<DevPilotWorkspace>;
  createTask: (projectId: string, input: CreateDevPilotTaskInput) => Promise<Readonly<{ workspace: DevPilotWorkspace; task: DevPilotTask }>>;
  sendTaskPrompt: (taskId: string, prompt: string, input?: Omit<CreateDevPilotTaskInput, 'prompt'>) => Promise<DevPilotWorkspace>;
  cancelTask: (taskId: string) => Promise<DevPilotWorkspace>;
  launchAcp: (projectPath: string) => Promise<AcpSession>;
  restoreAcp: () => Promise<RestoredAcpSession | null>;
  startAcpPrompt: (sessionId: string, prompt: string) => Promise<unknown>;
  cancelAcpRun: (sessionId: string) => Promise<unknown>;
  preflight: (projectPath: string, options?: Record<string, unknown>) => Promise<PreflightResult>;
  getRuntimeLogs: () => Promise<readonly RuntimeLogEntry[]>;
  clearRuntimeLogs: () => Promise<void>;
  onRuntimeLog: (listener: (entry: RuntimeLogEntry) => void) => () => void;
  onAcpUpdate: (listener: (update: AcpUpdate) => void) => () => void;
  onWorkspaceChanged: (listener: (workspace: DevPilotWorkspace) => void) => () => void;
  onTaskUpdate: (listener: (update: DevPilotTaskUpdate) => void) => () => void;
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
    && typeof candidate.getWorkspace === 'function'
    && typeof candidate.addProject === 'function'
    && typeof candidate.activateProject === 'function'
    && typeof candidate.activateTask === 'function'
    && typeof candidate.createTask === 'function'
    && typeof candidate.sendTaskPrompt === 'function'
    && typeof candidate.cancelTask === 'function'
    && typeof candidate.launchAcp === 'function'
    && typeof candidate.restoreAcp === 'function'
    && typeof candidate.startAcpPrompt === 'function'
    && typeof candidate.cancelAcpRun === 'function'
    && typeof candidate.preflight === 'function'
    && typeof candidate.getRuntimeLogs === 'function'
    && typeof candidate.clearRuntimeLogs === 'function'
    && typeof candidate.onRuntimeLog === 'function'
    && typeof candidate.onAcpUpdate === 'function'
    && typeof candidate.onWorkspaceChanged === 'function'
    && typeof candidate.onTaskUpdate === 'function'
    ? candidate as DesktopClient
    : null;
}
