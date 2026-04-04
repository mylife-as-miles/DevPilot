import { DelegatedActionMetadata, DelegatedActionProvider } from "../../src/types";
import {
  ProviderActionContext,
  ProviderActionOutcome,
  ProviderConnectionResult,
} from "../runtime.types";

export const gitlabActionService = {
  provider: "gitlab" as DelegatedActionProvider,

  async validateConnection(
    context: ProviderActionContext,
  ): Promise<ProviderConnectionResult> {
    if (!context.env.liveDelegatedActionMode || !context.env.liveGitLabActionMode) {
      return {
        provider: "gitlab",
        status: "not_connected",
        source: "secure_backend_fallback",
        logs: ["[GITLAB] Live GitLab delegated action mode is disabled."],
      };
    }

    const token = context.env.serverTokens.gitlab;
    if (!token) {
      return {
        provider: "gitlab",
        status: "not_connected",
        source: "secure_backend_fallback",
        logs: ["[GITLAB] No server-side GitLab fallback token is configured."],
      };
    }

    try {
      const user = await gitlabFetch<{ username: string }>(
        context.env.gitlabUrl,
        "/api/v4/user",
        token,
      );
      return {
        provider: "gitlab",
        status: "connected",
        source: "secure_backend_fallback",
        accountIdentifier: user.username,
        connectedAt: Date.now(),
        logs: [`[GITLAB] Connected via secure backend fallback as ${user.username}.`],
      };
    } catch (error) {
      return {
        provider: "gitlab",
        status: "error",
        source: "secure_backend_fallback",
        logs: [error instanceof Error ? error.message : String(error)],
      };
    }
  },

  async executeAction(
    actionKey: string,
    context: ProviderActionContext,
  ): Promise<ProviderActionOutcome> {
    if (!context.env.liveDelegatedActionMode || !context.env.liveGitLabActionMode) {
      return {
        mode: "fallback",
        status: "blocked",
        summary: "GitLab delegated execution is disabled in this environment.",
        logs: ["[GITLAB] Live GitLab delegated execution mode is disabled."],
      };
    }

    const token = context.env.serverTokens.gitlab;
    if (!token) {
      return {
        mode: "fallback",
        status: "blocked",
        summary: "GitLab fallback execution is unavailable because no secure backend token is configured.",
        logs: ["[GITLAB] Missing GITLAB_SERVICE_TOKEN or VITE_GITLAB_TOKEN on the secure runtime."],
      };
    }

    switch (actionKey) {
      case "gitlab.read_repo_metadata":
        return readProjectMetadata(context, token);
      case "gitlab.read_open_prs":
        return readOpenMergeRequests(context, token);
      case "gitlab.create_draft_issue":
        return createDraftIssue(context, token);
      case "gitlab.comment_on_mr":
        return commentOnMergeRequest(context, token);
      case "gitlab.open_draft_pr":
        return openDraftMergeRequest(context, token);
      default:
        return {
          mode: "fallback",
          status: "failed",
          summary: `GitLab action '${actionKey}' is not implemented on the secure boundary.`,
          logs: [`[GITLAB] Unsupported action '${actionKey}'.`],
        };
    }
  },
};

async function readProjectMetadata(
  context: ProviderActionContext,
  token: string,
): Promise<ProviderActionOutcome> {
  const projectId = requiredString(context.metadata.projectId, "projectId");
  const project = await gitlabFetch<{
    id: number;
    name: string;
    path_with_namespace: string;
    web_url: string;
    default_branch: string;
  }>(context.env.gitlabUrl, `/api/v4/projects/${encodeURIComponent(projectId)}`, token);

  return {
    mode: "fallback",
    status: "completed",
    summary: `Read GitLab metadata for ${project.path_with_namespace}. Default branch is ${project.default_branch}.`,
    logs: [`[GITLAB] Loaded project metadata for ${project.path_with_namespace}.`],
    externalRef: String(project.id),
    externalUrl: project.web_url,
    metadata: project,
  };
}

