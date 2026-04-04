import {
  ApprovalRequest,
  ApprovalRequestTransitionResult,
  DelegatedActionExecution,
  PendingDelegatedAction,
  SecureActionExecutionResult,
  StepUpRequirement,
  StepUpRequirementTransitionResult,
} from "../../types";
import { runService } from "../services/run.service";
import { taskService } from "../services";

export async function appendSecureActionPreparedTimeline(args: {
  pendingAction: PendingDelegatedAction;
  approvalRequest?: ApprovalRequest;
  stepUpRequirement?: StepUpRequirement;
}): Promise<void> {
  const { pendingAction, approvalRequest, stepUpRequirement } = args;
  if (!pendingAction.taskId) {
    return;
  }

  if (approvalRequest) {
    await taskService.appendAgentMessage({
      taskId: pendingAction.taskId,
      sender: "system",
      content: [
        `Approval requested for ${providerLabel(pendingAction.provider)} delegated action: ${pendingAction.title}.`,
        `Scope boundary: ${pendingAction.requiredScopes.join(", ") || "none"}.`,
        stepUpRequirement
          ? "After approval, DevPilot will still pause for step-up authentication before execution."
          : "Once approved, DevPilot will execute this action through the protected backend boundary.",
      ].join(" "),
      kind: "warning",
      timestamp: Date.now(),
    });

    await runService.createAgentEvent({
      taskId: pendingAction.taskId,
      source: "orchestrator",
      type: "APPROVAL_REQUESTED",
      title: "Approval Requested",
      description: `${pendingAction.title} is waiting for human approval.`,
      metadata: JSON.stringify({
        approvalRequestId: approvalRequest.id,
        pendingActionId: pendingAction.id,
        provider: pendingAction.provider,
        actionKey: pendingAction.actionKey,
        requiredScopes: pendingAction.requiredScopes,
      }),
      timestamp: Date.now(),
    });
  } else {
    await taskService.appendAgentMessage({
      taskId: pendingAction.taskId,
      sender: "system",
      content: `Prepared delegated action: ${pendingAction.title}. DevPilot will keep execution behind the secure backend boundary.`,
      kind: "info",
      timestamp: Date.now(),
    });
  }

  if (stepUpRequirement) {
    await taskService.appendAgentMessage({
      taskId: pendingAction.taskId,
      sender: "system",
      content: `Step-up checkpoint prepared for ${pendingAction.title}. ${stepUpRequirement.reason}`,
      kind: "warning",
      timestamp: Date.now(),
    });

    await runService.createAgentEvent({
      taskId: pendingAction.taskId,
      source: "orchestrator",
      type: "STEP_UP_REQUIRED",
      title: "Step-Up Required",
      description: `${pendingAction.title} requires stronger authentication before execution.`,
      metadata: JSON.stringify({
        stepUpRequirementId: stepUpRequirement.id,
        pendingActionId: pendingAction.id,
        provider: pendingAction.provider,
        actionKey: pendingAction.actionKey,
      }),
      timestamp: Date.now(),
    });
  }
}

export async function appendApprovalTransitionTimeline(
  result: ApprovalRequestTransitionResult,
): Promise<void> {
  const taskId = result.approvalRequest.taskId ?? result.pendingAction?.taskId;
  if (!taskId) {
    return;
  }

  const approved = result.approvalRequest.status === "approved";

  await taskService.appendAgentMessage({
    taskId,
    sender: "system",
    content: approved
      ? result.stepUpRequirement && result.stepUpRequirement.status !== "completed"
        ? `Approval granted for ${result.approvalRequest.title}. Step-up authentication is now the final checkpoint before execution.`
        : `Approval granted for ${result.approvalRequest.title}. DevPilot can now execute it through the secure backend boundary.`
      : `Approval rejected for ${result.approvalRequest.title}. DevPilot will not execute the delegated action.`,
    kind: approved ? "success" : "warning",
    timestamp: Date.now(),
  });

  await runService.createAgentEvent({
    taskId,
    source: "orchestrator",
    type: approved ? "APPROVAL_APPROVED" : "APPROVAL_REJECTED",
    title: approved ? "Approval Granted" : "Approval Rejected",
    description: result.message,
    metadata: JSON.stringify({
      approvalRequestId: result.approvalRequest.id,
      pendingActionId: result.pendingAction?.id,
      executionId: result.execution?.id,
      status: result.approvalRequest.status,
    }),
    timestamp: Date.now(),
  });
}

