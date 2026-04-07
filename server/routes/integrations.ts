import express, { Request, Response } from "express";
import { buildRuntimeSnapshot } from "../services/integrationStatus.service";
import { getRuntimeActionState } from "../services/delegatedAction.service";
import { RuntimeEnv, RuntimeSessionRecord } from "../runtime.types";

export function createIntegrationsRouter(options: {
  env: RuntimeEnv;
  getSession: (request: Request, response: Response) => RuntimeSessionRecord;
}): express.Router {
  const router = express.Router();

  router.get("/api/secure-runtime/health", (_request, response) => {
    response.json({
      data: {
        ok: true,
        liveAuthMode: options.env.liveAuthMode,
        liveDelegatedActionMode: options.env.liveDelegatedActionMode,
        auth0Configured: Boolean(
          options.env.auth0Domain &&
            options.env.auth0ClientId &&
            options.env.auth0ClientSecret,
        ),
      },
    });
  });

  router.get("/api/secure-runtime/snapshot", async (request, response) => {
    const session = options.getSession(request, response);
    const runtimeState = getRuntimeActionState(session.id);
    const snapshot = await buildRuntimeSnapshot({
      env: options.env,
      session,
      pendingActions: runtimeState.pendingActions,
      executions: runtimeState.executions,
      approvalRequests: runtimeState.approvalRequests,
      stepUpRequirements: runtimeState.stepUpRequirements,
    });
    response.json({ data: snapshot });
  });

  router.get("/api/integrations/status", async (request, response) => {
    const session = options.getSession(request, response);
    const runtimeState = getRuntimeActionState(session.id);
    const snapshot = await buildRuntimeSnapshot({
      env: options.env,
      session,
      pendingActions: runtimeState.pendingActions,
      executions: runtimeState.executions,
      approvalRequests: runtimeState.approvalRequests,
      stepUpRequirements: runtimeState.stepUpRequirements,
    });
    response.json({
      data: {
        integrations: snapshot.integrations,
        warnings: snapshot.warnings,
      },
    });
  });

  router.get("/api/slack/channels", async (request, response) => {
    const session = options.getSession(request, response);
    try {
      // Re-using the existing slackActionService functionality
      const { slackActionService } = await import("../services/slackAction.service");
      const outcome = await slackActionService.executeAction(
        "slack.read_channel_metadata",
        {
          env: options.env,
          session,
          metadata: {},
        },
      );
      response.json({ data: outcome.metadata?.channels || [] });
    } catch (error) {
      response.status(400).json({
        error:
          error instanceof Error ? error.message : "Failed to fetch Slack channels",
      });
    }
  });

  return router;
}
