import {
  DelegatedActionExecution,
  PendingDelegatedAction,
} from "../src/types";
import {
  LoginStateRecord,
  RuntimeExecutionRecord,
  RuntimePendingActionRecord,
  RuntimeSessionRecord,
} from "./runtime.types";

const sessionStore = new Map<string, RuntimeSessionRecord>();
const pendingActionStore = new Map<string, RuntimePendingActionRecord>();
const executionStore = new Map<string, RuntimeExecutionRecord>();
const loginStateStore = new Map<string, LoginStateRecord>();

export function getSession(sessionId: string): RuntimeSessionRecord | undefined {
  return sessionStore.get(sessionId);
}

export function setSession(session: RuntimeSessionRecord): RuntimeSessionRecord {
  sessionStore.set(session.id, session);
  return session;
}

export function deleteSession(sessionId: string): void {
  sessionStore.delete(sessionId);
  prunePendingActionsForSession(sessionId);
}

export function setLoginState(
  state: string,
  loginState: LoginStateRecord,
): void {
  loginStateStore.set(state, loginState);
}

export function takeLoginState(state: string): LoginStateRecord | undefined {
  const loginState = loginStateStore.get(state);
  if (loginState) {
    loginStateStore.delete(state);
  }
  return loginState;
}

export function storePendingAction(
  sessionId: string,
  action: PendingDelegatedAction,
): PendingDelegatedAction {
  pendingActionStore.set(action.id, { sessionId, action });
  return action;
}

export function getPendingActionForSession(
  sessionId: string,
  pendingActionId: string,
): PendingDelegatedAction | undefined {
  const record = pendingActionStore.get(pendingActionId);
  if (!record || record.sessionId !== sessionId) {
    return undefined;
  }

  return record.action;
}

export function getPendingActionsForSession(
  sessionId: string,
): PendingDelegatedAction[] {
  return Array.from(pendingActionStore.values())
    .filter((record) => record.sessionId === sessionId)
    .map((record) => record.action)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function deletePendingAction(
  sessionId: string,
  pendingActionId: string,
): void {
  const record = pendingActionStore.get(pendingActionId);
  if (record && record.sessionId === sessionId) {
    pendingActionStore.delete(pendingActionId);
  }
}

export function prunePendingActionsForSession(sessionId: string): void {
  for (const [pendingId, record] of pendingActionStore.entries()) {
    if (record.sessionId === sessionId) {
      pendingActionStore.delete(pendingId);
    }
  }
}

export function upsertExecution(
  sessionId: string,
  execution: DelegatedActionExecution,
): DelegatedActionExecution {
  executionStore.set(execution.id, { sessionId, execution });
  return execution;
}

export function getExecutionsForSession(
  sessionId: string,
): DelegatedActionExecution[] {
  return Array.from(executionStore.values())
    .filter((record) => record.sessionId === sessionId)
    .map((record) => record.execution)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 30);
}
