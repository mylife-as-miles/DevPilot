import React from "react";
import { AuthorizationInsight } from "../../types";

interface AuthorizationInsightListProps {
  insights: AuthorizationInsight[];
  title?: string;
  emptyState: string;
  maxItems?: number;
  className?: string;
}

export const AuthorizationInsightList: React.FC<AuthorizationInsightListProps> = ({
  insights,
  title,
  emptyState,
  maxItems = 4,
  className = "",
}) => {
  const visibleInsights = insights.slice(0, maxItems);

  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-black/20 p-4 ${className}`}>
      {title && (
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          {title}
        </div>
      )}

      {visibleInsights.length === 0 ? (
        <div className="text-sm leading-relaxed text-slate-500">{emptyState}</div>
      ) : (
        <div className="space-y-3">
          {visibleInsights.map((insight) => (
            <div
              key={insight.id}
              className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${severityBadgeClass(insight.severity)}`}
                >
                  {insight.severity}
                </span>
                <span className="text-sm font-semibold text-white">{insight.title}</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
                {insight.summary}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                {insight.provider && <span>{insight.provider}</span>}
                {insight.actionKey && <span>{humanizeActionKey(insight.actionKey)}</span>}
                <span>{formatTimestamp(insight.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function severityBadgeClass(severity: AuthorizationInsight["severity"]): string {
  if (severity === "important") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200";
  }

  if (severity === "warning") {
    return "border-amber-500/20 bg-amber-500/10 text-amber-200";
  }

  return "border-sky-500/20 bg-sky-500/10 text-sky-200";
}

function humanizeActionKey(actionKey: string): string {
  return actionKey
    .split(".")
    .slice(1)
    .join(" ")
    .replace(/_/g, " ");
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
