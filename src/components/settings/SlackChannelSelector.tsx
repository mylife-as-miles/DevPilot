import React, { useState, useEffect } from "react";
import { Hash, Lock, RefreshCw, CheckCircle2 } from "lucide-react";

interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
}

interface SlackChannelSelectorProps {
  selectedChannelId?: string;
  onSelect: (id: string, name: string) => void;
  onFetchChannels: () => Promise<SlackChannel[]>;
  disabled?: boolean;
}

export const SlackChannelSelector: React.FC<SlackChannelSelectorProps> = ({
  selectedChannelId,
  onSelect,
  onFetchChannels,
  disabled = false,
}) => {
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await onFetchChannels();
      setChannels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!disabled && channels.length === 0) {
      void loadChannels();
    }
  }, [disabled]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Notification Channel
        </label>
        <button
          type="button"
          onClick={() => void loadChannels()}
          disabled={loading || disabled}
          className="text-xs text-primary hover:text-primary/80 disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-2">
        {channels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {channels.map((channel) => (
              <button
                key={channel.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(channel.id, channel.name)}
                className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                  selectedChannelId === channel.id
                    ? "bg-primary/10 border-primary/40 text-white shadow-[0_0_15px_rgba(var(--color-primary-rgb),0.1)]"
                    : "bg-surface-dark/50 border-white/[0.06] text-slate-400 hover:border-white/20 hover:bg-surface-dark"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  {channel.is_private ? (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500/70" />
                  ) : (
                    <Hash className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  )}
                  <span className="truncate font-medium">{channel.name}</span>
                </div>
                {selectedChannelId === channel.id && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                )}
              </button>
            ))}
          </div>
        ) : !loading && !error ? (
          <div className="text-sm text-slate-500 py-2 italic text-center rounded-xl border border-dashed border-white/10">
            No channels found. Click refresh to try again.
          </div>
        ) : null}

        {loading && channels.length === 0 && (
          <div className="flex items-center justify-center py-8 gap-3 text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm">Fetching your workspace channels...</span>
          </div>
        )}

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/5 border border-rose-500/20 text-rose-200 text-xs">
            {error}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed italic">
        DevPilot will post status updates and approval requests to this channel. 
        Private channels require the DevPilot app to be added to the channel first.
      </p>
    </div>
  );
};
