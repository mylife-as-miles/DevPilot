const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');

const WORKSPACE_VERSION = 1;
const MAX_TASK_MESSAGES = 240;

function emptyWorkspace() {
  return {
    version: WORKSPACE_VERSION,
    selectedProjectId: null,
    selectedTaskId: null,
    projects: [],
  };
}

function normalizePath(projectPath) {
  return path.resolve(String(projectPath || '').trim());
}

function projectIdForPath(projectPath) {
  const normalized = normalizePath(projectPath);
  return `project-${createHash('sha256').update(normalized.toLowerCase()).digest('hex').slice(0, 16)}`;
}

function projectNameForPath(projectPath) {
  const normalized = normalizePath(projectPath);
  return path.basename(normalized) || normalized;
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const text = String(message.text || '').trim();
  const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
  if (!text) return null;
  return {
    id: String(message.id || randomUUID()),
    role,
    text,
    kind: message.kind === 'thinking' ? 'thinking' : 'message',
    createdAt: Number.isFinite(message.createdAt) ? Number(message.createdAt) : Date.now(),
  };
}

function normalizeTask(task, projectId) {
  if (!task || typeof task !== 'object') return null;
  const id = String(task.id || '').trim();
  if (!id) return null;
  const createdAt = Number.isFinite(task.createdAt) ? Number(task.createdAt) : Date.now();
  const statusValues = new Set(['draft', 'starting', 'running', 'completed', 'failed', 'cancelled', 'interrupted']);
  return {
    id,
    projectId,
    title: String(task.title || 'New task').trim().slice(0, 120) || 'New task',
    createdAt,
    updatedAt: Number.isFinite(task.updatedAt) ? Number(task.updatedAt) : createdAt,
    status: statusValues.has(task.status) ? task.status : 'interrupted',
    acpSessionId: typeof task.acpSessionId === 'string' && task.acpSessionId.trim() ? task.acpSessionId.trim() : null,
    model: String(task.model || 'default').trim() || 'default',
    reasoningEffort: String(task.reasoningEffort || 'high').trim() || 'high',
    messages: Array.isArray(task.messages)
      ? task.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_TASK_MESSAGES)
      : [],
  };
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object') return null;
  const rawPath = String(project.path || '').trim();
  if (!rawPath) return null;
  const resolvedPath = normalizePath(rawPath);
  const id = projectIdForPath(resolvedPath);
  const createdAt = Number.isFinite(project.createdAt) ? Number(project.createdAt) : Date.now();
  return {
    id,
    name: String(project.name || projectNameForPath(resolvedPath)).trim() || projectNameForPath(resolvedPath),
    path: resolvedPath,
    createdAt,
    updatedAt: Number.isFinite(project.updatedAt) ? Number(project.updatedAt) : createdAt,
    tasks: Array.isArray(project.tasks)
      ? project.tasks.map((task) => normalizeTask(task, id)).filter(Boolean)
      : [],
  };
}

function normalizeWorkspace(candidate) {
  const projects = Array.isArray(candidate?.projects)
    ? candidate.projects.map(normalizeProject).filter(Boolean)
    : [];
  const projectIds = new Set(projects.map((project) => project.id));
  const taskIds = new Set(projects.flatMap((project) => project.tasks.map((task) => task.id)));
  const selectedProjectId = projectIds.has(candidate?.selectedProjectId)
    ? candidate.selectedProjectId
    : projects[0]?.id || null;
  const selectedTaskId = taskIds.has(candidate?.selectedTaskId) ? candidate.selectedTaskId : null;
  return { version: WORKSPACE_VERSION, selectedProjectId, selectedTaskId, projects };
}

function addProject(workspace, projectPath, now = Date.now()) {
  const state = normalizeWorkspace(workspace);
  const resolvedPath = normalizePath(projectPath);
  const id = projectIdForPath(resolvedPath);
  const existing = state.projects.find((project) => project.id === id);
  if (existing) {
    existing.path = resolvedPath;
    existing.name = projectNameForPath(resolvedPath);
    existing.updatedAt = now;
  } else {
    state.projects.unshift({
      id,
      name: projectNameForPath(resolvedPath),
      path: resolvedPath,
      createdAt: now,
      updatedAt: now,
      tasks: [],
    });
  }
  state.selectedProjectId = id;
  state.selectedTaskId = null;
  return state;
}

function selectProject(workspace, projectId) {
  const state = normalizeWorkspace(workspace);
  if (!state.projects.some((project) => project.id === projectId)) throw new Error('Unknown DevPilot project.');
  state.selectedProjectId = projectId;
  state.selectedTaskId = null;
  return state;
}

function createTask(workspace, projectId, input, now = Date.now()) {
  const state = normalizeWorkspace(workspace);
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error('Choose a project before starting a task.');
  const prompt = String(input?.prompt || '').trim();
  if (!prompt) throw new Error('Describe what you would like DevPilot to work on.');
  const id = randomUUID();
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  const title = firstLine.length > 72 ? `${firstLine.slice(0, 69).trimEnd()}...` : firstLine;
  const task = {
    id,
    projectId,
    title: title || 'New task',
    createdAt: now,
    updatedAt: now,
    status: 'starting',
    acpSessionId: null,
    model: String(input?.model || 'default').trim() || 'default',
    reasoningEffort: String(input?.reasoningEffort || 'high').trim() || 'high',
    messages: [{ id: randomUUID(), role: 'user', text: prompt, kind: 'message', createdAt: now }],
  };
  project.tasks.unshift(task);
  project.updatedAt = now;
  state.selectedProjectId = projectId;
  state.selectedTaskId = id;
  return { workspace: state, task };
}

function updateTask(workspace, taskId, patch, now = Date.now()) {
  const state = normalizeWorkspace(workspace);
  for (const project of state.projects) {
    const task = project.tasks.find((candidate) => candidate.id === taskId);
    if (!task) continue;
    Object.assign(task, patch, { id: task.id, projectId: project.id, updatedAt: now });
    if (Array.isArray(patch?.messages)) {
      task.messages = patch.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_TASK_MESSAGES);
    }
    project.updatedAt = now;
    return { workspace: state, project, task };
  }
  throw new Error('Unknown DevPilot task.');
}

function appendTaskMessage(workspace, taskId, message, now = Date.now()) {
  const state = normalizeWorkspace(workspace);
  for (const project of state.projects) {
    const task = project.tasks.find((candidate) => candidate.id === taskId);
    if (!task) continue;
    const normalized = normalizeMessage({ ...message, createdAt: message?.createdAt ?? now });
    if (!normalized) return { workspace: state, project, task };
    task.messages = [...task.messages, normalized].slice(-MAX_TASK_MESSAGES);
    task.updatedAt = now;
    project.updatedAt = now;
    return { workspace: state, project, task };
  }
  throw new Error('Unknown DevPilot task.');
}

module.exports = {
  WORKSPACE_VERSION,
  addProject,
  appendTaskMessage,
  createTask,
  emptyWorkspace,
  normalizeWorkspace,
  projectIdForPath,
  selectProject,
  updateTask,
};
