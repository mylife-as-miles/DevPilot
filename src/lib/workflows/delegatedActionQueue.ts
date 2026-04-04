import { DelegatedActionPreviewInput, PendingDelegatedAction } from "../../types";
import { secureActionService, taskService } from "../services";

export async function queueWorkflowDelegatedAction(
  taskId: string,
  input: Omit<DelegatedActionPreviewInput, "taskId"> &
    Partial<Pick<DelegatedActionPreviewInput, "taskId">>,
): Promise<PendingDelegatedAction | null> {
  try {
    return await secureActionService.previewDelegatedAction({
      ...input,
      taskId: input.taskId ?? taskId,
    });
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
