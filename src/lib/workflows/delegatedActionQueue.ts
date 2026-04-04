import {
  DelegatedActionPreviewInput,
  PendingDelegatedAction,
  SecureActionExecutionResult,
} from "../../types";
import { secureActionService, taskService } from "../services";

export async function queueWorkflowDelegatedAction(
  taskId: string,
  input: Omit<DelegatedActionPreviewInput, "taskId"> &
    Partial<Pick<DelegatedActionPreviewInput, "taskId">>,
  options?: { executeImmediatelyWhenSafe?: boolean },
): Promise<PendingDelegatedAction | SecureActionExecutionResult | null> {
  try {
    const pendingAction = await secureActionService.previewDelegatedAction({
      ...input,
      taskId: input.taskId ?? taskId,
    });

    if (
      options?.executeImmediatelyWhenSafe &&
      pendingAction.approvalStatus === "not_required" &&
      pendingAction.stepUpStatus === "not_required"
    ) {
      return await secureActionService.executePendingAction(pendingAction.id);
    }

    return pendingAction;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await taskService.appendAgentMessage({
      taskId,
      sender: "system",
      content: `Delegated action queue failed: ${message}`,
      kind: "warning",
      timestamp: Date.now(),
    });
    return null;
  }
}
