export const DEVPILOT_EVENT_TYPES = [
  'session.started',
  'session.ended',
  'cycle.started',
  'cycle.completed',
  'coordinator.progress',
  'hypothesis.created',
  'hypothesis.updated',
  'executor.started',
  'executor.progress',
  'executor.completed',
  'executor.failed',
  'tool.called',
  'tool.completed',
  'tool.failed',
  'evidence.created',
  'report.generated',
  'permission.requested',
  'permission.resolved',
  'run.cancelled',
  'run.failed',
  'user.await',
  'user.input',
  'usage.updated',
  'artifact.created',
  'memory.created',
  'audit.completed',
  'file.changed',
] as const;

export type DevPilotEventType = (typeof DEVPILOT_EVENT_TYPES)[number];
export type RunStatus = 'idle' | 'running' | 'awaiting-input' | 'completed' | 'failed' | 'cancelled';
export type HypothesisStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'done'
  | 'merged'
  | 'failed'
  | 'pruned'
  | 'awaiting-input'
  | 'cancelled';
export type ExecutorStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type DevPilotEvent = Readonly<{
  type: DevPilotEventType;
  originalType: string;
  timestamp: string | null;
  runId: string | null;
  sessionId: string | null;
  cycleId: string | null;
  hypothesisId: string | null;
  executorId: string | null;
  toolName: string | null;
  status: string | null;
  summary: string | null;
  data: Readonly<Record<string, unknown>>;
}>;

export type HypothesisNode = Readonly<{
  id: string;
  hypothesis: string;
  parentId: string | null;
  depth: number;
  status: HypothesisStatus;
  score: number | null;
  result: string | null;
  insight: string | null;
  executorId: string | null;
  evidenceCount: number;
  changedFiles: readonly string[];
  tests: readonly string[];
  createdAt: string | null;
  updatedAt: string | null;
}>;

export type ExecutorState = Readonly<{
  id: string;
  hypothesisId: string | null;
  hypothesis: string | null;
  task: string | null;
  status: ExecutorStatus;
  branch: string | null;
  worktree: string | null;
  changedFiles: readonly string[];
  tests: readonly string[];
  testStatus: string | null;
  startedAt: string | null;
  completedAt: string | null;
  latestMessage: string | null;
  summary: string | null;
  failure: string | null;
}>;

export type EvidenceRecord = Readonly<{
  id: string;
  title: string;
  url: string | null;
  provider: string | null;
  channel: string | null;
  excerpt: string | null;
  contentPath: string | null;
  timestamp: string | null;
  hypothesisId: string | null;
  sessionId: string | null;
  relevance: number | null;
}>;

export type ReportArtifact = Readonly<{
  id: string;
  name: string;
  path: string | null;
  kind: 'report' | 'artifact' | 'memory' | 'audit';
  timestamp: string | null;
  summary: string | null;
}>;

export type ApprovalRequest = Readonly<{
  id: string;
  operation: string;
  reason: string | null;
  action: string | null;
  files: readonly string[];
  repository: string | null;
  risk: string | null;
  executorId: string | null;
  hypothesisId: string | null;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string | null;
  resolvedAt: string | null;
}>;

export type ResearchRunState = Readonly<{
  runId: string | null;
  sessionId: string;
  projectPath: string | null;
  task: string | null;
  mode: string | null;
  status: RunStatus;
  provider: string | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  currentCycle: number;
  totalCycles: number | null;
  coordinator: Readonly<{
    status: RunStatus;
    activity: string | null;
    currentHypothesisId: string | null;
    turns: number;
    lastEvent: string | null;
    pendingQuestion: string | null;
  }>;
  hypotheses: Readonly<Record<string, HypothesisNode>>;
  hypothesisOrder: readonly string[];
  executors: Readonly<Record<string, ExecutorState>>;
  executorOrder: readonly string[];
  evidence: readonly EvidenceRecord[];
  artifacts: readonly ReportArtifact[];
  approvals: readonly ApprovalRequest[];
  changedFiles: readonly string[];
  branch: string | null;
  worktree: string | null;
  usage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }>;
}>;
