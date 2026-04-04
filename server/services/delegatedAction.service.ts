import crypto from "node:crypto";
import {
  createPendingDelegatedAction,
  getDelegatedActionPolicy,
} from "../../src/lib/secure-actions/catalog";
import {
  DelegatedActionExecution,
  DelegatedActionExecutionStatus,
  DelegatedActionMetadata,
  DelegatedActionPreviewInput,
  PendingDelegatedAction,
  PendingDelegatedActionUpdate,
  SecureActionExecutionResult,
} from "../../src/types";
import {
  deletePendingAction,
  getExecutionsForSession,
  getPendingActionsForSession,
  storePendingAction,
  upsertExecution,
} from "../runtime.store";
import { githubActionService } from "./githubAction.service";
import { gitlabActionService } from "./gitlabAction.service";
import { slackActionService } from "./slackAction.service";
import { RuntimeEnv, RuntimeSessionRecord } from "../runtime.types";

export function createPendingActionForSession(options: {
  sessionId: string;
  input: DelegatedActionPreviewInput;
}): PendingDelegatedAction {
  const policy = getDelegatedActionPolicy(options.input.provider, options.input.actionKey);
  if (!policy) {
    throw new Error(
      `Unknown delegated action policy for ${options.input.provider}:${options.input.actionKey}.`,
    );
  }

  const action = createPendingDelegatedAction(options.input, policy);
  return storePendingAction(options.sessionId, action);
}

export function updatePendingActionForSession(options: {
  sessionId: string;
  pendingAction: PendingDelegatedAction;
  updates: PendingDelegatedActionUpdate;
}): PendingDelegatedAction {
  const nextAction: PendingDelegatedAction = {
    ...options.pendingAction,
    ...options.updates,
    updatedAt: Date.now(),
  };

  return storePendingAction(options.sessionId, nextAction);
}

export async function executePendingActionForSession(options: {
  env: RuntimeEnv;
  session: RuntimeSessionRecord;
  pendingAction: PendingDelegatedAction;
}): Promise<SecureActionExecutionResult> {
  const { env, session, pendingAction } = options;
  const now = Date.now();
  const blockedExecution = buildInitialExecution(pendingAction, {
    mode: deriveExecutionMode(env, pendingAction.provider),
    status: "blocked",
    summary: pendingAction.summary,
    metadata: pendingAction.metadata ?? "{}",
    createdAt: now,
  });

  if (env.liveAuthMode && session.runtimeMode === "live" && session.status !== "authenticated") {
    return finalizeBlockedExecution(
      session.id,
      blockedExecution,
      "Authentication is required before DevPilot can act on your behalf.",
      ["[SECURE_ACTION] Blocked because the user is not authenticated."],
      pendingAction,
    );
  }

  if (pendingAction.approvalStatus === "pending") {
    return finalizeBlockedExecution(
      session.id,
      blockedExecution,
      "This action is still waiting for explicit approval.",
      ["[SECURE_ACTION] Blocked because approval is still pending."],
      pendingAction,
    );
  }

  if (pendingAction.approvalStatus === "rejected") {
    return finalizeBlockedExecution(
      session.id,
      blockedExecution,
      "This action was rejected and cannot be executed.",
      ["[SECURE_ACTION] Blocked because approval was rejected."],
      pendingAction,
    );
  }

  if (pendingAction.stepUpStatus === "required") {
    return finalizeBlockedExecution(
      session.id,
      blockedExecution,
      "Step-up authentication is required before this high-risk action can run.",
      ["[SECURE_ACTION] Blocked because step-up authentication is required."],
      pendingAction,
    );
  }

  const runningExecution = upsertExecution(session.id, {
    ...blockedExecution,
    status: "running",
    logs: ["[SECURE_ACTION] Validated approval and dispatching provider action."],
    updatedAt: now,
  });

  try {
    const outcome = await dispatchProviderAction({
      env,
      session,
      pendingAction,
    });

    const completedExecution: DelegatedActionExecution = {
      ...runningExecution,
      mode: outcome.mode,
      status: outcome.status,
      summary: outcome.summary,
      logs: outcome.logs,
      externalRef: outcome.externalRef,
      externalUrl: outcome.externalUrl,
      metadata: JSON.stringify(outcome.metadata ?? {}),
      updatedAt: Date.now(),
      completedAt:
        outcome.status === "completed" || outcome.status === "failed" || outcome.status === "blocked"
          ? Date.now()
          : undefined,
    };

    upsertExecution(session.id, completedExecution);
    if (outcome.status === "completed") {
      deletePendingAction(session.id, pendingAction.id);
    }

    return {
      ok: outcome.status === "completed",
      pendingAction:
        outcome.status === "completed" ? undefined : pendingAction,
      execution: completedExecution,
      executionMode:
        outcome.status === "blocked"
          ? "blocked"
          : outcome.mode === "fallback"
            ? "dry_run"
            : "deferred",
      message: outcome.summary,
    };
  } catch (error) {
    const failedExecution: DelegatedActionExecution = {
      ...runningExecution,
      status: "failed",
      summary:
        error instanceof Error
          ? error.message
          : "Delegated action failed unexpectedly.",
      logs: [
        ...runningExecution.logs,
        error instanceof Error ? error.message : String(error),
      ],
      updatedAt: Date.now(),
      completedAt: Date.now(),
    };

    upsertExecution(session.id, failedExecution);
    return {
      ok: false,
      pendingAction,
      execution: failedExecution,
      executionMode: "blocked",
      message: failedExecution.summary,
    };
  }
}

