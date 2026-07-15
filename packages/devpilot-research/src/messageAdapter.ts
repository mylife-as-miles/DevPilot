import { normalizeDevPilotEvent } from './normalize.ts';
import type { DevPilotEvent } from './types.ts';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function devPilotMeta(value: unknown): unknown {
  const source = record(value);
  if (!source) return null;
  const direct = record(source.devpilot);
  if (direct) return direct;
  const meta = record(source.meta);
  const nested = record(meta?.devpilot);
  if (nested) return nested;
  const acp = record(source._acp);
  const acpMeta = record(acp?.meta);
  return record(acpMeta?.devpilot);
}

function todoEvents(value: unknown, timestamp: string | null): DevPilotEvent[] {
  const source = record(value);
  if (!source || !Array.isArray(source.todos)) return [];
  return source.todos.flatMap((item) => {
    const todo = record(item);
    const content = typeof todo?.content === 'string' ? todo.content.trim() : '';
    const match = /^\[([^\]]+)]\s*(.+)$/.exec(content);
    if (!match) return [];
    const status = typeof todo?.status === 'string' ? todo.status : 'pending';
    const event = normalizeDevPilotEvent({
      type: 'hypothesis.updated',
      timestamp,
      hypothesis_id: match[1],
      status: status === 'in_progress' ? 'running' : status === 'completed' ? 'done' : status,
      data: { hypothesis: match[2], status },
    });
    return event ? [event] : [];
  });
}

function timestampFromMessage(message: UnknownRecord): string | null {
  const createdAt = message.createdAt;
  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) return new Date(createdAt).toISOString();
  if (typeof createdAt === 'string' && createdAt.trim()) return createdAt;
  return null;
}

/**
 * Extracts provider-owned DevPilot events from normalized Happier transcript messages.
 * ACP metadata is authoritative; TodoWrite parsing only supports older stored sessions.
 */
export function extractDevPilotEventsFromMessages(messages: readonly unknown[]): readonly DevPilotEvent[] {
  const events: DevPilotEvent[] = [];
  const seen = new Set<string>();

  const add = (candidate: unknown) => {
    const event = normalizeDevPilotEvent(candidate);
    if (!event) return;
    const key = JSON.stringify([
      event.originalType,
      event.timestamp,
      event.runId,
      event.cycleId,
      event.hypothesisId,
      event.executorId,
      event.data,
    ]);
    if (seen.has(key)) return;
    seen.add(key);
    events.push(event);
  };

  const visit = (value: unknown, inheritedTimestamp: string | null = null) => {
    const source = record(value);
    if (!source) return;
    const timestamp = timestampFromMessage(source) ?? inheritedTimestamp;
    add(devPilotMeta(source));

    const tool = record(source.tool);
    if (tool) {
      add(devPilotMeta(tool.input));
      add(devPilotMeta(tool.result));
      for (const event of todoEvents(tool.input, timestamp)) add(event);
      for (const event of todoEvents(tool.result, timestamp)) add(event);
    }

    if (Array.isArray(source.children)) {
      for (const child of source.children) visit(child, timestamp);
    }
  };

  for (const message of messages) visit(message);
  return Object.freeze(events);
}
