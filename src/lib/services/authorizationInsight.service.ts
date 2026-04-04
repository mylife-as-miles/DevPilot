import { db } from "../db";
import {
  AuthorizationAuditEvent,
  AuthorizationInsight,
  AuthorizationPatternSummary,
  SecureRuntimeSnapshot,
} from "../../types";
import { delegatedActionPolicyService } from "./delegatedActionPolicy.service";

export const authorizationInsightService = {
  buildInsights(snapshot: SecureRuntimeSnapshot): AuthorizationInsight[] {
    const insights: AuthorizationInsight[] = [];
    const now = Date.now();
    const policiesByActionKey = new Map(
      snapshot.policies.map((policy) => [policy.actionKey, policy]),
    );
    const integrationsByProvider = new Map(
      snapshot.integrations.map((integration) => [integration.provider, integration]),
    );

    for (const integration of snapshot.integrations) {
      if (integration.status === "connected") {
        continue;
      }

      insights.push({
        id: `provider:${integration.provider}:${integration.status}`,
        title:
          integration.status === "not_connected"
            ? `${delegatedActionPolicyService.providerLabel(integration.provider)} connection required`
            : `${delegatedActionPolicyService.providerLabel(integration.provider)} needs attention`,
        category: "provider_status",
        summary: delegatedActionPolicyService.explainProviderStatus(integration),
        severity: integration.status === "error" ? "important" : "warning",
        provider: integration.provider,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const warning of snapshot.warnings.slice(0, 6)) {
      insights.push({
        id: `warning:${sanitizeId(warning)}`,
        title: warning.includes("fallback") ? "Fallback mode active" : "Secure runtime note",
        category: warning.toLowerCase().includes("fallback") ? "fallback" : "provider_status",
        summary: warning,
        severity: warning.toLowerCase().includes("disabled") ? "warning" : "info",
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const pendingAction of snapshot.pendingActions) {
      const policy = policiesByActionKey.get(pendingAction.actionKey);
      const integration = integrationsByProvider.get(pendingAction.provider);
      if (!policy) {
        continue;
      }

      insights.push({
        id: `policy:${pendingAction.id}`,
        taskId: pendingAction.taskId,
        title:
          pendingAction.riskLevel === "high"
            ? "Approval required before repo write"
            : pendingAction.riskLevel === "medium"
              ? "Supervised delegated action"
              : "Scoped delegated action",
        category: "policy",
        summary: delegatedActionPolicyService.explainPolicyDecision(policy),
        severity: pendingAction.riskLevel === "high" ? "important" : "info",
        provider: pendingAction.provider,
        actionKey: pendingAction.actionKey,
        createdAt: pendingAction.createdAt,
        updatedAt: pendingAction.updatedAt,
      });

      insights.push({
        id: `scope:${pendingAction.id}`,
        taskId: pendingAction.taskId,
        title: "Required access boundary",
        category: "scope",
        summary: `Required scopes: ${delegatedActionPolicyService.formatScopes(pendingAction.requiredScopes)}.`,
        severity: "info",
        provider: pendingAction.provider,
        actionKey: pendingAction.actionKey,
        createdAt: pendingAction.createdAt,
        updatedAt: pendingAction.updatedAt,
      });

      if (pendingAction.approvalStatus === "pending") {
        insights.push({
          id: `approval:${pendingAction.id}`,
          taskId: pendingAction.taskId,
          title: "Waiting for approval",
          category: "approval",
          summary: delegatedActionPolicyService.explainApprovalRequirement(policy),
          severity: "important",
          provider: pendingAction.provider,
          actionKey: pendingAction.actionKey,
          createdAt: pendingAction.createdAt,
          updatedAt: pendingAction.updatedAt,
        });
      }

      if (
        pendingAction.stepUpStatus === "required" ||
        pendingAction.stepUpStatus === "in_progress"
      ) {
        insights.push({
          id: `stepup:${pendingAction.id}`,
          taskId: pendingAction.taskId,
          title: "Step-up required for high-risk action",
          category: "step_up",
          summary: delegatedActionPolicyService.explainStepUpRequirement(policy),
          severity: "important",
          provider: pendingAction.provider,
          actionKey: pendingAction.actionKey,
          createdAt: pendingAction.createdAt,
          updatedAt: pendingAction.updatedAt,
        });
      }

      if (
        pendingAction.status === "blocked" ||
        pendingAction.status === "rejected" ||
        pendingAction.status === "expired"
      ) {
        insights.push({
          id: `blocked:${pendingAction.id}`,
          taskId: pendingAction.taskId,
          title: "Why this action is blocked",
          category: "policy",
          summary: delegatedActionPolicyService.suggestedRemediation({
            integration,
          }) ?? "Review the provider connection or approval state, then retry.",
          severity: "warning",
          provider: pendingAction.provider,
          actionKey: pendingAction.actionKey,
          createdAt: pendingAction.createdAt,
          updatedAt: pendingAction.updatedAt,
        });
      }
    }

    for (const execution of snapshot.executions.slice(0, 12)) {
      const policy = policiesByActionKey.get(execution.actionKey);
      const integration = integrationsByProvider.get(execution.provider);
      const approvalRequest = snapshot.approvalRequests.find(
        (request) => request.id === execution.approvalRequestId,
      );
      const stepUpRequirement = snapshot.stepUpRequirements.find(
        (requirement) => requirement.id === execution.stepUpRequirementId,
      );

      const category =
        execution.status === "completed" && execution.mode === "fallback"
          ? "fallback"
          : execution.status === "completed"
            ? "policy"
            : execution.status === "awaiting_approval" || execution.status === "rejected" || execution.status === "expired"
              ? "approval"
              : execution.status === "awaiting_step_up"
                ? "step_up"
                : "policy";

      insights.push({
        id: `execution:${execution.id}`,
        taskId: execution.taskId,
        title:
          execution.status === "completed"
            ? "Why this action was allowed"
            : execution.status === "blocked" || execution.status === "failed" || execution.status === "rejected" || execution.status === "expired"
              ? "Why this action was blocked"
              : "Authorization checkpoint",
        category,
        summary: delegatedActionPolicyService.explainExecutionOutcome({
          execution,
          policy,
          integration,
          approvalRequest,
          stepUpRequirement,
        }),
        severity:
          execution.status === "completed"
            ? "info"
            : execution.status === "blocked" || execution.status === "failed"
              ? "warning"
              : "important",
        provider: execution.provider,
        actionKey: execution.actionKey,
        createdAt: execution.createdAt,
        updatedAt: execution.updatedAt,
      });
    }

    for (const auditEvent of snapshot.authorizationAuditEvents.slice(0, 12)) {
      if (
        auditEvent.eventType !== "fallback_used" &&
        auditEvent.eventType !== "action_blocked" &&
        auditEvent.eventType !== "action_completed"
      ) {
        continue;
      }

      insights.push({
        id: `audit:${auditEvent.id}`,
        taskId: auditEvent.taskId,
        title:
          auditEvent.eventType === "action_completed"
            ? "Audit: action completed"
            : auditEvent.eventType === "fallback_used"
              ? "Audit: fallback used"
              : "Audit: action blocked",
        category:
          auditEvent.eventType === "fallback_used" ? "fallback" : "policy",
        summary: delegatedActionPolicyService.explainAuditEvent(auditEvent),
        severity:
          auditEvent.outcome === "blocked" || auditEvent.outcome === "failed"
            ? "warning"
            : "info",
        provider: auditEvent.provider,
        createdAt: auditEvent.createdAt,
        updatedAt: auditEvent.createdAt,
      });
    }

    return dedupeInsights(insights).sort(sortInsights);
  },

  buildPatternSummary(
    snapshot: SecureRuntimeSnapshot,
  ): AuthorizationPatternSummary {
    const blockedProviderMap = new Map<string, number>();

    for (const event of snapshot.authorizationAuditEvents) {
      if (
        event.outcome === "blocked" ||
        event.outcome === "failed" ||
        event.outcome === "rejected"
      ) {
        blockedProviderMap.set(
          event.provider,
          (blockedProviderMap.get(event.provider) ?? 0) + 1,
        );
      }
    }

    for (const integration of snapshot.integrations) {
      if (integration.status !== "connected") {
        blockedProviderMap.set(
          integration.provider,
          (blockedProviderMap.get(integration.provider) ?? 0) + 1,
        );
      }
    }

    return {
      generatedAt: Date.now(),
      autoAllowedCount: snapshot.executions.filter(
        (execution) =>
          execution.status === "completed" &&
          execution.riskLevel === "low" &&
          execution.approvalStatus === "not_required" &&
          execution.stepUpStatus === "not_required",
      ).length,
      fallbackCount:
        snapshot.authorizationAuditEvents.filter(
          (event) => event.eventType === "fallback_used",
        ).length ||
        snapshot.executions.filter((execution) => execution.mode === "fallback").length,
      blockedCount:
        snapshot.authorizationAuditEvents.filter(
          (event) =>
            event.outcome === "blocked" ||
            event.outcome === "failed" ||
            event.outcome === "rejected",
        ).length ||
        snapshot.executions.filter(
          (execution) =>
            execution.status === "blocked" ||
            execution.status === "failed" ||
            execution.status === "rejected" ||
            execution.status === "expired",
        ).length,
      approvalRequiredCount: snapshot.policies.filter(
        (policy) => policy.requiresApproval,
      ).length,
      highRiskPolicyCount: snapshot.policies.filter(
        (policy) => policy.riskLevel === "high",
      ).length,
      blockedProviders: Array.from(blockedProviderMap.entries())
        .map(([provider, count]) => ({
          provider: provider as AuthorizationPatternSummary["blockedProviders"][number]["provider"],
          count,
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 3),
    };
  },

  async getInsights(): Promise<AuthorizationInsight[]> {
    return (await db.authorizationInsights.toArray()).sort(sortInsights);
  },

  async getInsightsForTask(taskId: string): Promise<AuthorizationInsight[]> {
    return (await db.authorizationInsights.where("taskId").equals(taskId).toArray()).sort(
      sortInsights,
    );
  },

  async replaceInsights(insights: AuthorizationInsight[]): Promise<void> {
    await db.transaction("rw", db.authorizationInsights, async () => {
      await db.authorizationInsights.clear();
      if (insights.length > 0) {
        await db.authorizationInsights.bulkPut(insights);
      }
    });
  },
};

function dedupeInsights(insights: AuthorizationInsight[]): AuthorizationInsight[] {
  const insightMap = new Map<string, AuthorizationInsight>();

  for (const insight of insights) {
    const existing = insightMap.get(insight.id);
    if (!existing || existing.updatedAt < insight.updatedAt) {
      insightMap.set(insight.id, insight);
    }
  }

  return Array.from(insightMap.values());
}

function sortInsights(left: AuthorizationInsight, right: AuthorizationInsight): number {
  const severityDelta = severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }

  return right.updatedAt - left.updatedAt;
}

function severityRank(severity: AuthorizationInsight["severity"]): number {
  switch (severity) {
    case "important":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
    default:
      return 0;
  }
}

function sanitizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48);
}
