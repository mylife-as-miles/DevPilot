import crypto from "node:crypto";
import {
  createPendingDelegatedAction,
  getDelegatedActionPolicy,
} from "../../src/lib/secure-actions/catalog";
import {
  ApprovalRequest,
  DelegatedActionExecution,
  DelegatedActionExecutionStatus,
  DelegatedActionMetadata,
  DelegatedActionPolicy,
  DelegatedActionPreviewInput,
  PendingDelegatedAction,
  PendingDelegatedActionUpdate,
  SecureActionExecutionResult,
  StepUpRequirement,
} from "../../src/types";
import {
  deletePendingAction,
  getApprovalRequestForSession,
  getApprovalRequestsForSession,
  getExecutionForSession,
  getExecutionsForSession,
  getPendingActionForSession,
  getPendingActionsForSession,
  getStepUpRequirementForSession,
  getStepUpRequirementsForSession,
  storePendingAction,
  upsertExecution,
} from "../runtime.store";
import { RuntimeEnv, RuntimeSessionRecord } from "../runtime.types";
import { githubActionService } from "./githubAction.service";
import { gitlabActionService } from "./gitlabAction.service";
import { slackActionService } from "./slackAction.service";
import {
  approveApprovalRequestForSession,
  createApprovalRequestForPendingAction,
  expireApprovalRequestsForSession,
} from "./approval.service";
import {
  completeStepUpRequirementForSession,
  createStepUpRequirementForPendingAction,
} from "./stepUpAuth.service";
import { recordAuthorizationAuditEvent } from "./authorizationAudit.service";

