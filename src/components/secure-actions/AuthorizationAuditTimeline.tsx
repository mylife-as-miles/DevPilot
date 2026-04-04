import React from "react";
import { AuthorizationAuditEvent } from "../../types";

interface AuthorizationAuditTimelineProps {
  events: AuthorizationAuditEvent[];
  title?: string;
  emptyState: string;
  maxItems?: number;
  className?: string;
}

export const AuthorizationAuditTimeline: React.FC<AuthorizationAuditTimelineProps> = ({
  events,
  title,
  emptyState,
  maxItems = 6,
  className = "",
}) => {
  const visibleEvents = events.slice(0, maxItems);

  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-black/20 p-4 ${className}`}>
      {title && (
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
          {title}
        </div>
      )}

      {visibleEvents.length === 0 ? (
        <div className="text-sm leading-relaxed text-slate-500">{emptyState}</div>
      ) : (
        <div className="space-y-3">
          {visibleEvents.map((event, index) => (
            <div key={event.id} className="flex gap-3">
              <div className="flex w-4 flex-col items-center pt-1">
                <span className={`h-2.5 w-2.5 rounded-full ${outcomeDotClass(event.outcome)}`} />
                {index < visibleEvents.length - 1 && (
                  <span className="mt-1 h-full w-px bg-white/[0.08]" />
                )}
              </div>

              <div className="flex-1 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white">{event.summary}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${outcomeBadgeClass(event.outcome)}`}
                  >
                    {event.outcome}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  <span>{humanizeEventType(event.eventType)}</span>
                  <span>{event.provider}</span>
                  <span>{formatTimestamp(event.createdAt)}</span>
                </div>
                {event.reason && (
                  <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
                    {event.reason}
                  </p>
                )}
                {event.scopes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {event.scopes.slice(0, 4).map((scope) => (
                      <span
                        key={scope}
                        className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-slate-300"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function humanizeEventType(eventType: AuthorizationAuditEvent["eventType"]): string {
  return eventType.replace(/_/g, " ");
}

function outcomeBadgeClass(outcome: AuthorizationAuditEvent["outcome"]): string {
  if (outcome === "allowed" || outcome === "approved") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-200";
  }

  if (outcome === "blocked" || outcome === "rejected" || outcome === "failed") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-200";
  }

  if (outcome === "fallback") {
    return "border-sky-500/20 bg-sky-500/10 text-sky-200";
  }

  return "border-white/[0.08] bg-white/[0.03] text-slate-400";
}

function outcomeDotClass(outcome: AuthorizationAuditEvent["outcome"]): string {
  if (outcome === "allowed" || outcome === "approved") {
    return "bg-emerald-400";
  }

  if (outcome === "blocked" || outcome === "rejected" || outcome === "failed") {
    return "bg-rose-400";
  }

  if (outcome === "fallback") {
    return "bg-sky-400";
  }

  return "bg-slate-500";
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
