import {
  DelegatedActionMetadata,
  DelegatedActionProvider,
} from "../../src/types";
import { exchangeProviderAccessToken } from "./tokenVault.service";
import {
  ProviderActionContext,
  ProviderActionOutcome,
  ProviderConnectionResult,
} from "../runtime.types";

const SLACK_API = "https://slack.com/api";

export const slackActionService = {
  provider: "slack" as DelegatedActionProvider,

  async validateConnection(
    context: ProviderActionContext,
  ): Promise<ProviderConnectionResult> {
    if (!context.env.liveDelegatedActionMode || !context.env.liveSlackActionMode) {
      return {
        provider: "slack",
        status: "not_connected",
        source: "auth0_token_vault",
        logs: ["[SLACK] Live Slack delegated action mode is disabled."],
      };
    }

    try {
      const token = await exchangeProviderAccessToken({
        env: context.env,
        session: context.session,
        provider: "slack",
      });
      const auth = await slackFetch<{
        ok: boolean;
        user: string;
        team: string;
      }>("/auth.test", token.accessToken, { method: "POST" });

      return {
        provider: "slack",
        status: "connected",
        source: "auth0_token_vault",
        accountIdentifier: `${auth.user} @ ${auth.team}`,
        connectedAt: Date.now(),
        logs: [...token.logs, `[SLACK] Connected as ${auth.user} in ${auth.team}.`],
      };
    } catch (error) {
      return {
        provider: "slack",
        status: classifyConnectionError(error),
        source: "auth0_token_vault",
        logs: [error instanceof Error ? error.message : String(error)],
      };
    }
  },

  async executeAction(
    actionKey: string,
    context: ProviderActionContext,
  ): Promise<ProviderActionOutcome> {
    if (!context.env.liveDelegatedActionMode || !context.env.liveSlackActionMode) {
      return {
        mode: "fallback",
        status: "blocked",
        summary: "Slack delegated execution is disabled in this environment.",
        logs: ["[SLACK] Live Slack delegated execution mode is disabled."],
      };
    }

    const token = await exchangeProviderAccessToken({
      env: context.env,
      session: context.session,
      provider: "slack",
      loginHint: asOptionalString(context.metadata.accountIdentifier),
    });

    switch (actionKey) {
      case "slack.read_channel_metadata":
        return readChannelMetadata(context.metadata, token.accessToken, token.logs);
      case "slack.post_status_message":
      case "slack.post_verification_summary":
      case "slack.post_approval_requested":
        return postMessage(actionKey, context.metadata, token.accessToken, token.logs);
      default:
        return {
          mode: "live",
          status: "failed",
          summary: `Slack action '${actionKey}' is not implemented.`,
          logs: [...token.logs, `[SLACK] Unsupported action '${actionKey}'.`],
        };
    }
  },
};

async function readChannelMetadata(
  metadata: DelegatedActionMetadata,
  accessToken: string,
  logs: string[],
): Promise<ProviderActionOutcome> {
  const channels = await slackFetch<{
    ok: boolean;
    channels: Array<{ id: string; name: string; is_private: boolean }>;
  }>(
    "/conversations.list?exclude_archived=true&limit=25&types=public_channel,private_channel",
    accessToken,
  );

  return {
    mode: "live",
    status: "completed",
    summary: `Loaded ${channels.channels.length} Slack channel${channels.channels.length === 1 ? "" : "s"} for delegated messaging.`,
    logs: [...logs, `[SLACK] Loaded ${channels.channels.length} channel metadata records.`],
    externalRef: asOptionalString(metadata.channelId),
    metadata: {
      channels: channels.channels.slice(0, 12),
    },
  };
}

async function postMessage(
  actionKey: string,
  metadata: DelegatedActionMetadata,
  accessToken: string,
  logs: string[],
): Promise<ProviderActionOutcome> {
  const channel = requiredString(metadata.channelId, "channelId");
  const text = requiredString(metadata.text, "text");

  const result = await slackFetch<{
    ok: boolean;
    ts: string;
    channel: string;
    message?: { text?: string };
  }>("/chat.postMessage", accessToken, {
    method: "POST",
    body: JSON.stringify({
      channel,
      text,
    }),
  });

  const label =
    actionKey === "slack.post_verification_summary"
      ? "verification summary"
      : actionKey === "slack.post_approval_requested"
        ? "approval request"
        : "status message";

  return {
    mode: "live",
    status: "completed",
    summary: `Posted a Slack ${label} to ${channel}.`,
    logs: [...logs, `[SLACK] Posted ${label} to channel ${channel}.`],
    externalRef: result.ts,
    metadata: result,
  };
}

async function slackFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${SLACK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Slack API request failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as { ok?: boolean; error?: string };
  if (payload.ok === false) {
    throw new Error(`Slack API request failed: ${payload.error ?? "unknown_error"}`);
  }

  return payload as T;
}

function requiredString(value: unknown, field: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`Slack action requires '${field}'.`);
  }

  return value;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function classifyConnectionError(error: unknown): "not_connected" | "expired" | "error" {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("refresh-token-backed") || message.includes("connection is configured")) {
    return "not_connected";
  }
  if (message.includes("expired") || message.includes("invalid")) {
    return "expired";
  }
  return "error";
}
