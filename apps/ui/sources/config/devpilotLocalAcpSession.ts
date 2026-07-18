import * as React from 'react';

import {
    getDesktopClient,
    type AcpUpdate,
    type DevPilotProject,
    type DevPilotTask,
    type DevPilotTaskMessage,
    type DevPilotWorkspace,
} from '@devpilot/desktop/client';

import { storage } from '@/sync/domains/state/storage';
import type { Metadata, Session } from '@/sync/domains/state/storageTypes';
import type { NormalizedMessage } from '@/sync/typesRaw';

import type { DevPilotLocalSession } from './devpilotLocalSession';

export const DEVPILOT_LOCAL_SERVER_ID = 'local-devpilot';
export const DEVPILOT_LOCAL_MACHINE_ID = 'local-devpilot';

export type DevPilotLocalAcpSessionMarker = Readonly<{
    v: 1;
    taskId?: string;
    projectPath: string;
    acpPid: number | null;
    acpSessionId: string | null;
    connectedAt: number;
}>;

type MutableSessionPatch = Partial<Pick<
    Session,
    | 'updatedAt'
    | 'meaningfulActivityAt'
    | 'activeAt'
    | 'thinking'
    | 'thinkingAt'
    | 'latestTurnId'
    | 'latestTurnStatus'
    | 'latestTurnStatusObservedAt'
    | 'lastRuntimeIssue'
>>;

function normalizeId(value: unknown): string {
    return String(value ?? '').trim();
}

