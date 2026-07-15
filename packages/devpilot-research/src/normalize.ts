import { DEVPILOT_EVENT_TYPES, type DevPilotEvent, type DevPilotEventType } from './types.ts';

const TYPE_ALIASES: Readonly<Record<string, DevPilotEventType>> = Object.freeze({
  SESSION_START: 'session.started',
  'session.start': 'session.started',
  SESSION_END: 'session.ended',
  'session.end': 'session.ended',
  'cycle.start': 'cycle.started',
  'cycle.started': 'cycle.started',
  'cycle.end': 'cycle.completed',
  'cycle.completed': 'cycle.completed',
  'cycle.phase': 'coordinator.progress',
  'hypothesis.created': 'hypothesis.created',
  'idea.proposed': 'hypothesis.created',
  'hypothesis.updated': 'hypothesis.updated',
  'idea.completed': 'hypothesis.updated',
  'idea.pruned': 'hypothesis.updated',
  'idea.merged': 'hypothesis.updated',
  'tree.updated': 'hypothesis.updated',
  'executor.start': 'executor.started',
  'executor.started': 'executor.started',
  'executor.progress': 'executor.progress',
  'executor.end': 'executor.completed',
  'executor.completed': 'executor.completed',
  'executor.failed': 'executor.failed',
  'tool.start': 'tool.called',
  'tool.called': 'tool.called',
  'tool.end': 'tool.completed',
  'tool.completed': 'tool.completed',
  'tool.failed': 'tool.failed',
  'evidence.created': 'evidence.created',
  'report.generated': 'report.generated',
  'permission.requested': 'permission.requested',
  'permission.resolved': 'permission.resolved',
  'run.cancelled': 'run.cancelled',
  'run.failed': 'run.failed',
  'user.await': 'user.await',
  AWAIT_USER: 'user.await',
  'user.input_received': 'user.input',
  USER_INPUT_RECEIVED: 'user.input',
  'llm.call': 'usage.updated',
  'session.checkpoint': 'artifact.created',
  'memory.created': 'memory.created',
  'audit.completed': 'audit.completed',
  'file.changed': 'file.changed',
});

const EVENT_TYPE_SET = new Set<string>(DEVPILOT_EVENT_TYPES);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function normalizeDevPilotEvent(input: unknown): DevPilotEvent | null {
  const source = record(input);
  if (!source) return null;
  const nested = record(source.devpilot) ?? source;
  const data = record(nested.data) ?? record(source.data) ?? {};
  const originalType = stringValue(nested.type, source.type);
  if (!originalType) return null;
  const type = TYPE_ALIASES[originalType] ?? (EVENT_TYPE_SET.has(originalType) ? originalType as DevPilotEventType : null);
  if (!type) return null;

  return Object.freeze({
    type,
    originalType,
    timestamp: stringValue(nested.timestamp, nested.ts, source.timestamp, source.ts),
    runId: stringValue(nested.run_id, nested.runId, data.run_id, data.runId),
    sessionId: stringValue(nested.session_id, nested.sessionId, data.session_id, data.sessionId),
    cycleId: stringValue(nested.cycle_id, nested.cycleId, data.cycle_id, data.cycleId, data.cycle_num),
    hypothesisId: stringValue(nested.hypothesis_id, nested.hypothesisId, data.hypothesis_id, data.hypothesisId, data.node_id),
    executorId: stringValue(nested.executor_id, nested.executorId, data.executor_id, data.executorId),
    toolName: stringValue(nested.tool_name, nested.toolName, data.tool_name, data.toolName, data.name),
    status: stringValue(nested.status, data.status),
    summary: stringValue(nested.summary, data.summary, data.message),
    data: Object.freeze({ ...data }),
  });
}

export function normalizeDevPilotEvents(inputs: readonly unknown[]): readonly DevPilotEvent[] {
  return Object.freeze(inputs.flatMap((input) => {
    const event = normalizeDevPilotEvent(input);
    return event ? [event] : [];
  }));
}
