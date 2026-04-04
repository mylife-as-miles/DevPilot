import {
  ApprovalRequest,
  AuthorizationAuditEvent,
  ConnectedIntegration,
  DelegatedActionExecution,
  DelegatedActionPolicy,
  PendingDelegatedAction,
  StepUpRequirement,
} from "../../types";

export const delegatedActionPolicyService = {
  providerLabel,
  formatScopes,
  explainPolicyDecision,
  explainApprovalRequirement,
  explainStepUpRequirement,
  explainExecutionOutcome,
  explainProviderStatus,
  explainAuditEvent,
  suggestedRemediation,
};

function providerLabel(provider: string): string {
  switch (provider) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "slack":
      return "Slack";
    case "google":
      return "Google Workspace";
    default:
      return provider;
  }
}

function formatScopes(scopes: string[]): string {
  return scopes.length > 0 ? scopes.join(", ") : "no additional scopes";
}

function explainPolicyDecision(policy: DelegatedActionPolicy): string {
  const provider = providerLabel(policy.provider);

  if (policy.riskLevel === "high") {
    return `${humanizeAction(policy.actionKey)} is high risk because it writes to ${provider} and can affect team workflow or protected delivery flow.`;
  }

  if (policy.riskLevel === "medium") {
    return `${humanizeAction(policy.actionKey)} is medium risk because it changes shared ${provider} state and should remain supervised.`;
  }

  return `${humanizeAction(policy.actionKey)} is low risk because it stays within read-only or narrowly scoped team access.`;
}

function explainApprovalRequirement(policy: DelegatedActionPolicy): string {
  if (!policy.requiresApproval) {
    return `No approval is required because this action stays within the allowed ${policy.riskLevel}-risk boundary.`;
  }

  return (
    policy.approvalReason
    ?? `Approval is required because ${humanizeAction(policy.actionKey)} changes external state.`
  );
}

function explainStepUpRequirement(policy: DelegatedActionPolicy): string {
  if (!policy.requiresStepUp) {
    return "No step-up authentication is required for this action.";
  }

  return (
    policy.stepUpReason
    ?? `Step-up authentication is required before ${humanizeAction(policy.actionKey)} can run.`
  );
}

function explainExecutionOutcome(args: {
  execution: DelegatedActionExecution;
  policy?: DelegatedActionPolicy;
  integration?: ConnectedIntegration;
  approvalRequest?: ApprovalRequest;
  stepUpRequirement?: StepUpRequirement;
}): string {
  const { execution, policy, integration, approvalRequest, stepUpRequirement } = args;
  const provider = providerLabel(execution.provider);

  if (execution.status === "completed") {
    if (execution.mode === "fallback") {
      return `Allowed with secure fallback because live ${provider} delegated access was unavailable, but a protected backend path was available.`;
    }

    if (policy?.safeToAutoExecute && execution.riskLevel === "low") {
      return `Allowed automatically because policy classifies this as a low-risk ${provider} action with scoped access.`;
    }

    return `Allowed and executed through secure delegated access after the required ${provider} checks passed.`;
  }

  if (execution.status === "awaiting_approval" || approvalRequest?.status === "pending") {
    return "Blocked until a human approves the action.";
  }

  if (execution.status === "awaiting_step_up" || stepUpRequirement?.status === "required" || stepUpRequirement?.status === "in_progress") {
    return "Blocked until stronger authentication is completed for the high-risk action.";
  }

  if (execution.status === "rejected" || approvalRequest?.status === "rejected") {
    return "Blocked because the approval request was rejected.";
  }

  if (execution.status === "expired" || approvalRequest?.status === "expired") {
    return "Blocked because the approval window expired before a decision was made.";
  }

  if (integration && integration.status !== "connected") {
    return `Blocked because ${provider} is not connected for delegated access.`;
  }

  if (execution.mode === "fallback" && execution.status === "blocked") {
    return `Blocked because live ${provider} delegated access is unavailable and no safe fallback path could complete the action.`;
  }

  if (execution.status === "failed") {
    return `Execution failed after passing authorization checks: ${execution.summary}`;
  }

  return execution.summary;
}

function explainProviderStatus(integration: ConnectedIntegration): string {
  const provider = providerLabel(integration.provider);

  if (integration.status === "connected") {
    return `${provider} is connected for delegated access through ${sourceLabel(integration.source)}.`;
  }

  if (integration.status === "expired") {
    return `${provider} access is present but needs to be refreshed before delegated actions can continue.`;
  }

  if (integration.status === "error") {
    return `${provider} could not be validated, so DevPilot will keep actions blocked or in fallback mode.`;
  }

  return `${provider} is not connected yet, so delegated actions for this provider will stay blocked until access is attached.`;
}

function explainAuditEvent(event: AuthorizationAuditEvent): string {
  if (event.reason) {
    return event.reason;
  }

  switch (event.eventType) {
    case "integration_checked":
      return "DevPilot checked the provider connection before evaluating the action boundary.";
    case "scope_evaluated":
      return `DevPilot evaluated the required scopes: ${formatScopes(event.scopes)}.`;
    case "policy_matched":
      return "DevPilot matched the delegated action against its authorization policy.";
    case "approval_requested":
      return "Human approval is required before DevPilot can continue.";
    case "approval_granted":
      return "The approval gate has been satisfied.";
    case "approval_rejected":
      return "The approval gate blocked the action.";
    case "approval_expired":
      return "The approval window closed before a decision was made.";
    case "step_up_required":
      return "A stronger authentication step is required for this action.";
    case "step_up_started":
      return "The stronger authentication checkpoint is in progress.";
    case "step_up_completed":
      return "The stronger authentication checkpoint has been completed.";
    case "action_started":
      return "The secure backend started the delegated provider action.";
    case "action_completed":
      return "The delegated provider action completed successfully.";
    case "action_failed":
      return "The delegated provider action failed.";
    case "action_blocked":
      return "The delegated provider action was blocked before execution.";
    case "fallback_used":
      return "DevPilot used a safe fallback path because the live provider path was unavailable.";
    default:
      return event.summary;
  }
}

function suggestedRemediation(args: {
  execution?: DelegatedActionExecution;
  integration?: ConnectedIntegration;
  approvalRequest?: ApprovalRequest;
  stepUpRequirement?: StepUpRequirement;
}): string | undefined {
  const { execution, integration, approvalRequest, stepUpRequirement } = args;

  if (approvalRequest?.status === "pending" || execution?.status === "awaiting_approval") {
    return "Approve the action to let DevPilot continue.";
  }

  if (stepUpRequirement?.status === "required" || stepUpRequirement?.status === "in_progress" || execution?.status === "awaiting_step_up") {
    return "Complete step-up authentication, then retry the action.";
  }

  if (approvalRequest?.status === "rejected" || execution?.status === "rejected") {
    return "Review the action details, then create a new request if you still want DevPilot to proceed.";
  }

  if (integration && integration.status !== "connected") {
    return `Connect ${providerLabel(integration.provider)} in Auth0, then refresh the secure runtime.`;
  }

  if (execution?.mode === "fallback" && execution.status === "blocked") {
    return "Enable the live provider integration or configure a secure fallback path, then retry.";
  }

  return undefined;
}

function humanizeAction(actionKey: string): string {
  return actionKey
    .split(".")
    .slice(1)
    .join(" ")
    .replace(/_/g, " ");
}

function sourceLabel(source: ConnectedIntegration["source"]): string {
  if (source === "auth0_token_vault") {
    return "Auth0 Token Vault";
  }

  if (source === "secure_backend_fallback") {
    return "the secure backend fallback";
  }

  return "local fallback mode";
}
