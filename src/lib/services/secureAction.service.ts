import { secureActionAdapter } from "../adapters/secureAction.adapter";
import {
  delegatedActionExecutionService,
  integrationPermissionsService,
  pendingDelegatedActionService,
  taskService,
} from ".";
import {
  DelegatedActionExecution,
  DelegatedActionPreviewInput,
  PendingDelegatedAction,
  PendingDelegatedActionUpdate,
  SecureActionExecutionResult,
  SecureRuntimeSnapshot,
} from "../../types";

export const secureActionService = {
  async refreshRuntimeSnapshot(): Promise<SecureRuntimeSnapshot> {
    const snapshot = await secureActionAdapter.getRuntimeSnapshot();
    await integrationPermissionsService.hydrateRuntimeSnapshot(snapshot);
    await pendingDelegatedActionService.replacePendingActions(snapshot.pendingActions);
    await delegatedActionExecutionService.replaceExecutions(snapshot.executions);
    return snapshot;
  },

  async previewDelegatedAction(
    input: DelegatedActionPreviewInput,
  ): Promise<PendingDelegatedAction> {
    const pendingAction = await secureActionAdapter.previewDelegatedAction(input);
    await pendingDelegatedActionService.upsertPendingAction(pendingAction);

    if (pendingAction.taskId) {
      await taskService.appendAgentMessage({
        taskId: pendingAction.taskId,
        sender: "system",
        content:
          pendingAction.approvalStatus === "pending"
            ? `Queued delegated action for approval: ${pendingAction.title}.`
            : `Prepared delegated action: ${pendingAction.title}.`,
        kind: pendingAction.approvalStatus === "pending" ? "warning" : "info",
        timestamp: Date.now(),
      });
    }

    return pendingAction;
  },

  async updatePendingAction(
    id: string,
    updates: PendingDelegatedActionUpdate,
  ): Promise<PendingDelegatedAction> {
    const pendingAction = await secureActionAdapter.updatePendingAction(id, updates);
    await pendingDelegatedActionService.upsertPendingAction(pendingAction);
    return pendingAction;
  },

  async executePendingAction(
    id: string,
  ): Promise<SecureActionExecutionResult> {
    const result = await secureActionAdapter.executePendingAction(id);
    await delegatedActionExecutionService.upsertExecution(result.execution);

    if (result.pendingAction) {
      await pendingDelegatedActionService.upsertPendingAction(result.pendingAction);
    } else {
      await pendingDelegatedActionService.removePendingAction(id);
    }

    if (result.execution.taskId) {
      await appendExecutionMessage(result.execution);
    }

    return result;
  },
};

async function appendExecutionMessage(
  execution: DelegatedActionExecution,
): Promise<void> {
  await taskService.appendAgentMessage({
    taskId: execution.taskId!,
    sender: "system",
    content: `[${execution.provider.toUpperCase()}] ${execution.summary}`,
    kind: execution.status === "completed" ? "success" : "warning",
    timestamp: Date.now(),
  });
}
