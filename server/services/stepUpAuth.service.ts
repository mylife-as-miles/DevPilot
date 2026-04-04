import crypto from "node:crypto";
import {
  DelegatedActionExecution,
  DelegatedActionPolicy,
  PendingDelegatedAction,
  StepUpRequirement,
  StepUpRequirementTransitionResult,
} from "../../src/types";
import {
  getExecutionForSession,
  getPendingActionForSession,
  getStepUpRequirementByPendingAction,
  getStepUpRequirementForSession,
  storePendingAction,
  storeStepUpRequirement,
  upsertExecution,
} from "../runtime.store";
import { RuntimeEnv } from "../runtime.types";
import { recordAuthorizationAuditEvent } from "./authorizationAudit.service";

export function createStepUpRequirementForPendingAction(options: {
  sessionId: string;
  pendingAction: PendingDelegatedAction;
  policy: DelegatedActionPolicy;
  delegatedActionExecutionId: string;
  now?: number;
}): StepUpRequirement {
  const existing = getStepUpRequirementByPendingAction(
    options.sessionId,
    options.pendingAction.id,
  );
  if (existing) {
    return existing;
  }

  const now = options.now ?? Date.now();

  const stepUpRequirement = storeStepUpRequirement(options.sessionId, {
    id: `stepup:${crypto.randomUUID()}`,
    taskId: options.pendingAction.taskId,
    pendingActionId: options.pendingAction.id,
    delegatedActionExecutionId: options.delegatedActionExecutionId,
    actionKey: options.pendingAction.actionKey,
    provider: options.pendingAction.provider,
    required: true,
    reason:
      options.policy.stepUpReason
      ?? "This action requires stronger user authentication before execution.",
    status: "required",
    createdAt: now,
    updatedAt: now,
  });

  recordAuthorizationAuditEvent({
    sessionId: options.sessionId,
    taskId: stepUpRequirement.taskId,
    delegatedActionExecutionId: stepUpRequirement.delegatedActionExecutionId,
    provider: stepUpRequirement.provider,
    eventType: "step_up_required",
    riskLevel: options.pendingAction.riskLevel,
    summary: `Step-up required for ${options.pendingAction.title}.`,
    reason: stepUpRequirement.reason,
    scopes: options.pendingAction.requiredScopes,
    outcome: "blocked",
    metadata: {
      stepUpTrigger: options.policy.stepUpTrigger,
      mode: "checkpoint_created",
    },
  });

  return stepUpRequirement;
}

export function startStepUpRequirementForSession(options: {
  env: RuntimeEnv;
  sessionId: string;
  stepUpRequirementId: string;
}): StepUpRequirementTransitionResult {
  const requirement = getRequiredStepUpRequirement(
    options.sessionId,
    options.stepUpRequirementId,
  );
  const pendingAction = requirement.pendingActionId
    ? getPendingActionForSession(options.sessionId, requirement.pendingActionId)
    : undefined;
  const execution = requirement.delegatedActionExecutionId
    ? getExecutionForSession(options.sessionId, requirement.delegatedActionExecutionId)
    : undefined;
  const now = Date.now();

  const nextRequirement = storeStepUpRequirement(options.sessionId, {
    ...requirement,
    status: "in_progress",
    updatedAt: now,
  });

  const nextPendingAction = pendingAction
    ? storePendingAction(options.sessionId, {
        ...pendingAction,
        stepUpStatus: "in_progress",
        status: "awaiting_step_up",
        updatedAt: now,
      })
    : undefined;

  const nextExecution = execution
    ? upsertExecution(
        options.sessionId,
        updateExecution(execution, {
          status: "awaiting_step_up",
          stepUpStatus: "in_progress",
          summary: options.env.liveStepUpMode
            ? `Step-up started for ${requirement.actionKey}. Waiting for stronger user authentication.`
            : `Step-up started for ${requirement.actionKey}. Local fallback confirmation can complete it.`,
          log: options.env.liveStepUpMode
            ? "[STEP_UP] Step-up flow started in live-placeholder mode."
            : "[STEP_UP] Step-up flow started in local fallback mode.",
        }),
      )
    : undefined;

  recordAuthorizationAuditEvent({
    sessionId: options.sessionId,
    taskId: nextRequirement.taskId,
    delegatedActionExecutionId: nextRequirement.delegatedActionExecutionId,
    provider: nextRequirement.provider,
    eventType: "step_up_started",
    riskLevel: pendingAction?.riskLevel ?? "high",
    summary: `Step-up started for ${nextRequirement.actionKey}.`,
    reason: options.env.liveStepUpMode
      ? "A stronger authentication checkpoint is now in progress through the live step-up placeholder path."
      : "A stronger authentication checkpoint is now in progress through the local fallback step-up path.",
    scopes: pendingAction?.requiredScopes ?? [],
    outcome: "info",
    metadata: {
      status: nextRequirement.status,
      liveStepUpMode: options.env.liveStepUpMode,
    },
  });

  return {
    stepUpRequirement: nextRequirement,
    pendingAction: nextPendingAction,
    execution: nextExecution,
    message: options.env.liveStepUpMode
      ? "Step-up started."
      : "Step-up started in fallback mode.",
  };
}

