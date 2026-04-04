import { db } from "../db";
import { DelegatedActionExecution } from "../../types";

export const delegatedActionExecutionService = {
  async getExecutions(): Promise<DelegatedActionExecution[]> {
    return (await db.delegatedActionExecutions.toArray()).sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  },

  async getExecutionsForTask(
    taskId: string,
  ): Promise<DelegatedActionExecution[]> {
    return (
      await db.delegatedActionExecutions.where("taskId").equals(taskId).toArray()
    ).sort((left, right) => right.updatedAt - left.updatedAt);
  },

  async replaceExecutions(
    executions: DelegatedActionExecution[],
  ): Promise<void> {
    await db.transaction("rw", db.delegatedActionExecutions, async () => {
      await db.delegatedActionExecutions.clear();
      if (executions.length > 0) {
        await db.delegatedActionExecutions.bulkPut(executions);
      }
    });
  },

  async upsertExecution(
    execution: DelegatedActionExecution,
  ): Promise<DelegatedActionExecution> {
    const record = {
      ...execution,
      updatedAt: Date.now(),
    };
    await db.delegatedActionExecutions.put(record);
    return record;
  },
};