function projectName(projectPath: string): string {
    const name = projectPath.split(/[\\/]/).filter(Boolean).pop();
    return name && name.trim() ? name.trim() : 'Local project';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCurrentTranscriptSeq(sessionId: string): number {
    const session = storage.getState().sessions[sessionId] ?? null;
    return typeof session?.seq === 'number' && Number.isFinite(session.seq)
        ? Math.trunc(session.seq)
        : 0;
}

function updateLocalAcpSession(sessionId: string, patch: MutableSessionPatch): void {
    const session = storage.getState().sessions[sessionId];
    if (!session) return;
    storage.getState().applySessions([{
        ...session,
        ...patch,
    }]);
}

function appendMessages(sessionId: string, messages: readonly NormalizedMessage[]): void {
    if (messages.length === 0) return;
    storage.getState().applyMessages(sessionId, [...messages]);
}

function createUserMessage(sessionId: string, text: string, createdAt: number, seq: number): NormalizedMessage {
    const id = `${sessionId}:user:${seq}`;
    return {
        id,
        seq,
        localId: id,
        createdAt,
        role: 'user',
        content: { type: 'text', text },
        isSidechain: false,
        meta: {
            permissionMode: storage.getState().sessions[sessionId]?.permissionMode ?? 'default',
        } as NormalizedMessage['meta'],
    };
}

function createAgentTextMessage(
    sessionId: string,
    text: string,
    createdAt: number,
    seq: number,
    kind: 'message' | 'thinking' = 'message',
): NormalizedMessage {
    const id = `${sessionId}:agent:${seq}`;
    return {
        id,
        seq,
        localId: null,
        createdAt,
        role: 'agent',
        content: kind === 'thinking'
            ? [{
                type: 'thinking',
                thinking: text,
                uuid: id,
                parentUUID: null,
            }]
            : [{
                type: 'text',
                text,
                uuid: id,
                parentUUID: null,
            }],
        isSidechain: false,
        meta: {
            devpilotLocalAcp: true,
        } as NormalizedMessage['meta'],
    };
}

function textFromAcpUpdate(update: AcpUpdate): { text: string; kind: 'message' | 'thinking' } | null {
    const candidate = update.update;
    const content = isRecord(candidate?.content) ? candidate.content : null;
    const meta = isRecord(candidate?._meta) ? candidate._meta : null;
    const devpilotMeta = isRecord(meta?.devpilot) ? meta.devpilot : null;
    const metaType = normalizeId(devpilotMeta?.type);
    const rawText = typeof content?.text === 'string'
        ? content.text
        : (() => {
            const rawCandidate: unknown = candidate;
            return isRecord(rawCandidate) && typeof rawCandidate.text === 'string'
                ? rawCandidate.text
                : '';
        })();
    const text = rawText.trim();
    if (!text) return null;
    return {
        text,
        kind: metaType === 'thought' || metaType === 'thinking' ? 'thinking' : 'message',
    };
}

export function readDevPilotLocalAcpMarker(metadata: Metadata | null | undefined): DevPilotLocalAcpSessionMarker | null {
    const marker = isRecord(metadata) ? metadata.devpilotLocalAcpSessionV1 : null;
    if (!isRecord(marker)) return null;
    if (marker.v !== 1) return null;
    const projectPath = normalizeId(marker.projectPath);
    const taskId = normalizeId(marker.taskId);
    const acpSessionId = normalizeId(marker.acpSessionId) || null;
    const acpPid = typeof marker.acpPid === 'number' && Number.isFinite(marker.acpPid)
        ? Math.trunc(marker.acpPid)
        : null;
    const connectedAt = typeof marker.connectedAt === 'number' && Number.isFinite(marker.connectedAt)
        ? marker.connectedAt
        : null;
    if (!projectPath || connectedAt === null || (!taskId && !acpSessionId)) return null;
    return {
        v: 1,
        ...(taskId ? { taskId } : {}),
        projectPath,
        acpSessionId,
        acpPid,
        connectedAt,
    };
}

export function isDevPilotLocalAcpSession(session: Session | null | undefined): boolean {
    return Boolean(readDevPilotLocalAcpMarker(session?.metadata));
}

export function isDevPilotLocalAcpRoute(sessionId: string, localSession: DevPilotLocalSession | null): boolean {
    const session = storage.getState().sessions[sessionId] ?? null;
    if (isDevPilotLocalAcpSession(session)) return true;
    const localAcpSessionId = normalizeId(localSession?.acpSessionId);
    return Boolean(localAcpSessionId && normalizeId(sessionId) === localAcpSessionId);
}

export function ensureDevPilotLocalAcpSessionSeeded(localSession: DevPilotLocalSession | null): string | null {
    const acpSessionId = normalizeId(localSession?.acpSessionId);
    const projectPath = normalizeId(localSession?.projectPath);
    if (!localSession || !acpSessionId || !projectPath) return null;

    const now = Date.now();
    const existing = storage.getState().sessions[acpSessionId] ?? null;
    const existingMarker = readDevPilotLocalAcpMarker(existing?.metadata);
    if (
        existing
        && existing.serverId === DEVPILOT_LOCAL_SERVER_ID
        && existingMarker?.projectPath === projectPath
        && existingMarker.acpSessionId === acpSessionId
        && existingMarker.acpPid === localSession.acpPid
        && existingMarker.connectedAt === localSession.connectedAt
    ) {
        return acpSessionId;
    }

    const createdAt = typeof existing?.createdAt === 'number' && Number.isFinite(existing.createdAt)
        ? existing.createdAt
        : localSession.connectedAt;
    const metadata: Metadata = {
        ...(existing?.metadata ?? {}),
        name: projectName(projectPath),
        path: projectPath,
        host: 'Local ACP',
        machineId: DEVPILOT_LOCAL_MACHINE_ID,
        flavor: 'codex',
        codexBackendMode: 'acp',
        codexSessionId: acpSessionId,
        directSessionV1: { v: 1, providerId: 'devpilot' },
        devpilotLocalAcpSessionV1: {
            v: 1,
            projectPath,
            acpSessionId,
            acpPid: localSession.acpPid,
            connectedAt: localSession.connectedAt,
        },
        summary: {
            text: `DevPilot session: ${projectName(projectPath)}`,
            updatedAt: now,
        },
    } as Metadata;

    const session: Session = {
        id: acpSessionId,
        serverId: DEVPILOT_LOCAL_SERVER_ID,
        seq: existing?.seq ?? 0,
        encryptionMode: 'plain',
        createdAt,
        updatedAt: existing?.updatedAt ?? now,
        meaningfulActivityAt: existing?.meaningfulActivityAt ?? createdAt,
        active: true,
        activeAt: existing?.activeAt ?? now,
        archivedAt: null,
        pendingVersion: 0,
        pendingCount: 0,
        latestTurnId: existing?.latestTurnId ?? null,
        latestTurnStatus: existing?.latestTurnStatus ?? 'completed',
        latestTurnStatusObservedAt: existing?.latestTurnStatusObservedAt ?? createdAt,
        latestReadyEventSeq: existing?.latestReadyEventSeq ?? null,
        latestReadyEventAt: existing?.latestReadyEventAt ?? null,
        metadata,
        metadataVersion: existing?.metadataVersion ?? 1,
        agentState: existing?.agentState ?? null,
        agentStateVersion: existing?.agentStateVersion ?? 0,
        thinking: existing?.thinking ?? false,
        thinkingAt: existing?.thinkingAt ?? 0,
        presence: 'online',
        optimisticThinkingAt: existing?.optimisticThinkingAt ?? null,
        thinkingGraceUntil: existing?.thinkingGraceUntil ?? null,
        permissionMode: existing?.permissionMode ?? 'default',
        permissionModeUpdatedAt: existing?.permissionModeUpdatedAt ?? null,
        modelMode: existing?.modelMode ?? 'default',
        modelModeUpdatedAt: existing?.modelModeUpdatedAt ?? null,
        latestUsage: existing?.latestUsage ?? null,
        canApprovePermissions: true,
        accessLevel: 'admin',
    };

    storage.getState().applySessions([session]);
    storage.getState().applyMessagesLoaded(acpSessionId);
    return acpSessionId;
}

function latestTurnStatusForTask(status: DevPilotTask['status']): Session['latestTurnStatus'] {
    if (status === 'starting' || status === 'running') return 'in_progress';
    if (status === 'cancelled') return 'cancelled';
    if (status === 'failed') return 'failed';
    return 'completed';
}

function createStoredTaskMessage(
    sessionId: string,
    message: DevPilotTaskMessage,
    seq: number,
): NormalizedMessage {
    const built = message.role === 'user'
        ? createUserMessage(sessionId, message.text, message.createdAt, seq)
        : createAgentTextMessage(sessionId, message.text, message.createdAt, seq, message.kind);
    return {
        ...built,
        id: message.id,
        localId: message.role === 'user' ? message.id : null,
    };
}

export function ensureDevPilotLocalTaskSessionSeeded(
    project: DevPilotProject,
    task: DevPilotTask,
): string {
    const sessionId = task.id;
    const now = Date.now();
    const existing = storage.getState().sessions[sessionId] ?? null;
    const marker: DevPilotLocalAcpSessionMarker = {
        v: 1,
        taskId: task.id,
        projectPath: project.path,
        acpPid: null,
        acpSessionId: task.acpSessionId,
        connectedAt: task.createdAt,
    };
    const metadata: Metadata = {
        ...(existing?.metadata ?? {}),
        name: task.title,
        path: project.path,
        host: 'Local ACP',
        machineId: DEVPILOT_LOCAL_MACHINE_ID,
        flavor: 'codex',
        codexBackendMode: 'acp',
        codexSessionId: task.acpSessionId ?? task.id,
        directSessionV1: { v: 1, providerId: 'devpilot' },
        devpilotLocalAcpSessionV1: marker,
        summary: {
            text: task.title,
            updatedAt: task.updatedAt || now,
        },
    } as Metadata;
    const latestTurnStatus = latestTurnStatusForTask(task.status);
    const session: Session = {
        id: sessionId,
        serverId: DEVPILOT_LOCAL_SERVER_ID,
        seq: existing?.seq ?? 0,
        encryptionMode: 'plain',
        createdAt: existing?.createdAt ?? task.createdAt,
        updatedAt: task.updatedAt,
        meaningfulActivityAt: task.updatedAt,
        active: true,
        activeAt: task.updatedAt,
        archivedAt: null,
        pendingVersion: 0,
        pendingCount: 0,
        latestTurnId: existing?.latestTurnId ?? null,
        latestTurnStatus,
        latestTurnStatusObservedAt: task.updatedAt,
        latestReadyEventSeq: existing?.latestReadyEventSeq ?? null,
        latestReadyEventAt: existing?.latestReadyEventAt ?? null,
        metadata,
        metadataVersion: existing?.metadataVersion ?? 1,
        agentState: existing?.agentState ?? null,
        agentStateVersion: existing?.agentStateVersion ?? 0,
        thinking: task.status === 'starting' || task.status === 'running',
        thinkingAt: task.status === 'starting' || task.status === 'running' ? task.updatedAt : 0,
        presence: 'online',
        optimisticThinkingAt: existing?.optimisticThinkingAt ?? null,
        thinkingGraceUntil: existing?.thinkingGraceUntil ?? null,
        permissionMode: existing?.permissionMode ?? 'default',
        permissionModeUpdatedAt: existing?.permissionModeUpdatedAt ?? null,
        modelMode: task.model,
        modelModeUpdatedAt: task.updatedAt,
        latestUsage: existing?.latestUsage ?? null,
        canApprovePermissions: true,
        accessLevel: 'admin',
    };

    storage.getState().applySessions([session]);
    appendMessages(sessionId, task.messages.map((message, index) => createStoredTaskMessage(sessionId, message, index + 1)));
    storage.getState().applyMessagesLoaded(sessionId);
    return sessionId;
}

export function seedDevPilotLocalWorkspace(workspace: DevPilotWorkspace): void {
    for (const project of workspace.projects) {
        for (const task of project.tasks) {
            ensureDevPilotLocalTaskSessionSeeded(project, task);
        }
    }
}

export function useDevPilotLocalWorkspaceBridge(enabled: boolean): void {
    React.useEffect(() => {
        if (!enabled) return undefined;
        const desktop = getDesktopClient();
        if (!desktop) return undefined;
        let active = true;
        const seed = (workspace: DevPilotWorkspace) => {
            if (active) seedDevPilotLocalWorkspace(workspace);
        };
        void desktop.getWorkspace().then(seed).catch(() => {
            // The desktop boundary will surface runtime errors when the user starts a task.
        });
        const removeWorkspaceListener = desktop.onWorkspaceChanged(seed);
        return () => {
            active = false;
            removeWorkspaceListener();
        };
    }, [enabled]);
}

export function handleDevPilotLocalAcpUpdate(update: AcpUpdate, localSession: DevPilotLocalSession | null): void {
    const acpSessionId = ensureDevPilotLocalAcpSessionSeeded(localSession);
    if (!acpSessionId) return;
    if (update.sessionId && update.sessionId !== acpSessionId) return;
    const meta = isRecord(update.update?._meta) && isRecord(update.update?._meta?.devpilot)
        ? update.update?._meta?.devpilot
        : null;
    const runtimeState = normalizeId(meta?.state);
    if (runtimeState) {
        const now = Date.now();
        const latestTurnStatus = runtimeState === 'cancelled'
            ? 'cancelled'
            : runtimeState === 'completed'
                ? 'completed'
                : runtimeState === 'failed'
                    ? 'failed'
                    : 'in_progress';
        updateLocalAcpSession(acpSessionId, {
            updatedAt: now,
            activeAt: now,
            thinking: runtimeState === 'starting' || runtimeState === 'running' || runtimeState === 'cancelling',
            thinkingAt: runtimeState === 'starting' || runtimeState === 'running' || runtimeState === 'cancelling' ? now : 0,
            latestTurnStatus,
            latestTurnStatusObservedAt: now,
        });
        return;
    }
    const payload = textFromAcpUpdate(update);
    if (!payload) return;

    const now = Date.now();
    appendMessages(acpSessionId, [
        createAgentTextMessage(acpSessionId, payload.text, now, getCurrentTranscriptSeq(acpSessionId) + 1, payload.kind),
    ]);
    updateLocalAcpSession(acpSessionId, {
        updatedAt: now,
        meaningfulActivityAt: now,
        activeAt: now,
        thinking: payload.kind === 'thinking',
        thinkingAt: payload.kind === 'thinking' ? now : 0,
        latestTurnStatus: payload.kind === 'thinking' ? 'in_progress' : 'completed',
        latestTurnStatusObservedAt: now,
    });
}

export function useDevPilotLocalAcpSessionBridge(localSession: DevPilotLocalSession | null): void {
    React.useEffect(() => {
        ensureDevPilotLocalAcpSessionSeeded(localSession);
    }, [
        localSession?.acpPid,
        localSession?.acpSessionId,
        localSession?.connectedAt,
        localSession?.projectPath,
    ]);

    React.useEffect(() => {
        const desktop = getDesktopClient();
        if (!desktop || !localSession?.acpSessionId) return undefined;
        return desktop.onAcpUpdate((update) => handleDevPilotLocalAcpUpdate(update, localSession));
    }, [
        localSession?.acpPid,
        localSession?.acpSessionId,
        localSession?.connectedAt,
        localSession?.projectPath,
    ]);
}

export async function submitDevPilotLocalAcpPrompt(sessionId: string, text: string): Promise<void> {
    const desktop = getDesktopClient();
    if (!desktop) throw new Error('Open DevPilot in the desktop shell to use local ACP.');
    const session = storage.getState().sessions[sessionId] ?? null;
    const marker = readDevPilotLocalAcpMarker(session?.metadata);
    if (!marker) throw new Error('This session is not connected to local DevPilot ACP.');

    if (marker.taskId) {
        const workspace = await desktop.sendTaskPrompt(marker.taskId, text);
        seedDevPilotLocalWorkspace(workspace);
        return;
    }

    if (!marker.acpSessionId) throw new Error('This local DevPilot session is no longer connected.');

    const preflight = await desktop.preflight(marker.projectPath);
    const failures = preflight.checks.filter((check) => check.status === 'fail');
    if (failures.length > 0) {
        throw new Error(failures.map((check) => {
            const remediation = check.remediation ? ` ${check.remediation}` : '';
            return `${check.message}${remediation}`;
        }).join('\n'));
    }

    const now = Date.now();
    const baseSeq = getCurrentTranscriptSeq(sessionId) + 1;
    appendMessages(sessionId, [
        createUserMessage(sessionId, text, now, baseSeq),
        createAgentTextMessage(
            sessionId,
            'DevPilot is working locally through ACP.',
            now + 1,
            baseSeq + 1,
            'thinking',
        ),
    ]);
    updateLocalAcpSession(sessionId, {
        updatedAt: now,
        meaningfulActivityAt: now,
        activeAt: now,
        thinking: true,
        thinkingAt: now,
        latestTurnId: `${sessionId}:turn:${now}`,
        latestTurnStatus: 'in_progress',
        latestTurnStatusObservedAt: now,
        lastRuntimeIssue: null,
    });

    try {
        await desktop.startAcpPrompt(marker.acpSessionId, text);
        const doneAt = Date.now();
        updateLocalAcpSession(sessionId, {
            updatedAt: doneAt,
            meaningfulActivityAt: doneAt,
            activeAt: doneAt,
            thinking: false,
            thinkingAt: 0,
            latestTurnStatus: 'completed',
            latestTurnStatusObservedAt: doneAt,
            lastRuntimeIssue: null,
        });
    } catch (caught) {
        const failedAt = Date.now();
        const message = caught instanceof Error ? caught.message : 'DevPilot ACP prompt failed.';
        appendMessages(sessionId, [
            createAgentTextMessage(
                sessionId,
                message,
                failedAt,
                getCurrentTranscriptSeq(sessionId) + 1,
                'message',
            ),
        ]);
        updateLocalAcpSession(sessionId, {
            updatedAt: failedAt,
            meaningfulActivityAt: failedAt,
            activeAt: failedAt,
            thinking: false,
            thinkingAt: 0,
            latestTurnStatus: 'failed',
            latestTurnStatusObservedAt: failedAt,
            lastRuntimeIssue: {
                v: 1,
                scope: 'primary_session',
                status: 'failed',
                code: 'devpilot_local_acp_prompt_failed',
                source: 'unknown',
                occurredAt: failedAt,
                sanitizedPreview: message,
            } as Session['lastRuntimeIssue'],
        });
        throw caught;
    }
}

export async function abortDevPilotLocalAcpSession(sessionId: string): Promise<void> {
    const now = Date.now();
    updateLocalAcpSession(sessionId, {
        updatedAt: now,
        thinking: true,
        thinkingAt: now,
        latestTurnStatus: 'in_progress',
        latestTurnStatusObservedAt: now,
    });
    const desktop = getDesktopClient();
    const session = storage.getState().sessions[sessionId] ?? null;
    const marker = readDevPilotLocalAcpMarker(session?.metadata);
    if (!desktop || !marker) throw new Error('This local DevPilot session is no longer connected.');
    try {
        if (marker.taskId) {
            const workspace = await desktop.cancelTask(marker.taskId);
            seedDevPilotLocalWorkspace(workspace);
        } else if (marker.acpSessionId) {
            await desktop.cancelAcpRun(marker.acpSessionId);
        } else {
            throw new Error('This local DevPilot session is no longer connected.');
        }
        const completedAt = Date.now();
        updateLocalAcpSession(sessionId, {
            updatedAt: completedAt,
            thinking: false,
            thinkingAt: 0,
            latestTurnStatus: 'cancelled',
            latestTurnStatusObservedAt: completedAt,
        });
    } catch (caught) {
        const failedAt = Date.now();
        const message = caught instanceof Error ? caught.message : 'DevPilot cancellation failed.';
        updateLocalAcpSession(sessionId, {
            updatedAt: failedAt,
            thinking: true,
            thinkingAt: failedAt,
            latestTurnStatus: 'in_progress',
            latestTurnStatusObservedAt: failedAt,
            lastRuntimeIssue: {
                v: 1,
                scope: 'primary_session',
                status: 'failed',
                code: 'devpilot_local_acp_cancel_failed',
                source: 'unknown',
                occurredAt: failedAt,
                sanitizedPreview: message,
            } as Session['lastRuntimeIssue'],
        });
        throw caught;
    }
}
