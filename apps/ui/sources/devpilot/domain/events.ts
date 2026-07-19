import type { RuntimeEvent } from './types';
import type { DevPilotRuntimeActivity } from './types';

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toneForEvent(event: string): DevPilotRuntimeActivity['tone'] {
    if (event.endsWith('.failed') || event === 'run.failed') return 'error';
    if (event.endsWith('.completed') || event === 'run.completed') return 'success';
    if (event.includes('permission') || event.includes('input_required')) return 'warning';
    if (event.endsWith('.started') || event === 'run.started' || event === 'run.status') return 'working';
    return 'info';
}

function titleForEvent(event: string): string {
    switch (event) {
        case 'run.started':
            return 'Run started';
        case 'run.status':
            return 'Run status';
        case 'run.completed':
            return 'Run completed';
        case 'run.failed':
            return 'Run failed';
        case 'run.cancelled':
            return 'Run cancelled';
        case 'coordinator.started':
            return 'Coordinator started';
        case 'assistant.thinking':
            return 'Thinking';
        case 'assistant.message':
            return 'Assistant response';
        case 'tool.started':
            return 'Tool started';
        case 'tool.completed':
            return 'Tool completed';
        case 'tool.failed':
            return 'Tool failed';
        case 'command.started':
            return 'Command started';
        case 'command.output':
            return 'Command output';
        case 'command.completed':
            return 'Command completed';
        case 'file.changed':
            return 'File changed';
        case 'permission.requested':
            return 'Permission requested';
        case 'user.input_required':
            return 'Needs attention';
        default:
            return event.replace(/\./g, ' ');
    }
}

function detailForEvent(event: string, data: Readonly<Record<string, unknown>>): string | null {
    const message = readString(data.message);
    if (message) return message;
    const text = readString(data.text);
    if (text && event !== 'assistant.message') return text;
    const command = readString(data.command);
    if (command) return command;
    const tool = readString(data.toolName) ?? readString(data.name);
    if (tool) return tool;
    const path = readString(data.path);
    if (path) return path;
    const state = readString(data.state);
    if (state) return state;
    return null;
}

export function normalizeDevPilotRuntimeEvent(
    frame: RuntimeEvent,
    fallbackCreatedAt = Date.now(),
): DevPilotRuntimeActivity {
    const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
    const event = String(frame.event || 'runtime.event');
    const projectId = readString(data.projectId);
    const conversationId = readString(data.conversationId);
    const runId = readString(data.runId);
    const eventId = readString(data.eventId)
        ?? readString(data.messageId)
        ?? readString(data.toolCallId)
        ?? readString(data.commandId)
        ?? `${event}:${projectId ?? ''}:${conversationId ?? ''}:${runId ?? ''}:${fallbackCreatedAt}`;

    return {
        id: eventId,
        event,
        createdAt: fallbackCreatedAt,
        projectId,
        conversationId,
        runId,
        title: titleForEvent(event),
        detail: detailForEvent(event, data),
        tone: toneForEvent(event),
    };
}