export function getRuntimeActionState(sessionId: string): {
  pendingActions: PendingDelegatedAction[];
  executions: DelegatedActionExecution[];
} {
  return {
    pendingActions: getPendingActionsForSession(sessionId),
    executions: getExecutionsForSession(sessionId),
  };
}

function buildInitialExecution(
  pendingAction: PendingDelegatedAction,
  args: {
    mode: DelegatedActionExecution["mode"];
    status: DelegatedActionExecutionStatus;
    summary: string;
    metadata: string;
    createdAt: number;
  },
): DelegatedActionExecution {
  return {
    id: `execution:${crypto.randomUUID()}`,
    taskId: pendingAction.taskId,
    provider: pendingAction.provider as DelegatedActionExecution["provider"],
    actionKey: pendingAction.actionKey,
    riskLevel: pendingAction.riskLevel,
    mode: args.mode,
    status: args.status,
    approvalStatus: pendingAction.approvalStatus,
    stepUpStatus: pendingAction.stepUpStatus,
    summary: args.summary,
    logs: [],
    metadata: args.metadata,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  };
}

function finalizeBlockedExecution(
  sessionId: string,
  execution: DelegatedActionExecution,
  summary: string,
  logs: string[],
  pendingAction: PendingDelegatedAction,
): SecureActionExecutionResult {
  const nextExecution: DelegatedActionExecution = {
    ...execution,
    summary,
    logs,
    updatedAt: Date.now(),
    completedAt: Date.now(),
  };

  upsertExecution(sessionId, nextExecution);
  return {
    ok: false,
    pendingAction,
    execution: nextExecution,
    executionMode: "blocked",
    message: summary,
  };
}

async function dispatchProviderAction(options: {
  env: RuntimeEnv;
  session: RuntimeSessionRecord;
  pendingAction: PendingDelegatedAction;
}) {
  const metadata = parseMetadata(options.pendingAction.metadata);
  const context = {
    env: options.env,
    session: options.session,
    metadata,
  };

  switch (options.pendingAction.provider) {
    case "github":
      return githubActionService.executeAction(options.pendingAction.actionKey, context);
    case "gitlab":
      return gitlabActionService.executeAction(options.pendingAction.actionKey, context);
    case "slack":
      return slackActionService.executeAction(options.pendingAction.actionKey, context);
    default:
      throw new Error(`Unsupported delegated action provider '${options.pendingAction.provider}'.`);
  }
}

function parseMetadata(metadata: string | undefined): DelegatedActionMetadata {
  if (!metadata) {
    return {};
  }

  try {
    return JSON.parse(metadata) as DelegatedActionMetadata;
  } catch {
    return {};
  }
}

function deriveExecutionMode(
  env: RuntimeEnv,
  provider: PendingDelegatedAction["provider"],
): DelegatedActionExecution["mode"] {
  if (!env.liveDelegatedActionMode) {
    return "fallback";
  }

  if (provider === "github" && env.liveGitHubActionMode) {
    return "live";
  }

  if (provider === "slack" && env.liveSlackActionMode) {
    return "live";
  }

  return "fallback";
}
