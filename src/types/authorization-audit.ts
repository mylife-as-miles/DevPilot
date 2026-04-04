import {
  DelegatedRiskLevel,
  IntegrationProvider,
} from "./auth-integrations";

export type AuthorizationAuditProvider = IntegrationProvider | "unknown";

export type AuthorizationAuditEventType =
  | "integration_checked"
  | "scope_evaluated"
  | "policy_matched"
  | "approval_requested"
  | "approval_granted"
  | "approval_rejected"
  | "approval_expired"
  | "step_up_required"
  | "step_up_started"
  | "step_up_completed"
  | "action_started"
  | "action_completed"
  | "action_failed"
  | "action_blocked"
  | "fallback_used";

export type AuthorizationAuditOutcome =
  | "info"
  | "allowed"
  | "blocked"
  | "approved"
  | "rejected"
  | "fallback"
  | "failed";

export interface AuthorizationAuditEvent {
  id: string;
  taskId?: string;
  delegatedActionExecutionId?: string;
  approvalRequestId?: string;
  provider: AuthorizationAuditProvider;
  eventType: AuthorizationAuditEventType;
  riskLevel: DelegatedRiskLevel;
  summary: string;
  reason?: string;
  scopes: string[];
  outcome: AuthorizationAuditOutcome;
  metadata: string;
  createdAt: number;
}

export type AuthorizationInsightCategory =
  | "scope"
  | "approval"
  | "step_up"
  | "provider_status"
  | "policy"
  | "fallback";

export type AuthorizationInsightSeverity = "info" | "warning" | "important";

export interface AuthorizationInsight {
  id: string;
  taskId?: string;
  title: string;
  category: AuthorizationInsightCategory;
  summary: string;
  severity: AuthorizationInsightSeverity;
  provider?: AuthorizationAuditProvider;
  actionKey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuthorizationPatternSummary {
  generatedAt: number;
  autoAllowedCount: number;
  fallbackCount: number;
  blockedCount: number;
  approvalRequiredCount: number;
  highRiskPolicyCount: number;
  blockedProviders: Array<{
    provider: AuthorizationAuditProvider;
    count: number;
  }>;
}
