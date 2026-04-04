import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { SecureRuntimeState } from "../../hooks/useTaskHub";
import { config } from "../../lib/config/env";
import {
  ConnectedIntegration,
  DelegatedActionExecution,
  DelegatedActionPolicy,
  DelegatedActionPreviewInput,
  PendingDelegatedAction,
  SecureActionExecutionResult,
} from "../../types";

const quickReadTemplates: DelegatedActionPreviewInput[] = [
  {
    provider: "github",
    actionKey: "github.read_repo_metadata",
    title: "Read GitHub repo metadata",
    summary:
      "Low-risk read of the configured GitHub repository through the secure Auth0 Token Vault path.",
    metadata: {
      owner: config.defaultGitHubOwner,
      repo: config.defaultGitHubRepo,
    },
  },
  {
    provider: "github",
    actionKey: "github.read_open_prs",
    title: "Read open GitHub pull requests",
    summary:
      "Low-risk read of open pull requests for the configured GitHub repository.",
    metadata: {
      owner: config.defaultGitHubOwner,
      repo: config.defaultGitHubRepo,
    },
  },
  {
    provider: "slack",
    actionKey: "slack.read_channel_metadata",
    title: "Read Slack channel metadata",
    summary:
      "Low-risk read of connected Slack channel metadata before DevPilot posts review or verification updates.",
  },
];

const queuedActionTemplates: DelegatedActionPreviewInput[] = [
  {
    provider: "github",
    actionKey: "github.create_draft_issue",
    title: "Queue GitHub draft issue",
    summary:
      "Medium-risk repo action to create a review-ready GitHub issue through the secure backend.",
    metadata: {
      owner: config.defaultGitHubOwner,
      repo: config.defaultGitHubRepo,
      title: "DevPilot follow-up: review-ready patch proposal",
      body: "DevPilot prepared a follow-up issue through the secure delegated action boundary.",
    },
  },
  {
    provider: "slack",
    actionKey: "slack.post_status_message",
    title: "Queue Slack review-ready status",
    summary:
      "Medium-risk team communication action routed through the secure backend boundary.",
    metadata: {
      channelId: config.defaultSlackChannelId,
      text: "DevPilot has a review-ready patch proposal awaiting teammate attention.",
    },
  },
  {
    provider: "slack",
    actionKey: "slack.post_approval_requested",
    title: "Queue Slack approval request",
    summary:
      "Medium-risk notification to ask for approval on a sensitive delegated action.",
    metadata: {
      channelId: config.defaultSlackChannelId,
      text: "DevPilot is waiting on approval for a sensitive delegated action.",
    },
  },
];

interface SecureDelegationSettingsPanelProps {
  secureRuntimeState: SecureRuntimeState;
  onRefreshSecureRuntime: () => Promise<void>;
  onPreviewDelegatedAction: (
    input: DelegatedActionPreviewInput,
  ) => Promise<PendingDelegatedAction | null>;
  onTriggerDelegatedAction: (
    input: DelegatedActionPreviewInput,
    options?: { executeImmediatelyWhenSafe?: boolean },
  ) => Promise<PendingDelegatedAction | SecureActionExecutionResult | null>;
  onApprovePendingAction: (id: string) => Promise<PendingDelegatedAction | null>;
  onRejectPendingAction: (id: string) => Promise<PendingDelegatedAction | null>;
  onExecutePendingAction: (id: string) => Promise<SecureActionExecutionResult | null>;
  onLogin: (returnTo?: string) => void;
  onLogout: (returnTo?: string) => void;
}

export const SecureDelegationSettingsPanel: React.FC<
  SecureDelegationSettingsPanelProps
