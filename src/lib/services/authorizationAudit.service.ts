import { db } from "../db";
import { AuthorizationAuditEvent } from "../../types";

export const authorizationAuditService = {
  async getAuditEvents(): Promise<AuthorizationAuditEvent[]> {
    return (await db.authorizationAuditEvents.toArray()).sort(
      (left, right) => right.createdAt - left.createdAt,
    );
  },

  async getAuditEventsForTask(taskId: string): Promise<AuthorizationAuditEvent[]> {
    return (
      await db.authorizationAuditEvents.where("taskId").equals(taskId).toArray()
    ).sort((left, right) => right.createdAt - left.createdAt);
  },

  async replaceAuditEvents(events: AuthorizationAuditEvent[]): Promise<void> {
    await db.transaction("rw", db.authorizationAuditEvents, async () => {
      await db.authorizationAuditEvents.clear();
      if (events.length > 0) {
        await db.authorizationAuditEvents.bulkPut(events);
      }
    });
  },

  async upsertAuditEvent(event: AuthorizationAuditEvent): Promise<AuthorizationAuditEvent> {
    await db.authorizationAuditEvents.put(event);
    return event;
  },
};