export async function appendStepUpTransitionTimeline(
  result: StepUpRequirementTransitionResult,
): Promise<void> {
  const taskId = result.stepUpRequirement.taskId ?? result.pendingAction?.taskId;
  if (!taskId) {
    return;
  }

  const eventType =
    result.stepUpRequirement.status === "completed"
      ? "STEP_UP_COMPLETED"
      : result.stepUpRequirement.status === "in_progress"
        ? "STEP_UP_STARTED"
        : "STEP_UP_FAILED";

  await taskService.appendAgentMessage({
    taskId,
    sender: "system",
    content:
      result.stepUpRequirement.status === "completed"
        ? `Step-up authentication completed for ${result.pendingAction?.title ?? result.stepUpRequirement.actionKey}. The secure action is ready for its next checkpoint.`
        : result.stepUpRequirement.status === "in_progress"
          ? `Step-up authentication started for ${result.pendingAction?.title ?? result.stepUpRequirement.actionKey}.`
          : `Step-up authentication failed for ${result.pendingAction?.title ?? result.stepUpRequirement.actionKey}.`,
    kind: result.stepUpRequirement.status === "completed" ? "success" : "warning",
    timestamp: Date.now(),
  });

  await runService.createAgentEvent({
    taskId,
    source: "orchestrator",
    type: eventType,
    title:
      result.stepUpRequirement.status === "completed"
        ? "Step-Up Completed"
        : result.stepUpRequirement.status === "in_progress"
          ? "Step-Up Started"
          : "Step-Up Failed",
    description: result.message,
    metadata: JSON.stringify({
      stepUpRequirementId: result.stepUpRequirement.id,
      pendingActionId: result.pendingAction?.id,
      executionId: result.execution?.id,
      status: result.stepUpRequirement.status,
    }),
    timestamp: Date.now(),
  });
}

export async function appendSecureActionExecutionTimeline(
  result: SecureActionExecutionResult,
): Promise<void> {
  const taskId = result.execution.taskId;
  if (!taskId) {
    return;
  }

  const kind =
    result.execution.status === "completed"
      ? "success"
      : result.execution.status === "running"
        ? "thinking"
        : "warning";
  const eventType = resolveExecutionEventType(result.execution);

  await taskService.appendAgentMessage({
    taskId,
    sender: "system",
    content: `[${providerLabel(result.execution.provider)}] ${result.execution.summary}`,
    kind,
    timestamp: Date.now(),
  });

  await runService.createAgentEvent({
    taskId,
    source: "orchestrator",
    type: eventType,
    title: executionEventTitle(result.execution),
    description: result.message,
    metadata: JSON.stringify({
      executionId: result.execution.id,
      provider: result.execution.provider,
      actionKey: result.execution.actionKey,
      status: result.execution.status,
      externalRef: result.execution.externalRef,
      externalUrl: result.execution.externalUrl,
    }),
    timestamp: Date.now(),
  });
}

function resolveExecutionEventType(
  execution: DelegatedActionExecution,
): "REPOSITORY_ACTION" | "STATUS_CHANGED" {
  if (execution.provider === "github" || execution.provider === "gitlab") {
    return "REPOSITORY_ACTION";
  }

  return "STATUS_CHANGED";
}

function executionEventTitle(execution: DelegatedActionExecution): string {
  switch (execution.status) {
    case "completed":
      return "Delegated Action Completed";
    case "awaiting_approval":
      return "Awaiting Approval";
    case "awaiting_step_up":
      return "Awaiting Step-Up";
    case "blocked":
      return "Delegated Action Blocked";
    case "failed":
      return "Delegated Action Failed";
    case "rejected":
      return "Delegated Action Rejected";
    case "expired":
      return "Delegated Action Expired";
    default:
      return "Delegated Action Updated";
  }
}

function providerLabel(provider: PendingDelegatedAction["provider"]): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "slack":
      return "Slack";
    case "google":
      return "Google";
    default:
      return provider;
  }
}