export function completeStepUpRequirementForSession(options: {
  sessionId: string;
  stepUpRequirementId: string;
}): StepUpRequirementTransitionResult {
  const requirement = getRequiredStepUpRequirement(
    options.sessionId,
    options.stepUpRequirementId,
  );
  const pendingAction = requirement.pendingActionId
    ? getPendingActionForSession(options.sessionId, requirement.pendingActionId)
    : undefined;
  const execution = requirement.delegatedActionExecutionId
    ? getExecutionForSession(options.sessionId, requirement.delegatedActionExecutionId)
    : undefined;
  const now = Date.now();

  const nextRequirement = storeStepUpRequirement(options.sessionId, {
    ...requirement,
    status: "completed",
    updatedAt: now,
  });

  const nextPendingAction = pendingAction
    ? storePendingAction(options.sessionId, {
        ...pendingAction,
        stepUpStatus: "completed",
        status:
          pendingAction.approvalStatus === "approved"
          || pendingAction.approvalStatus === "not_required"
            ? "approved"
            : "awaiting_approval",
        updatedAt: now,
      })
    : undefined;

  const nextExecution = execution
    ? upsertExecution(
        options.sessionId,
        updateExecution(execution, {
          status:
            pendingAction?.approvalStatus === "approved"
            || pendingAction?.approvalStatus === "not_required"
              ? "approved"
              : "awaiting_approval",
          stepUpStatus: "completed",
          summary:
            pendingAction?.approvalStatus === "approved"
            || pendingAction?.approvalStatus === "not_required"
              ? `Step-up completed for ${requirement.actionKey}. Action is ready to execute.`
              : `Step-up completed for ${requirement.actionKey}. Approval is still required.`,
          log: "[STEP_UP] Step-up completed.",
        }),
      )
    : undefined;

  recordAuthorizationAuditEvent({
    sessionId: options.sessionId,
    taskId: nextRequirement.taskId,
    delegatedActionExecutionId: nextRequirement.delegatedActionExecutionId,
    provider: nextRequirement.provider,
    eventType: "step_up_completed",
    riskLevel: pendingAction?.riskLevel ?? "high",
    summary: `Step-up completed for ${nextRequirement.actionKey}.`,
    reason:
      nextPendingAction?.status === "approved"
        ? "Stronger authentication completed, so the action is now ready for execution."
        : "Stronger authentication completed, but approval is still required before execution.",
    scopes: pendingAction?.requiredScopes ?? [],
    outcome: "approved",
    metadata: {
      status: nextRequirement.status,
      pendingActionStatus: nextPendingAction?.status,
    },
  });

  return {
    stepUpRequirement: nextRequirement,
    pendingAction: nextPendingAction,
    execution: nextExecution,
    message:
      nextPendingAction?.status === "approved"
        ? "Step-up completed. Action is ready to execute."
        : "Step-up completed. Approval is still required.",
  };
}

function getRequiredStepUpRequirement(
  sessionId: string,
  stepUpRequirementId: string,
): StepUpRequirement {
  const requirement = getStepUpRequirementForSession(sessionId, stepUpRequirementId);
  if (!requirement) {
    throw new Error("Step-up requirement not found.");
  }

  return requirement;
}

function updateExecution(
  execution: DelegatedActionExecution,
  updates: {
    status: DelegatedActionExecution["status"];
    stepUpStatus: DelegatedActionExecution["stepUpStatus"];
    summary: string;
    log: string;
  },
): DelegatedActionExecution {
  return {
    ...execution,
    status: updates.status,
    stepUpStatus: updates.stepUpStatus,
    summary: updates.summary,
    logs: [...execution.logs, updates.log],
    updatedAt: Date.now(),
  };
}
