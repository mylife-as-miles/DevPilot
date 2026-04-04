import { secureActionAdapter } from "../adapters/secureAction.adapter";
import {
  delegatedActionExecutionService,
  integrationPermissionsService,
  pendingApprovalService,
  pendingDelegatedActionService,
  stepUpRequirementService,
} from ".";
import {
  appendApprovalTransitionTimeline,
  appendSecureActionExecutionTimeline,
  appendSecureActionPreparedTimeline,
  appendStepUpTransitionTimeline,
} from "../workflows/asyncApproval.workflow";
import {
  ApprovalRequestTransitionResult,
  DelegatedActionPreviewInput,
  PendingDelegatedAction,
  PendingDelegatedActionUpdate,
  SecureActionExecutionResult,
  SecureRuntimeSnapshot,
  StepUpRequirementTransitionResult,
} from "../../types";

export const secureActionService = {
  async refreshRuntimeSnapshot(): Promise<SecureRuntimeSnapshot> {
    const snapshot = await secureActionAdapter.getRuntimeSnapshot();
    await integrationPermissionsService.hydrateRuntimeSnapshot(snapshot);
    await pendingDelegatedActionService.replacePendingActions(snapshot.pendingActions);
    await delegatedActionExecutionService.replaceExecutions(snapshot.executions);
    await pendingApprovalService.replaceApprovalRequests(snapshot.approvalRequests);
    await stepUpRequirementService.replaceStepUpRequirements(
      snapshot.stepUpRequirements,
    );
    return snapshot;
  },

  async previewDelegatedAction(
    input: DelegatedActionPreviewInput,
  ): Promise<PendingDelegatedAction> {
    const pendingAction = await secureActionAdapter.previewDelegatedAction(input);
    const snapshot = await this.refreshRuntimeSnapshot();
    const approvalRequest = pendingAction.approvalRequestId
      ? snapshot.approvalRequests.find(
          (request) => request.id === pendingAction.approvalRequestId,
        )
      : undefined;
    const stepUpRequirement = pendingAction.stepUpRequirementId
      ? snapshot.stepUpRequirements.find(
          (requirement) => requirement.id === pendingAction.stepUpRequirementId,
        )
      : undefined;

    await appendSecureActionPreparedTimeline({
      pendingAction,
      approvalRequest,
      stepUpRequirement,
    });

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

  async approveApprovalRequest(
    id: string,
  ): Promise<ApprovalRequestTransitionResult> {
    const result = await secureActionAdapter.approveApprovalRequest(id);
    await this.refreshRuntimeSnapshot();
    await appendApprovalTransitionTimeline(result);
    return result;
  },

  async rejectApprovalRequest(
    id: string,
  ): Promise<ApprovalRequestTransitionResult> {
    const result = await secureActionAdapter.rejectApprovalRequest(id);
    await this.refreshRuntimeSnapshot();
    await appendApprovalTransitionTimeline(result);
    return result;
  },

  async startStepUpRequirement(
    id: string,
  ): Promise<StepUpRequirementTransitionResult> {
    const result = await secureActionAdapter.startStepUpRequirement(id);
    await this.refreshRuntimeSnapshot();
    await appendStepUpTransitionTimeline(result);
    return result;
  },

  async completeStepUpRequirement(
    id: string,
  ): Promise<StepUpRequirementTransitionResult> {
    const result = await secureActionAdapter.completeStepUpRequirement(id);
    await this.refreshRuntimeSnapshot();
    await appendStepUpTransitionTimeline(result);
    return result;
  },

  async executePendingAction(
    id: string,
  ): Promise<SecureActionExecutionResult> {
    const result = await secureActionAdapter.executePendingAction(id);
    await this.refreshRuntimeSnapshot();
    await appendSecureActionExecutionTimeline(result);
    return result;
  },
};
