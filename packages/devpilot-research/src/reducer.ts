import type {
  ApprovalRequest,
  DevPilotEvent,
  EvidenceRecord,
  ExecutorState,
  ExecutorStatus,
  HypothesisNode,
  HypothesisStatus,
  ReportArtifact,
  ResearchRunState,
  RunStatus,
} from './types.ts';

export function createInitialResearchRunState(sessionId: string): ResearchRunState {
  return Object.freeze({
    runId: null,
    sessionId,
    projectPath: null,
    task: null,
    mode: null,
    status: 'idle',
    provider: null,
    model: null,
    startedAt: null,
    endedAt: null,
    currentCycle: 0,
    totalCycles: null,
    coordinator: Object.freeze({
      status: 'idle',
      activity: null,
      currentHypothesisId: null,
      turns: 0,
      lastEvent: null,
      pendingQuestion: null,
    }),
    hypotheses: Object.freeze({}),
    hypothesisOrder: Object.freeze([]),
    executors: Object.freeze({}),
    executorOrder: Object.freeze([]),
    evidence: Object.freeze([]),
    artifacts: Object.freeze([]),
    approvals: Object.freeze([]),
    changedFiles: Object.freeze([]),
    branch: null,
    worktree: null,
    usage: Object.freeze({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  });
}

function text(data: Readonly<Record<string, unknown>>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function numberValue(data: Readonly<Record<string, unknown>>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function strings(data: Readonly<Record<string, unknown>>, ...keys: string[]): readonly string[] {
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return Object.freeze(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0));
    if (typeof value === 'string' && value.trim()) return Object.freeze([value.trim()]);
  }
  return Object.freeze([]);
}

function hypothesisStatus(event: DevPilotEvent, current: HypothesisStatus = 'pending'): HypothesisStatus {
  const raw = (event.status ?? text(event.data, 'status') ?? '').toLowerCase();
  if (event.originalType === 'idea.pruned') return 'pruned';
  if (event.originalType === 'idea.merged') return 'merged';
  if (event.originalType === 'idea.completed') return raw === 'failed' ? 'failed' : 'done';
  if (['pending', 'queued', 'running', 'done', 'merged', 'failed', 'pruned', 'awaiting-input', 'cancelled'].includes(raw)) {
    return raw as HypothesisStatus;
  }
  return current;
}

function executorStatus(event: DevPilotEvent): ExecutorStatus {
  if (event.type === 'executor.started') return 'running';
  if (event.type === 'executor.failed') return 'failed';
  if (event.type === 'executor.completed') return 'completed';
  const raw = (event.status ?? '').toLowerCase();
  return ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(raw) ? raw as ExecutorStatus : 'running';
}

function updateCoordinator(state: ResearchRunState, event: DevPilotEvent, updates: Partial<ResearchRunState['coordinator']> = {}) {
  return Object.freeze({
    ...state.coordinator,
    lastEvent: event.originalType,
    ...updates,
  });
}

export function reduceResearchRun(state: ResearchRunState, event: DevPilotEvent): ResearchRunState {
  const data = event.data;
  const base = { ...state, runId: event.runId ?? state.runId };

  if (event.type === 'session.started') {
    return Object.freeze({
      ...base,
      sessionId: event.sessionId ?? state.sessionId,
      projectPath: text(data, 'cwd', 'project', 'project_path') ?? state.projectPath,
      task: text(data, 'task', 'instruction') ?? state.task,
      mode: text(data, 'mode') ?? state.mode,
      status: 'running',
      provider: text(data, 'provider') ?? state.provider,
      model: text(data, 'model') ?? state.model,
      startedAt: event.timestamp ?? state.startedAt,
      coordinator: updateCoordinator(state, event, { status: 'running', activity: 'Starting research run' }),
    });
  }
  if (event.type === 'session.ended') {
    const exitReason = text(data, 'exit_reason', 'reason') ?? 'completed';
    const status: RunStatus = exitReason === 'ok' || exitReason === 'completed' ? 'completed' : exitReason === 'cancelled' || exitReason === 'interrupted' ? 'cancelled' : 'failed';
    return Object.freeze({
      ...base,
      status,
      endedAt: event.timestamp,
      coordinator: updateCoordinator(state, event, { status, activity: `Run ${exitReason}`, pendingQuestion: null }),
    });
  }
  if (event.type === 'cycle.started' || event.type === 'cycle.completed') {
    const cycle = numberValue(data, 'cycle_num', 'cycle', 'number') ?? state.currentCycle;
    const total = numberValue(data, 'total_cycles', 'total') ?? state.totalCycles;
    return Object.freeze({
      ...base,
      currentCycle: cycle,
      totalCycles: total,
      coordinator: updateCoordinator(state, event, {
        status: 'running',
        activity: event.type === 'cycle.started' ? `Cycle ${cycle} started` : `Cycle ${cycle} completed`,
      }),
    });
  }
  if (event.type === 'coordinator.progress') {
    return Object.freeze({
      ...base,
      coordinator: updateCoordinator(state, event, {
        status: 'running',
        activity: event.summary ?? text(data, 'phase', 'activity', 'detail'),
        currentHypothesisId: event.hypothesisId ?? state.coordinator.currentHypothesisId,
      }),
    });
  }
  if (event.type === 'hypothesis.created' || event.type === 'hypothesis.updated') {
    const id = event.hypothesisId ?? text(data, 'id');
    if (!id) return state;
    const current = state.hypotheses[id];
    const node: HypothesisNode = Object.freeze({
      id,
      hypothesis: text(data, 'hypothesis', 'idea', 'title') ?? current?.hypothesis ?? `Hypothesis ${id}`,
      parentId: text(data, 'parent_id', 'parentId') ?? current?.parentId ?? null,
      depth: numberValue(data, 'depth') ?? current?.depth ?? 0,
      status: hypothesisStatus(event, current?.status),
      score: numberValue(data, 'score') ?? current?.score ?? null,
      result: text(data, 'result') ?? current?.result ?? null,
      insight: text(data, 'insight') ?? current?.insight ?? null,
      executorId: event.executorId ?? text(data, 'assigned_executor', 'executor') ?? current?.executorId ?? null,
      evidenceCount: numberValue(data, 'evidence_count', 'evidenceCount') ?? current?.evidenceCount ?? 0,
      changedFiles: strings(data, 'changed_files', 'changedFiles').length ? strings(data, 'changed_files', 'changedFiles') : current?.changedFiles ?? Object.freeze([]),
      tests: strings(data, 'tests').length ? strings(data, 'tests') : current?.tests ?? Object.freeze([]),
      createdAt: current?.createdAt ?? event.timestamp,
      updatedAt: event.timestamp,
    });
    return Object.freeze({
      ...base,
      hypotheses: Object.freeze({ ...state.hypotheses, [id]: node }),
      hypothesisOrder: current ? state.hypothesisOrder : Object.freeze([...state.hypothesisOrder, id]),
      coordinator: updateCoordinator(state, event, { currentHypothesisId: id, status: node.status === 'awaiting-input' ? 'awaiting-input' : 'running' }),
    });
  }
  if (event.type.startsWith('executor.')) {
    const id = event.executorId ?? event.hypothesisId ?? text(data, 'id', 'node_id');
    if (!id) return state;
    const current = state.executors[id];
    const executor: ExecutorState = Object.freeze({
      id,
      hypothesisId: event.hypothesisId ?? current?.hypothesisId ?? null,
      hypothesis: text(data, 'hypothesis', 'idea') ?? current?.hypothesis ?? null,
      task: text(data, 'task') ?? current?.task ?? null,
      status: executorStatus(event),
      branch: text(data, 'branch') ?? current?.branch ?? null,
      worktree: text(data, 'worktree', 'worktree_path') ?? current?.worktree ?? null,
      changedFiles: strings(data, 'changed_files', 'changedFiles').length ? strings(data, 'changed_files', 'changedFiles') : current?.changedFiles ?? Object.freeze([]),
      tests: strings(data, 'tests').length ? strings(data, 'tests') : current?.tests ?? Object.freeze([]),
      testStatus: text(data, 'test_status', 'testStatus') ?? current?.testStatus ?? null,
      startedAt: current?.startedAt ?? (event.type === 'executor.started' ? event.timestamp : null),
      completedAt: event.type === 'executor.completed' || event.type === 'executor.failed' ? event.timestamp : current?.completedAt ?? null,
      latestMessage: event.summary ?? text(data, 'latest_message', 'message', 'detail') ?? current?.latestMessage ?? null,
      summary: text(data, 'completion_summary', 'summary') ?? current?.summary ?? null,
      failure: event.type === 'executor.failed' ? text(data, 'error', 'failure', 'reason') ?? 'Executor failed' : current?.failure ?? null,
    });
    return Object.freeze({
      ...base,
      executors: Object.freeze({ ...state.executors, [id]: executor }),
      executorOrder: current ? state.executorOrder : Object.freeze([...state.executorOrder, id]),
      branch: executor.branch ?? state.branch,
      worktree: executor.worktree ?? state.worktree,
      changedFiles: Object.freeze([...new Set([...state.changedFiles, ...executor.changedFiles])]),
      coordinator: updateCoordinator(state, event, { status: 'running', currentHypothesisId: executor.hypothesisId }),
    });
  }
  if (event.type === 'tool.called' || event.type === 'tool.completed' || event.type === 'tool.failed') {
    const executorId = event.executorId ?? text(data, 'agent')?.replace(/^sub:/, '') ?? null;
    const current = executorId ? state.executors[executorId] : null;
    if (!executorId || !current) return Object.freeze({ ...base, coordinator: updateCoordinator(state, event, { activity: `${event.toolName ?? 'Tool'} ${event.type.split('.')[1]}` }) });
    const executor: ExecutorState = Object.freeze({ ...current, latestMessage: event.summary ?? `${event.toolName ?? 'Tool'} ${event.type.split('.')[1]}` });
    return Object.freeze({ ...base, executors: Object.freeze({ ...state.executors, [executorId]: executor }), coordinator: updateCoordinator(state, event) });
  }
  if (event.type === 'evidence.created') {
    const id = text(data, 'evidence_id', 'id') ?? `${event.timestamp ?? 'evidence'}:${state.evidence.length}`;
    if (state.evidence.some((item) => item.id === id)) return state;
    const evidence: EvidenceRecord = Object.freeze({
      id,
      title: text(data, 'source_title', 'title') ?? 'Research evidence',
      url: text(data, 'source_url', 'url'),
      provider: text(data, 'source_provider', 'provider'),
      channel: text(data, 'source_channel', 'channel'),
      excerpt: text(data, 'excerpt', 'summary'),
      contentPath: text(data, 'content_path', 'path'),
      timestamp: event.timestamp,
      hypothesisId: event.hypothesisId,
      sessionId: event.sessionId ?? state.sessionId,
      relevance: numberValue(data, 'confidence', 'relevance'),
    });
    return Object.freeze({ ...base, evidence: Object.freeze([...state.evidence, evidence]), coordinator: updateCoordinator(state, event) });
  }
  if (['report.generated', 'artifact.created', 'memory.created', 'audit.completed'].includes(event.type)) {
    const kind: ReportArtifact['kind'] = event.type === 'report.generated' ? 'report' : event.type === 'memory.created' ? 'memory' : event.type === 'audit.completed' ? 'audit' : 'artifact';
    const id = text(data, 'artifact_id', 'report_id', 'memory_id', 'audit_id', 'id', 'path') ?? `${kind}:${state.artifacts.length}`;
    if (state.artifacts.some((item) => item.id === id)) return state;
    const artifact: ReportArtifact = Object.freeze({
      id,
      name: text(data, 'name', 'title') ?? (kind === 'report' ? 'REPORT.md' : kind),
      path: text(data, 'path', 'report_path'),
      kind,
      timestamp: event.timestamp,
      summary: event.summary ?? text(data, 'summary'),
    });
    return Object.freeze({ ...base, artifacts: Object.freeze([...state.artifacts, artifact]), coordinator: updateCoordinator(state, event) });
  }
  if (event.type === 'permission.requested') {
    const id = text(data, 'permission_id', 'id') ?? `permission:${state.approvals.length}`;
    if (state.approvals.some((item) => item.id === id)) return state;
    const approval: ApprovalRequest = Object.freeze({
      id,
      operation: text(data, 'operation', 'category', 'tool_name') ?? 'Sensitive action',
      reason: text(data, 'reason'),
      action: text(data, 'command', 'action'),
      files: strings(data, 'affected_files', 'files'),
      repository: text(data, 'repository'),
      risk: text(data, 'risk', 'risk_level'),
      executorId: event.executorId,
      hypothesisId: event.hypothesisId,
      status: 'pending',
      requestedAt: event.timestamp,
      resolvedAt: null,
    });
    return Object.freeze({ ...base, approvals: Object.freeze([...state.approvals, approval]), coordinator: updateCoordinator(state, event, { status: 'awaiting-input' }) });
  }
  if (event.type === 'permission.resolved') {
    const id = text(data, 'permission_id', 'id');
    if (!id) return state;
    const decision = text(data, 'decision', 'result') === 'approved' ? 'approved' : 'denied';
    return Object.freeze({
      ...base,
      approvals: Object.freeze(state.approvals.map((item) => item.id === id ? Object.freeze({ ...item, status: decision, resolvedAt: event.timestamp }) : item)),
      coordinator: updateCoordinator(state, event, { status: 'running' }),
    });
  }
  if (event.type === 'user.await') {
    return Object.freeze({ ...base, status: 'awaiting-input', coordinator: updateCoordinator(state, event, { status: 'awaiting-input', pendingQuestion: text(data, 'prompt', 'question') }) });
  }
  if (event.type === 'user.input') {
    return Object.freeze({ ...base, status: 'running', coordinator: updateCoordinator(state, event, { status: 'running', pendingQuestion: null }) });
  }
  if (event.type === 'usage.updated') {
    const input = numberValue(data, 'input_tokens') ?? 0;
    const output = numberValue(data, 'output_tokens') ?? 0;
    const usage = Object.freeze({ inputTokens: state.usage.inputTokens + input, outputTokens: state.usage.outputTokens + output, totalTokens: state.usage.totalTokens + input + output });
    return Object.freeze({ ...base, usage, coordinator: Object.freeze({ ...updateCoordinator(state, event), turns: state.coordinator.turns + 1 }) });
  }
  if (event.type === 'run.cancelled' || event.type === 'run.failed') {
    const status: RunStatus = event.type === 'run.cancelled' ? 'cancelled' : 'failed';
    return Object.freeze({ ...base, status, endedAt: event.timestamp, coordinator: updateCoordinator(state, event, { status, activity: event.summary }) });
  }
  if (event.type === 'file.changed') {
    const files = strings(data, 'path', 'files', 'changed_files');
    return Object.freeze({ ...base, changedFiles: Object.freeze([...new Set([...state.changedFiles, ...files])]), coordinator: updateCoordinator(state, event) });
  }
  return Object.freeze({ ...base, coordinator: updateCoordinator(state, event) });
}

export function reduceResearchRunEvents(sessionId: string, events: readonly DevPilotEvent[]): ResearchRunState {
  return events.reduce(reduceResearchRun, createInitialResearchRunState(sessionId));
}