async function readOpenMergeRequests(
  context: ProviderActionContext,
  token: string,
): Promise<ProviderActionOutcome> {
  const projectId = requiredString(context.metadata.projectId, "projectId");
  const mergeRequests = await gitlabFetch<
    Array<{ iid: number; title: string; web_url: string; draft: boolean }>
  >(
    context.env.gitlabUrl,
    `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests?state=opened`,
    token,
  );

  return {
    mode: "fallback",
    status: "completed",
    summary: `Found ${mergeRequests.length} open GitLab merge request${mergeRequests.length === 1 ? "" : "s"}.`,
    logs: [`[GITLAB] Loaded ${mergeRequests.length} open merge requests for project ${projectId}.`],
    externalRef: projectId,
    metadata: {
      mergeRequests: mergeRequests.slice(0, 10),
    },
  };
}

async function createDraftIssue(
  context: ProviderActionContext,
  token: string,
): Promise<ProviderActionOutcome> {
  const projectId = requiredString(context.metadata.projectId, "projectId");
  const title = requiredString(context.metadata.title, "title");
  const description = asOptionalString(context.metadata.description) ?? "";

  const issue = await gitlabFetch<{
    iid: number;
    web_url: string;
    title: string;
  }>(
    context.env.gitlabUrl,
    `/api/v4/projects/${encodeURIComponent(projectId)}/issues`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
      }),
    },
  );

  return {
    mode: "fallback",
    status: "completed",
    summary: `Created GitLab draft issue #${issue.iid}.`,
    logs: [`[GITLAB] Created issue #${issue.iid} in project ${projectId}.`],
    externalRef: String(issue.iid),
    externalUrl: issue.web_url,
    metadata: issue,
  };
}

async function commentOnMergeRequest(
  context: ProviderActionContext,
  token: string,
): Promise<ProviderActionOutcome> {
  const projectId = requiredString(context.metadata.projectId, "projectId");
  const mergeRequestIid = requiredString(
    context.metadata.mergeRequestIid,
    "mergeRequestIid",
  );
  const body = requiredString(context.metadata.body, "body");

  const note = await gitlabFetch<{
    id: number;
    resolvable: boolean;
  }>(
    context.env.gitlabUrl,
    `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests/${encodeURIComponent(mergeRequestIid)}/notes`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );

  return {
    mode: "fallback",
    status: "completed",
    summary: `Posted a review note on GitLab MR !${mergeRequestIid}.`,
    logs: [`[GITLAB] Posted note ${note.id} on MR !${mergeRequestIid}.`],
    externalRef: String(note.id),
    metadata: note,
  };
}

async function openDraftMergeRequest(
  context: ProviderActionContext,
  token: string,
): Promise<ProviderActionOutcome> {
  const projectId = requiredString(context.metadata.projectId, "projectId");
  const sourceBranch = requiredString(context.metadata.sourceBranch, "sourceBranch");
  const targetBranch = requiredString(context.metadata.targetBranch, "targetBranch");
  const title = normalizeDraftTitle(requiredString(context.metadata.title, "title"));
  const description = asOptionalString(context.metadata.description) ?? "";
  const removeSourceBranch = context.metadata.removeSourceBranch === true;

  const mergeRequest = await gitlabFetch<{
    iid: number;
    web_url: string;
    title: string;
    source_branch: string;
    target_branch: string;
  }>(
    context.env.gitlabUrl,
    `/api/v4/projects/${encodeURIComponent(projectId)}/merge_requests`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title,
        description,
        remove_source_branch: removeSourceBranch,
      }),
    },
  );

  return {
    mode: "fallback",
    status: "completed",
    summary: `Created draft GitLab merge request !${mergeRequest.iid} for ${sourceBranch} to ${targetBranch}.`,
    logs: [
      `[GITLAB] Created draft merge request !${mergeRequest.iid} for ${sourceBranch} -> ${targetBranch}.`,
    ],
    externalRef: String(mergeRequest.iid),
    externalUrl: mergeRequest.web_url,
    metadata: {
      iid: mergeRequest.iid,
      title: mergeRequest.title,
      webUrl: mergeRequest.web_url,
      sourceBranch: mergeRequest.source_branch,
      targetBranch: mergeRequest.target_branch,
    },
  };
}

async function gitlabFetch<T>(
  gitlabUrl: string,
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${gitlabUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": token,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitLab API request failed (${response.status}): ${details}`);
  }

  return (await response.json()) as T;
}

function requiredString(value: unknown, field: string): string {
  if (!value) {
    throw new Error(`GitLab action requires '${field}'.`);
  }

  return String(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeDraftTitle(title: string): string {
  return /^draft:/i.test(title) ? title : `Draft: ${title}`;
}