export function createPendingActionForSession(options: {
  env: RuntimeEnv;
  sessionId: string;
  input: DelegatedActionPreviewInput;
}): PendingDelegatedAction {
  const basePolicy = getDelegatedActionPolicy(
    options.input.provider,
    options.input.actionKey,
  );
  if (!basePolicy) {
    throw new Error(
      `Unknown delegated action policy for ${options.input.provider}:${options.input.actionKey}.`,
    );
  }
  const policy = resolvePolicyForInput(basePolicy, options.input);

  const now = Date.now();
  let action = createPendingDelegatedAction(options.input, policy, now);
  const executionId = `execution:${crypto.randomUUID()}`;
  action = {
    ...action,
    delegatedActionExecutionId: executionId,
  };

  let approvalRequest: ApprovalRequest | undefined;
  let stepUpRequirement: StepUpRequirement | undefined;

  if (policy.requiresApproval) {
    approvalRequest = createApprovalRequestForPendingAction({
      env: options.env,
      sessionId: options.sessionId,
      pendingAction: action,
      policy,
      delegatedActionExecutionId: executionId,
      now,
    });
    action.approvalRequestId = approvalRequest.id;
  }

  if (policy.requiresStepUp) {
    stepUpRequirement = createStepUpRequirementForPendingAction({
      sessionId: options.sessionId,
      pendingAction: action,
      policy,
      delegatedActionExecutionId: executionId,
      now,
    });
    action.stepUpRequirementId = stepUpRequirement.id;
  }

  const execution = buildInitialExecution(action, {
    mode: deriveExecutionMode(options.env, action.provider),
    status: mapPendingStatusToExecutionStatus(action.status),
    summary: summarizePendingAction(action),
    metadata: action.metadata ?? "{}",
    createdAt: now,
    approvalRequestId: approvalRequest?.id,
    stepUpRequirementId: stepUpRequirement?.id,
  });

  storePendingAction(options.sessionId, action);
  upsertExecution(options.sessionId, execution);

  recordAuthorizationAuditEvent({
    sessionId: options.sessionId,
    taskId: action.taskId,
    delegatedActionExecutionId: execution.id,
    approvalRequestId: approvalRequest?.id,
    provider: action.provider,
    eventType: "scope_evaluated",
    riskLevel: action.riskLevel,
    summary: `Evaluated access boundary for ${action.title}.`,
    reason: `Required scopes: ${action.requiredScopes.join(", ") || "none"}.`,
    scopes: action.requiredScopes,
    outcome: "info",
    metadata: {
      actionKey: action.actionKey,
      title: action.title,
    },
  });

  recordAuthorizationAuditEvent({
    sessionId: options.sessionId,
    taskId: action.taskId,
    delegatedActionExecutionId: execution.id,
    approvalRequestId: approvalRequest?.id,
    provider: action.provider,
    eventType: "policy_matched",
    riskLevel: action.riskLevel,
    summary: `Matched authorization policy for ${action.title}.`,
    reason: buildPolicyReason({
      pendingAction: action,
      policy,
    }),
    scopes: action.requiredScopes,
    outcome:
      policy.safeToAutoExecute && !policy.requiresApproval && !policy.requiresStepUp
        ? "allowed"
        : "info",
    metadata: {
      actionKey: action.actionKey,
      approvalRequired: policy.requiresApproval,
      stepUpRequired: policy.requiresStepUp,
      approvalTrigger: policy.approvalTrigger,
      stepUpTrigger: policy.stepUpTrigger,
      safeToAutoExecute: policy.safeToAutoExecute,
    },
  });

  return action;
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
  expireApprovalRequestsForSession(options.session.id);

  const pendingAction =
    getPendingActionForSession(options.session.id, options.pendingAction.id)
    ?? options.pendingAction;
  const approvalRequest = pendingAction.approvalRequestId
    ? getApprovalRequestForSession(options.session.id, pendingAction.approvalRequestId)
    : undefined;
  const stepUpRequirement = pendingAction.stepUpRequirementId
    ? getStepUpRequirementForSession(
        options.session.id,
        pendingAction.stepUpRequirementId,
      )
    : undefined;
  const existingExecution = pendingAction.delegatedActionExecutionId
    ? getExecutionForSession(
        options.session.id,
        pendingAction.delegatedActionExecutionId,
      )
    : undefined;

  let execution =
    existingExecution
    ?? buildInitialExecution(pendingAction, {
      mode: deriveExecutionMode(options.env, pendingAction.provider),
      status: mapPendingStatusToExecutionStatus(pendingAction.status),
      summary: summarizePendingAction(pendingAction),
      metadata: pendingAction.metadata ?? "{}",
      createdAt: Date.now(),
      approvalRequestId: approvalRequest?.id,
      stepUpRequirementId: stepUpRequirement?.id,
    });

  if (
    options.env.liveAuthMode
    && options.session.runtimeMode === "live"
    && options.session.status !== "authenticated"
  ) {
    return finalizeBlockedExecution(options.session.id, {
      execution,
      pendingAction,
      approvalRequest,
      stepUpRequirement,
      status: "blocked",
      summary: "Authentication is required before DevPilot can act on your behalf.",
      log: "[SECURE_ACTION] Blocked because the user is not authenticated.",
      reason:
        "The secure runtime needs an authenticated Auth0 session before it can exchange delegated provider access server-side.",
      });
  }

  if (
    pendingAction.approvalStatus === "pending"
    || pendingAction.status === "awaiting_approval"
  ) {
    return finalizeBlockedExecution(options.session.id, {
      execution,
      pendingAction,
      approvalRequest,
      stepUpRequirement,
      status: "awaiting_approval",
      summary: "This action is waiting for explicit approval.",
      log: "[SECURE_ACTION] Execution paused while waiting for approval.",
      reason: "Human approval must be granted before this delegated action can continue.",
    });
  }

  if (pendingAction.approvalStatus === "rejected" || pendingAction.status === "rejected") {
    return finalizeBlockedExecution(options.session.id, {
      execution,
      pendingAction,
      approvalRequest,
      stepUpRequirement,
      status: "rejected",
      summary: "This action was rejected and cannot be executed.",
      log: "[SECURE_ACTION] Blocked because approval was rejected.",
      completedAt: Date.now(),
      reason: "The approval request for this delegated action was rejected.",
    });
  }

  if (pendingAction.approvalStatus === "expired" || pendingAction.status === "expired") {
    return finalizeBlockedExecution(options.session.id, {
      execution,
      pendingAction,
      approvalRequest,
      stepUpRequirement,
      status: "expired",
      summary: "This action can no longer run because its approval request expired.",
      log: "[SECURE_ACTION] Blocked because approval expired.",
      completedAt: Date.now(),
      reason: "The approval window expired before a decision was made.",
    });
  }

  if (pendingAction.approvalStatus === "cancelled" || pendingAction.status === "cancelled") {
    return finalizeBlockedExecution(options.session.id, {
      execution,
      pendingAction,
      approvalRequest,
      stepUpRequirement,
      status: "cancelled",
      summary: "This action was cancelled and will not run.",
      log: "[SECURE_ACTION] Blocked because the approval request was cancelled.",
      completedAt: Date.now(),
      reason: "The delegated action was cancelled before execution.",
    });
  }

  if (
    pendingAction.stepUpStatus === "required"
    || pendingAction.stepUpStatus === "in_progress"
    || pendingAction.status === "awaiting_step_up"
  ) {
    return finalizeBlockedExecution(options.session.id, {
      execution,
      pendingAction,
      approvalRequest,
      stepUpRequirement,
      status: "awaiting_step_up",
      summary: "Step-up authentication is required before this action can run.",
      log: "[SECURE_ACTION] Execution paused while waiting for step-up authentication.",
      reason: "A stronger authentication checkpoint must complete before this high-risk action can continue.",
    });
  }

  if (pendingAction.stepUpStatus === "failed") {
    return finalizeBlockedExecution(options.session.id, {
      execution,
      pendingAction,
      approvalRequest,
      stepUpRequirement,
      status: "blocked",
      summary: "Step-up authentication failed, so the action cannot proceed.",
      log: "[SECURE_ACTION] Blocked because step-up authentication failed.",
      completedAt: Date.now(),
      reason: "The stronger authentication checkpoint failed, so the action remained blocked.",
    });
  }

  const executingPendingAction = storePendingAction(options.session.id, {
    ...pendingAction,
    status: "executing",
    updatedAt: Date.now(),
  });
  execution = upsertExecution(options.session.id, {
    ...execution,
    status: "running",
    summary: `Executing ${pendingAction.title} through the secure backend boundary.`,
    logs: [
      ...execution.logs,
      "[SECURE_ACTION] Governance checks passed. Dispatching provider action.",
    ],
    updatedAt: Date.now(),
  });

  recordAuthorizationAuditEvent({
    sessionId: options.session.id,
    taskId: executingPendingAction.taskId,
    delegatedActionExecutionId: execution.id,
    approvalRequestId: approvalRequest?.id,
    provider: executingPendingAction.provider,
    eventType: "action_started",
    riskLevel: executingPendingAction.riskLevel,
    summary: `Started secure execution for ${executingPendingAction.title}.`,
    reason: "All required authorization checkpoints passed, so the backend started the delegated provider call.",
    scopes: executingPendingAction.requiredScopes,
    outcome: "allowed",
    metadata: {
      actionKey: executingPendingAction.actionKey,
      provider: executingPendingAction.provider,
      executionMode: execution.mode,
    },
  });

  try {
    const requestMetadata = parseMetadata(executingPendingAction.metadata);
    const outcome = await dispatchProviderAction({
      env: options.env,
      session: options.session,
      pendingAction: executingPendingAction,
    });

    const completedExecution: DelegatedActionExecution = {
      ...execution,
      mode: outcome.mode,
      status: outcome.status,
      summary: outcome.summary,
      logs: [...execution.logs, ...outcome.logs],
      externalRef: outcome.externalRef,
      externalUrl: outcome.externalUrl,
      metadata: JSON.stringify({
        request: requestMetadata,
        response: outcome.metadata ?? {},
      }),
      updatedAt: Date.now(),
      completedAt:
        outcome.status === "completed"
        || outcome.status === "failed"
        || outcome.status === "blocked"
          ? Date.now()
          : undefined,
    };

    upsertExecution(options.session.id, completedExecution);
    recordExecutionOutcomeAudit({
      sessionId: options.session.id,
      pendingAction: executingPendingAction,
      execution: completedExecution,
      approvalRequest,
      outcome,
    });

    if (outcome.status === "completed") {
      deletePendingAction(options.session.id, executingPendingAction.id);
      return {
        ok: true,
        execution: completedExecution,
        approvalRequest,
        stepUpRequirement,
        executionMode: outcome.mode === "fallback" ? "dry_run" : "deferred",
        message: outcome.summary,
      };
    }

    const retainedPendingAction = storePendingAction(options.session.id, {
      ...executingPendingAction,
      status: "blocked",
      updatedAt: Date.now(),
    });

    return {
      ok: false,
      pendingAction: retainedPendingAction,
      execution: completedExecution,
      approvalRequest,
      stepUpRequirement,
      executionMode: outcome.status === "blocked" ? "blocked" : "deferred",
      message: outcome.summary,
    };
  } catch (error) {
    const failedExecution: DelegatedActionExecution = {
      ...execution,
      status: "failed",
      summary:
        error instanceof Error
          ? error.message
          : "Delegated action failed unexpectedly.",
      logs: [
        ...execution.logs,
        error instanceof Error ? error.message : String(error),
      ],
      updatedAt: Date.now(),
      completedAt: Date.now(),
    };

    const blockedPendingAction = storePendingAction(options.session.id, {
      ...executingPendingAction,
      status: "blocked",
      updatedAt: Date.now(),
    });

    upsertExecution(options.session.id, failedExecution);
    recordAuthorizationAuditEvent({
      sessionId: options.session.id,
      taskId: blockedPendingAction.taskId,
      delegatedActionExecutionId: failedExecution.id,
      approvalRequestId: approvalRequest?.id,
      provider: blockedPendingAction.provider,
      eventType: "action_failed",
      riskLevel: blockedPendingAction.riskLevel,
      summary: `Delegated action failed for ${blockedPendingAction.title}.`,
      reason:
        error instanceof Error
          ? error.message
          : "The delegated action failed unexpectedly.",
      scopes: blockedPendingAction.requiredScopes,
      outcome: "failed",
      metadata: {
        actionKey: blockedPendingAction.actionKey,
        mode: failedExecution.mode,
      },
    });
    return {
      ok: false,
      pendingAction: blockedPendingAction,
      execution: failedExecution,
      approvalRequest,
      stepUpRequirement,
      executionMode: "blocked",
      message: failedExecution.summary,
    };
  }
}

