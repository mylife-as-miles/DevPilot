import crypto from "node:crypto";
import { AuthorizationAuditEvent } from "../../src/types";
import {
  getAuthorizationAuditEventsForSession,
  storeAuthorizationAuditEvent,
} from "../runtime.store";

export function recordAuthorizationAuditEvent(options: {
  sessionId: string;
  eventType: AuthorizationAuditEvent["eventType"];
  provider: AuthorizationAuditEvent["provider"];
  riskLevel: AuthorizationAuditEvent["riskLevel"];
  summary: string;
  reason?: string;
  scopes?: string[];
  outcome: AuthorizationAuditEvent["outcome"];
  taskId?: string;
  delegatedActionExecutionId?: string;
  approvalRequestId?: string;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
  dedupeWindowMs?: number;
  createdAt?: number;
}): AuthorizationAuditEvent {
  const createdAt = options.createdAt ?? Date.now();
  const dedupeWindowMs = options.dedupeWindowMs ?? 60_000;

  if (options.dedupeKey) {
    const existing = getAuthorizationAuditEventsForSession(options.sessionId).find(
      (event) => {
        const metadata = parseMetadata(event.metadata);
        return (
          metadata.dedupeKey === options.dedupeKey &&
          createdAt - event.createdAt <= dedupeWindowMs
        );
      },
    );

    if (existing) {
      return existing;
    }
  }

  return storeAuthorizationAuditEvent(options.sessionId, {
    id: `auth-audit:${crypto.randomUUID()}`,
    taskId: options.taskId,
    delegatedActionExecutionId: options.delegatedActionExecutionId,
    approvalRequestId: options.approvalRequestId,
    provider: options.provider,
    eventType: options.eventType,
    riskLevel: options.riskLevel,
    summary: options.summary,
    reason: options.reason,
    scopes: options.scopes ?? [],
    outcome: options.outcome,
    metadata: JSON.stringify({
      ...(options.metadata ?? {}),
      dedupeKey: options.dedupeKey,
    }),
    createdAt,
  });
}

export function getAuthorizationAuditTrailForSession(
  sessionId: string,
): AuthorizationAuditEvent[] {
  return getAuthorizationAuditEventsForSession(sessionId);
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
