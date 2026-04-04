import {
  DelegatedActionProvider,
  DelegatedActionMetadata,
} from "../../src/types";
import { exchangeProviderAccessToken } from "./tokenVault.service";
import {
  ProviderActionContext,
  ProviderActionOutcome,
  ProviderConnectionResult,
} from "../runtime.types";

const GITHUB_API = "https://api.github.com";

export const githubActionService = {
  provider: "github" as DelegatedActionProvider,

  async validateConnection(
    context: ProviderActionContext,
  ): Promise<ProviderConnectionResult> {
    if (!context.env.liveDelegatedActionMode || !context.env.liveGitHubActionMode) {
      return {
        provider: "github",
        status: "not_connected",
        source: "auth0_token_vault",
        logs: ["[GITHUB] Live GitHub delegated action mode is disabled."],
      };
    }

    try {
      const token = await exchangeProviderAccessToken({
        env: context.env,
        session: context.session,
        provider: "github",
      });

      const profile = await githubFetch<{
        login: string;
        name?: string;
      }>("/user", token.accessToken);

      return {
        provider: "github",
        status: "connected",
        source: "auth0_token_vault",
        accountIdentifier: profile.login || profile.name,
        connectedAt: Date.now(),
        logs: [...token.logs, `[GITHUB] Connected as ${profile.login}.`],
      };
    } catch (error) {
      return {
        provider: "github",
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
    if (!context.env.liveDelegatedActionMode || !context.env.liveGitHubActionMode) {
      return {
        mode: "fallback",
        status: "blocked",
        summary: "GitHub delegated execution is disabled in this environment.",
        logs: ["[GITHUB] Live GitHub delegated execution mode is disabled."],
      };
    }

    const token = await exchangeProviderAccessToken({
      env: context.env,
      session: context.session,
      provider: "github",
      loginHint: asOptionalString(context.metadata.accountIdentifier),
    });

    switch (actionKey) {
      case "github.read_repo_metadata":
        return readRepoMetadata(context.metadata, token.accessToken, token.logs);
      case "github.read_open_prs":
        return readOpenPullRequests(context.metadata, token.accessToken, token.logs);
      case "github.create_draft_issue":
        return createDraftIssue(context.metadata, token.accessToken, token.logs);
      case "github.comment_on_pr":
        return commentOnPullRequest(context.metadata, token.accessToken, token.logs);
      default:
        return {
          mode: "live",
          status: "failed",
          summary: `GitHub action '${actionKey}' is not implemented.`,
          logs: [...token.logs, `[GITHUB] Unsupported action '${actionKey}'.`],
        };
    }
  },
};

async function readRepoMetadata(
  metadata: DelegatedActionMetadata,
  accessToken: string,
  logs: string[],
): Promise<ProviderActionOutcome> {
  const { owner, repo } = resolveOwnerAndRepo(metadata);
  const repository = await githubFetch<{
    full_name: string;
    html_url: string;
    default_branch: string;
    open_issues_count: number;
    description?: string;
  }>(`/repos/${owner}/${repo}`, accessToken);

  return {
    mode: "live",
    status: "completed",
    summary: `Read GitHub metadata for ${repository.full_name}. Default branch is ${repository.default_branch}.`,
    logs: [...logs, `[GITHUB] Loaded repository metadata for ${repository.full_name}.`],
    externalRef: repository.full_name,
    externalUrl: repository.html_url,
    metadata: repository,
  };
}

async function readOpenPullRequests(
  metadata: DelegatedActionMetadata,
  accessToken: string,
  logs: string[],
): Promise<ProviderActionOutcome> {
  const { owner, repo } = resolveOwnerAndRepo(metadata);
  const pulls = await githubFetch<
    Array<{
      number: number;
      title: string;
      html_url: string;
      draft?: boolean;
      state: string;
    }>
  >(`/repos/${owner}/${repo}/pulls?state=open`, accessToken);

  return {
    mode: "live",
    status: "completed",
    summary: `Found ${pulls.length} open GitHub pull request${pulls.length === 1 ? "" : "s"} in ${owner}/${repo}.`,
    logs: [...logs, `[GITHUB] Loaded ${pulls.length} open pull requests for ${owner}/${repo}.`],
    externalRef: `${owner}/${repo}`,
    externalUrl: `https://github.com/${owner}/${repo}/pulls`,
    metadata: {
      pulls: pulls.slice(0, 10).map((pull) => ({
        number: pull.number,
        title: pull.title,
        draft: pull.draft ?? false,
        state: pull.state,
        url: pull.html_url,
      })),
    },
  };
}

async function createDraftIssue(
  metadata: DelegatedActionMetadata,
  accessToken: string,
  logs: string[],
): Promise<ProviderActionOutcome> {
  const { owner, repo } = resolveOwnerAndRepo(metadata);
  const title = requiredString(metadata.title, "title");
  const body = asOptionalString(metadata.body) ?? "";
  const labels = Array.isArray(metadata.labels)
    ? metadata.labels.map((label) => String(label))
    : [];

  const issue = await githubFetch<{
    number: number;
    html_url: string;
    title: string;
  }>(`/repos/${owner}/${repo}/issues`, accessToken, {
    method: "POST",
    body: JSON.stringify({
      title,
      body,
      labels,
    }),
  });

  return {
    mode: "live",
    status: "completed",
    summary: `Created GitHub draft issue #${issue.number} in ${owner}/${repo}.`,
    logs: [...logs, `[GITHUB] Created issue #${issue.number} in ${owner}/${repo}.`],
    externalRef: `${issue.number}`,
    externalUrl: issue.html_url,
    metadata: issue,
  };
}

async function commentOnPullRequest(
  metadata: DelegatedActionMetadata,
  accessToken: string,
  logs: string[],
): Promise<ProviderActionOutcome> {
  const { owner, repo } = resolveOwnerAndRepo(metadata);
  const issueNumber = Number(metadata.issueNumber ?? metadata.pullNumber);
  const body = requiredString(metadata.body, "body");

  if (!Number.isFinite(issueNumber)) {
    throw new Error("GitHub comment action requires issueNumber or pullNumber.");
  }

  const comment = await githubFetch<{
    id: number;
    html_url: string;
  }>(
    `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );

  return {
    mode: "live",
    status: "completed",
    summary: `Posted a GitHub review note on PR #${issueNumber} in ${owner}/${repo}.`,
    logs: [...logs, `[GITHUB] Posted issue comment ${comment.id} on ${owner}/${repo}#${issueNumber}.`],
    externalRef: `${comment.id}`,
    externalUrl: comment.html_url,
    metadata: comment,
  };
}

async function githubFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${details}`);
  }

  return (await response.json()) as T;
}

function resolveOwnerAndRepo(metadata: DelegatedActionMetadata): {
  owner: string;
  repo: string;
} {
  return {
    owner: requiredString(metadata.owner, "owner"),
    repo: requiredString(metadata.repo, "repo"),
  };
}

function requiredString(value: unknown, field: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`GitHub action requires '${field}'.`);
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
  if (message.includes("invalid") || message.includes("expired")) {
    return "expired";
  }
  return "error";
}