export function getRuntimeActionState(sessionId: string): {
  pendingActions: PendingDelegatedAction[];
  executions: DelegatedActionExecution[];
  approvalRequests: ApprovalRequest[];
  stepUpRequirements: StepUpRequirement[];
} {
  expireApprovalRequestsForSession(sessionId);
  return {
    pendingActions: getPendingActionsForSession(sessionId),
    executions: getExecutionsForSession(sessionId),
    approvalRequests: getApprovalRequestsForSession(sessionId),
    stepUpRequirements: getStepUpRequirementsForSession(sessionId),
  };
}

export function approvePendingActionForSession(options: {
  sessionId: string;
  approvalRequestId: string;
}) {
  return approveApprovalRequestForSession(options);
}

export function completePendingActionStepUpForSession(options: {
  sessionId: string;
  stepUpRequirementId: string;
}) {
  return completeStepUpRequirementForSession(options);
}

function buildInitialExecution(
  pendingAction: PendingDelegatedAction,
  args: {
    mode: DelegatedActionExecution["mode"];
    status: DelegatedActionExecutionStatus;
    summary: string;
    metadata: string;
    createdAt: number;
    approvalRequestId?: string;
    stepUpRequirementId?: string;
  },
): DelegatedActionExecution {
  return {
    id: pendingAction.delegatedActionExecutionId ?? `execution:${crypto.randomUUID()}`,
    taskId: pendingAction.taskId,
    provider: pendingAction.provider as DelegatedActionExecution["provider"],
    actionKey: pendingAction.actionKey,
    riskLevel: pendingAction.riskLevel,
    mode: args.mode,
    status: args.status,
    approvalStatus: pendingAction.approvalStatus,
    stepUpStatus: pendingAction.stepUpStatus,
    approvalRequestId: args.approvalRequestId,
    stepUpRequirementId: args.stepUpRequirementId,
    summary: args.summary,
    logs: [
      `[SECURE_ACTION] Proposed ${pendingAction.actionKey} with scopes: ${pendingAction.requiredScopes.join(", ") || "none"}.`,
    ],
    metadata: args.metadata,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  };
}