> = ({
  secureRuntimeState,
  onRefreshSecureRuntime,
  onPreviewDelegatedAction,
  onTriggerDelegatedAction,
  onApprovePendingAction,
  onRejectPendingAction,
  onExecutePendingAction,
  onLogin,
  onLogout,
}) => {
  const [isRefreshingRuntime, setIsRefreshingRuntime] = useState(false);
  const [executingActionId, setExecutingActionId] = useState<string | null>(null);

  const policiesByRisk = useMemo(
    () => ({
      low: secureRuntimeState.policies.filter((policy) => policy.riskLevel === "low"),
      medium: secureRuntimeState.policies.filter(
        (policy) => policy.riskLevel === "medium",
      ),
      high: secureRuntimeState.policies.filter(
        (policy) => policy.riskLevel === "high",
      ),
    }),
    [secureRuntimeState.policies],
  );

  const policiesByActionKey = useMemo(
    () =>
      new Map(
        secureRuntimeState.policies.map((policy) => [policy.actionKey, policy]),
      ),
    [secureRuntimeState.policies],
  );

  const integrationsByProvider = useMemo(
    () =>
      new Map(
        secureRuntimeState.integrations.map((integration) => [
          integration.provider,
          integration,
        ]),
      ),
    [secureRuntimeState.integrations],
  );

  const connectedCount = secureRuntimeState.integrations.filter(
    (integration) => integration.status === "connected",
  ).length;
  const pendingApprovalCount = secureRuntimeState.pendingActions.filter(
    (action) => action.approvalStatus === "pending",
  ).length;

  const refreshRuntime = async () => {
    setIsRefreshingRuntime(true);
    try {
      await onRefreshSecureRuntime();
    } finally {
      setIsRefreshingRuntime(false);
    }
  };

  const executeAction = async (id: string) => {
    setExecutingActionId(id);
    try {
      await onExecutePendingAction(id);
    } finally {
      setExecutingActionId(null);
    }
  };

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white">Secure Delegation Runtime</h3>
            <p className="mt-1 text-sm text-slate-400">
              Auth0-backed session awareness, explicit provider boundaries, and
              server-side delegated action gating.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshRuntime()}
            className="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-dark px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/5"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshingRuntime ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-surface/30 p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
                <LockKeyhole className="h-3.5 w-3.5" />
                {secureRuntimeState.session?.runtimeMode === "live"
                  ? "Auth0 Secure Runtime"
                  : "Local Fallback Runtime"}
              </div>
              <div>
                <div className="text-lg font-semibold text-white">
                  {secureRuntimeState.session?.status === "authenticated"
                    ? secureRuntimeState.session.user?.name ?? "Authenticated session"
                    : "Authentication required"}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {secureRuntimeState.session?.message ??
                    "Waiting for secure runtime status."}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                <MetaChip label="Connected tools" value={String(connectedCount)} />
                <MetaChip
                  label="Pending approvals"
                  value={String(pendingApprovalCount)}
                />
                <MetaChip
                  label="Token Vault ready"
                  value={secureRuntimeState.session?.auth0.tokenVaultReady ? "Yes" : "No"}
                />
              </div>
            </div>

            <div className="flex min-w-[220px] flex-col gap-3">
              {secureRuntimeState.session?.status === "authenticated" &&
              secureRuntimeState.session.runtimeMode === "live" ? (
                <button
                  type="button"
                  onClick={() => onLogout("/settings")}
                  className="rounded-lg border border-border-subtle bg-surface-dark px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-white/5"
                >
                  Sign Out
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onLogin("/settings")}
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-background-dark transition-colors hover:bg-primary/90"
                >
                  Sign In With Auth0
                </button>
              )}
              <div className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-xs leading-relaxed text-slate-400">
                Frontend sees runtime state, but provider tokens remain behind the
                secure backend boundary.
              </div>
            </div>
          </div>

          {secureRuntimeState.warnings.length > 0 && (
            <div className="mt-6 space-y-3">
              {secureRuntimeState.warnings.map((warning) => (
                <div
                  key={warning}
                  className="flex items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3 text-sm text-amber-100/90"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-xl font-bold text-white">Connected Accounts</h3>
        <p className="mb-6 text-sm text-slate-400">
          Provider visibility stays explicit: connection status, relevant scopes,
          and whether DevPilot is using Auth0 Token Vault or a secure backend
          fallback.
        </p>
        <div className="space-y-4">
          {secureRuntimeState.integrations.map((integration) => (
            <div
              key={integration.id}
              className="rounded-2xl border border-border-subtle bg-surface/30 p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-sm font-semibold text-white">
                      {integration.displayName}
                    </h4>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusBadgeClass(integration.status)}`}
                    >
                      {integration.status.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${sourceBadgeClass(integration.source)}`}
                    >
                      {sourceLabel(integration.source)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    {integration.accountIdentifier
                      ? `Connected as ${integration.accountIdentifier}`
                      : "No provider account is attached yet for delegated actions."}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {integration.connectedAt
                      ? `Connected ${formatTimestamp(integration.connectedAt)}`
                      : "Waiting for provider connection or secure fallback configuration."}
                  </p>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-black/20 px-4 py-3 text-right text-xs text-slate-400">
                  Updated {formatTimestamp(integration.updatedAt)}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {integration.scopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-slate-300"
                  >
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-bold text-white">Permission Boundaries</h3>
        </div>
        <p className="mb-6 text-sm text-slate-400">
          Low-risk reads, medium-risk drafting, and high-risk execution paths are
          modeled separately so future approvals and step-up authentication fit
          naturally.
        </p>

        <div className="grid gap-4 lg:grid-cols-3">
          <RiskPolicyCard title="Low Risk" tone="low" policies={policiesByRisk.low} />
          <RiskPolicyCard
            title="Medium Risk"
            tone="medium"
            policies={policiesByRisk.medium}
          />
          <RiskPolicyCard
            title="High Risk"
            tone="high"
            policies={policiesByRisk.high}
          />
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center gap-2">
          <Workflow className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-bold text-white">Delegated Actions</h3>
        </div>
        <p className="mb-6 text-sm text-slate-400">
          Low-risk reads can run immediately through the secure backend. Drafting
          and communication actions stay approval-aware before DevPilot acts on the
          user's behalf.
        </p>

        <ActionGroup
          title="Quick live reads"
          templates={quickReadTemplates}
          policiesByActionKey={policiesByActionKey}
          integrationsByProvider={integrationsByProvider}
          buttonLabel="Run now"
          onAction={(template) =>
            onTriggerDelegatedAction(template, {
              executeImmediatelyWhenSafe: true,
            })
          }
        />

        <ActionGroup
          title="Approval-backed writes"
          templates={queuedActionTemplates}
          policiesByActionKey={policiesByActionKey}
          integrationsByProvider={integrationsByProvider}
          buttonLabel="Queue approval"
          buttonTone="warning"
          onAction={onPreviewDelegatedAction}
          className="mt-4"
        />

        <div className="mt-4 space-y-4">
          {secureRuntimeState.pendingActions.map((action) => (
            <div
              key={action.id}
              className="rounded-2xl border border-border-subtle bg-surface/30 p-5"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-sm font-semibold text-white">{action.title}</h4>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${riskBadgeClass(action.riskLevel)}`}
                    >
                      {action.riskLevel} risk
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${approvalBadgeClass(action.approvalStatus)}`}
                    >
                      {action.approvalStatus.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${stepUpBadgeClass(action.stepUpStatus)}`}
                    >
                      {action.stepUpStatus.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    {action.summary}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    {action.provider.toUpperCase()} / {action.actionKey}
                    {action.taskId ? ` / Task ${action.taskId}` : ""}
                  </p>
                </div>

                <div className="text-xs text-slate-500">
                  Updated {formatTimestamp(action.updatedAt)}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {action.requiredScopes.map((scope) => (
                  <span
                    key={scope}
                    className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[11px] text-slate-300"
                  >
                    {scope}
                  </span>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                {action.approvalStatus === "pending" && (
                  <>
                    <button
                      type="button"
                      onClick={() => void onApprovePendingAction(action.id)}
                      className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-500/15"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void onRejectPendingAction(action.id)}
                      className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition-colors hover:bg-rose-500/15"
                    >
                      Reject
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => void executeAction(action.id)}
                  disabled={executingActionId === action.id}
                  className="rounded-lg border border-border-subtle bg-surface-dark px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {executingActionId === action.id
                    ? "Running..."
                    : "Run through secure boundary"}
                </button>
              </div>
            </div>
          ))}

          {secureRuntimeState.pendingActions.length === 0 && (
            <div className="rounded-2xl border border-border-subtle bg-surface/20 px-6 py-10 text-center text-slate-500">
              No delegated action approvals are pending right now.
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-bold text-white">Execution History</h3>
        </div>
        <p className="mb-6 text-sm text-slate-400">
          Live and fallback outcomes are stored separately from approvals so it is
          clear when DevPilot completed, blocked, or failed a delegated action.
        </p>

        <div className="space-y-4">
          {secureRuntimeState.executions.map((execution) => (
            <ExecutionCard key={execution.id} execution={execution} />
          ))}

          {secureRuntimeState.executions.length === 0 && (
            <div className="rounded-2xl border border-border-subtle bg-surface/20 px-6 py-10 text-center text-slate-500">
              No delegated action executions yet. Run a low-risk read or approve a
              queued action to create the first execution record.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

const ActionGroup = ({
  title,
  templates,
  policiesByActionKey,
  integrationsByProvider,
  buttonLabel,
  buttonTone = "primary",
  onAction,
  className = "",
}: {
  title: string;
  templates: DelegatedActionPreviewInput[];
  policiesByActionKey: Map<string, DelegatedActionPolicy>;
  integrationsByProvider: Map<string, ConnectedIntegration>;
  buttonLabel: string;
  buttonTone?: "primary" | "warning";
  onAction: (
    template: DelegatedActionPreviewInput,
  ) => Promise<PendingDelegatedAction | SecureActionExecutionResult | null>;
  className?: string;
}) => (
  <div className={`rounded-2xl border border-border-subtle bg-surface/30 p-5 ${className}`}>
    <div className="mb-4 text-sm font-semibold text-white">{title}</div>
    <div className="grid gap-3 lg:grid-cols-3">
      {templates.map((template) => (
        <ActionTemplateCard
          key={template.actionKey}
          template={template}
          policy={policiesByActionKey.get(template.actionKey)}
          integration={integrationsByProvider.get(template.provider)}
          disabledReason={getTemplateDisabledReason(template)}
          buttonLabel={buttonLabel}
          buttonTone={buttonTone}
          onClick={() => void onAction(template)}
        />
      ))}
    </div>
  </div>
);

const MetaChip = ({ label, value }: { label: string; value: string }) => (
  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
    <span className="text-slate-500">{label}</span>
    <span className="ml-2 font-semibold text-slate-200">{value}</span>
  </span>
);

const RiskPolicyCard = ({
  title,
  tone,
  policies,
}: {
  title: string;
  tone: "low" | "medium" | "high";
  policies: DelegatedActionPolicy[];
}) => (
  <div className={`rounded-2xl border p-5 ${riskContainerClass(tone)}`}>
    <div className="flex items-center justify-between">
      <h4 className="text-sm font-semibold text-white">{title}</h4>
      <span
        className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${riskBadgeClass(tone)}`}
      >
        {policies.length} actions
      </span>
    </div>
    <div className="mt-4 space-y-4">
      {policies.map((policy) => (
        <div key={policy.id}>
          <p className="text-sm font-medium text-slate-100">{policy.summary}</p>
          <p className="mt-1 text-xs text-slate-500">
            {policy.requiresApproval ? "Requires approval" : "No approval"} /{" "}
            {policy.requiresStepUp ? "Step-up expected" : "No step-up"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {policy.allowedScopes.map((scope) => (
              <span
                key={scope}
                className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-slate-300"
              >
                {scope}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ActionTemplateCard = ({
  template,
  policy,
  integration,
  disabledReason,
  buttonLabel,
  buttonTone = "primary",
  onClick,
}: {
  template: DelegatedActionPreviewInput;
  policy?: DelegatedActionPolicy;
  integration?: ConnectedIntegration;
  disabledReason?: string;
  buttonLabel: string;
  buttonTone?: "primary" | "warning";
  onClick: () => void;
}) => {
  const connectionLabel = integration
    ? integration.status === "connected"
      ? `${integration.displayName} connected`
      : `${integration.displayName} ${integration.status.replace(/_/g, " ")}`
    : "Provider state unavailable";

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
          {template.provider}
        </span>
        {policy && (
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${riskBadgeClass(policy.riskLevel)}`}
          >
            {policy.riskLevel}
          </span>
        )}
      </div>

      <div className="mt-3 text-sm font-semibold text-white">
        {template.title ?? template.actionKey}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        {template.summary ?? policy?.summary ?? "Delegated action"}
      </p>

      <div className="mt-3 space-y-2 text-xs text-slate-500">
        <div>{connectionLabel}</div>
        {policy && (
          <div>
            {policy.requiresApproval ? "Approval required" : "Auto-executes when safe"}
            {policy.requiresStepUp ? " / Step-up expected later" : ""}
          </div>
        )}
        {integration?.status !== "connected" && (
          <div className="text-amber-300/90">
            This action can be previewed now, but execution will block until the
            provider connection is ready.
          </div>
        )}
        {disabledReason && <div className="text-rose-300/90">{disabledReason}</div>}
      </div>

      {policy && (
        <div className="mt-3 flex flex-wrap gap-2">
          {policy.allowedScopes.map((scope) => (
            <span
              key={scope}
              className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-slate-300"
            >
              {scope}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onClick}
        disabled={Boolean(disabledReason)}
        className={
          buttonTone === "warning"
            ? "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-amber-500/15 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-100 transition-colors hover:border-amber-500/30 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-60"
            : "mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/15 bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:border-primary/30 hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {buttonLabel}
        <ArrowUpRight className="h-4 w-4" />
      </button>
    </div>
  );
};

const ExecutionCard = ({ execution }: { execution: DelegatedActionExecution }) => (
  <div className="rounded-2xl border border-border-subtle bg-surface/30 p-5">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h4 className="text-sm font-semibold text-white">{execution.summary}</h4>
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${executionStatusClass(execution.status)}`}
          >
            {execution.status}
          </span>
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              execution.mode === "live"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-sky-500/20 bg-sky-500/10 text-sky-200"
            }`}
          >
            {execution.mode}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {execution.provider.toUpperCase()} / {execution.actionKey}
          {execution.taskId ? ` / Task ${execution.taskId}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {execution.logs.slice(0, 4).map((log) => (
            <span
              key={log}
              className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-slate-300"
            >
              {log}
            </span>
          ))}
        </div>
        {execution.externalUrl && (
          <a
            href={execution.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            Open provider record
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="text-xs text-slate-500">
        {execution.completedAt
          ? `Completed ${formatTimestamp(execution.completedAt)}`
          : `Updated ${formatTimestamp(execution.updatedAt)}`}
      </div>
    </div>
  </div>
);

function getTemplateDisabledReason(
  template: DelegatedActionPreviewInput,
): string | undefined {
  if (
    template.provider === "github" &&
    (!config.defaultGitHubOwner || !config.defaultGitHubRepo)
  ) {
    return "Set VITE_DEFAULT_GITHUB_OWNER and VITE_DEFAULT_GITHUB_REPO to enable this GitHub action.";
  }

  if (
    template.provider === "slack" &&
    template.actionKey !== "slack.read_channel_metadata" &&
    !config.defaultSlackChannelId
  ) {
    return "Set VITE_DEFAULT_SLACK_CHANNEL_ID to queue Slack posting actions.";
  }

  return undefined;
}

function riskContainerClass(tone: "low" | "medium" | "high"): string {
  if (tone === "low") {
    return "border-emerald-500/15 bg-emerald-500/5";
  }
  if (tone === "medium") {
    return "border-amber-500/15 bg-amber-500/5";
  }
  return "border-rose-500/15 bg-rose-500/5";
}

function riskBadgeClass(riskLevel: "low" | "medium" | "high"): string {
  if (riskLevel === "low") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (riskLevel === "medium") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }
  return "border-rose-500/20 bg-rose-500/10 text-rose-200";
}

function approvalBadgeClass(status: PendingDelegatedAction["approvalStatus"]): string {
  if (status === "approved" || status === "not_required") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "rejected") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200";
  }
  return "border-amber-500/20 bg-amber-500/10 text-amber-200";
}

function stepUpBadgeClass(status: PendingDelegatedAction["stepUpStatus"]): string {
  if (status === "completed" || status === "not_required") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  return "border-primary/20 bg-primary/10 text-primary";
}

function statusBadgeClass(
  status: "connected" | "not_connected" | "expired" | "error",
): string {
  if (status === "connected") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "expired") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }
  if (status === "error") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200";
  }
  return "border-white/[0.08] bg-white/[0.03] text-slate-400";
}

function sourceBadgeClass(source: string): string {
  if (source === "auth0_token_vault") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (source === "secure_backend_fallback") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-200";
  }
  return "border-white/[0.08] bg-white/[0.03] text-slate-400";
}

function sourceLabel(source: string): string {
  if (source === "auth0_token_vault") {
    return "Auth0 Token Vault";
  }
  if (source === "secure_backend_fallback") {
    return "Secure Fallback";
  }
  return "Mock Fallback";
}

function executionStatusClass(status: DelegatedActionExecution["status"]): string {
  if (status === "completed") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "running") {
    return "border-primary/20 bg-primary/10 text-primary";
  }
  if (status === "blocked") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }
  if (status === "failed") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200";
  }
  return "border-white/[0.08] bg-white/[0.03] text-slate-400";
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