function finalizeBlockedExecution(
  sessionId: string,
  options: {
    execution: DelegatedActionExecution;
    pendingAction: PendingDelegatedAction;
    approvalRequest?: ApprovalRequest;
    stepUpRequirement?: StepUpRequirement;
    status: DelegatedActionExecution["status"];
    summary: string;
    log: string;
    completedAt?: number;
    reason?: string;
  },
): SecureActionExecutionResult {
  const nextExecution: DelegatedActionExecution = {
    ...options.execution,
    status: options.status,
    summary: options.summary,
    logs: [...options.execution.logs, options.log],
    updatedAt: Date.now(),
    completedAt: options.completedAt,
  };

  upsertExecution(sessionId, nextExecution);
  recordAuthorizationAuditEvent({
    sessionId,
    taskId: options.pendingAction.taskId,
    delegatedActionExecutionId: nextExecution.id,
    approvalRequestId: options.approvalRequest?.id,
    provider: options.pendingAction.provider,
    eventType: "action_blocked",
    riskLevel: options.pendingAction.riskLevel,
    summary: options.summary,
    reason: options.reason ?? options.summary,
    scopes: options.pendingAction.requiredScopes,
    outcome:
      options.status === "rejected"
        ? "rejected"
        : "blocked",
    metadata: {
      status: options.status,
      approvalStatus: options.pendingAction.approvalStatus,
      stepUpStatus: options.pendingAction.stepUpStatus,
    },
    dedupeKey: `blocked:${nextExecution.id}:${options.status}`,
  });
  return {
    ok: false,
    pendingAction: options.pendingAction,
    execution: nextExecution,
    approvalRequest: options.approvalRequest,
    stepUpRequirement: options.stepUpRequirement,
    executionMode: "blocked",
    message: options.summary,
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
      throw new Error(
        `Unsupported delegated action provider '${options.pendingAction.provider}'.`,
      );
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

function mapPendingStatusToExecutionStatus(
  status: PendingDelegatedAction["status"],
): DelegatedActionExecution["status"] {
  switch (status) {
    case "awaiting_approval":
      return "awaiting_approval";
    case "awaiting_step_up":
      return "awaiting_step_up";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    case "blocked":
      return "blocked";
    default:
      return "proposed";
  }
}

function summarizePendingAction(action: PendingDelegatedAction): string {
  if (action.status === "awaiting_approval") {
    return `Awaiting approval for ${action.title}.`;
  }

  if (action.status === "awaiting_step_up") {
    return `Awaiting step-up authentication for ${action.title}.`;
  }

  if (action.status === "approved") {
    return `${action.title} is approved and ready to execute.`;
  }

  return `Prepared delegated action: ${action.title}.`;
}

function resolvePolicyForInput(
  policy: DelegatedActionPolicy,
  input: DelegatedActionPreviewInput,
): DelegatedActionPolicy {
  if (
    input.provider === "slack" &&
    (input.actionKey === "slack.post_status_message"
      || input.actionKey === "slack.post_verification_summary") &&
    input.metadata?.notificationClass === "narrow_status"
  ) {
    return {
      ...policy,
      riskLevel: "low",
      requiresApproval: false,
      requiresStepUp: false,
      approvalTrigger: "never",
      stepUpTrigger: "never",
      canRunInBackgroundBeforeApproval: true,
      safeToAutoExecute: true,
      approvalReason:
        "Narrow engineering status updates can auto-execute when they stay within the configured review channel.",
    };
  }

  return policy;
}

function buildPolicyReason(args: {
  pendingAction: PendingDelegatedAction;
  policy: DelegatedActionPolicy;
}): string {
  const { pendingAction, policy } = args;

  if (policy.requiresApproval && policy.requiresStepUp) {
    return (
      policy.approvalReason
      ?? policy.stepUpReason
      ?? `${pendingAction.title} is high risk and must pause for approval plus stronger authentication before execution.`
    );
  }

  if (policy.requiresApproval) {
    return (
      policy.approvalReason
      ?? `${pendingAction.title} changes external state, so it requires human approval before execution.`
    );
  }

  if (policy.requiresStepUp) {
    return (
      policy.stepUpReason
      ?? `${pendingAction.title} requires stronger authentication before execution.`
    );
  }

  return `${pendingAction.title} stays inside the allowed ${policy.riskLevel}-risk delegated boundary.`;
}

function recordExecutionOutcomeAudit(args: {
  sessionId: string;
  pendingAction: PendingDelegatedAction;
  execution: DelegatedActionExecution;
  approvalRequest?: ApprovalRequest;
  outcome: Awaited<ReturnType<typeof dispatchProviderAction>>;
}): void {
  const { sessionId, pendingAction, execution, approvalRequest, outcome } = args;

  if (outcome.mode === "fallback") {
    recordAuthorizationAuditEvent({
      sessionId,
      taskId: pendingAction.taskId,
      delegatedActionExecutionId: execution.id,
      approvalRequestId: approvalRequest?.id,
      provider: pendingAction.provider,
      eventType: "fallback_used",
      riskLevel: pendingAction.riskLevel,
      summary: `Secure fallback path used for ${pendingAction.title}.`,
      reason:
        outcome.status === "completed"
          ? "The live delegated path was unavailable, but a protected fallback completed the action safely."
          : "The live delegated path was unavailable, so DevPilot stayed on a protected fallback boundary.",
      scopes: pendingAction.requiredScopes,
      outcome: "fallback",
      metadata: {
        status: outcome.status,
        actionKey: pendingAction.actionKey,
      },
      dedupeKey: `fallback:${execution.id}:${outcome.status}`,
    });
  }

  const eventType =
    outcome.status === "completed"
      ? "action_completed"
      : outcome.status === "blocked"
        ? "action_blocked"
        : "action_failed";
  const auditOutcome =
    outcome.status === "completed"
      ? "allowed"
      : outcome.status === "blocked"
        ? "blocked"
        : "failed";

  recordAuthorizationAuditEvent({
    sessionId,
    taskId: pendingAction.taskId,
    delegatedActionExecutionId: execution.id,
    approvalRequestId: approvalRequest?.id,
    provider: pendingAction.provider,
    eventType,
    riskLevel: pendingAction.riskLevel,
    summary: execution.summary,
    reason: outcome.summary,
    scopes: pendingAction.requiredScopes,
    outcome: auditOutcome,
    metadata: {
      mode: outcome.mode,
      status: outcome.status,
      externalRef: outcome.externalRef,
      externalUrl: outcome.externalUrl,
    },
  });
}
