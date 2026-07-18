const assert = require('node:assert/strict');
const test = require('node:test');

const {
  addProject,
  createTask,
  emptyWorkspace,
  normalizeWorkspace,
  selectProject,
} = require('./workspace-store.cjs');

test('adding a folder persists a project without creating a task or ACP session', () => {
  const state = addProject(emptyWorkspace(), 'C:/work/DevPilot', 10);
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].name, 'DevPilot');
  assert.deepEqual(state.projects[0].tasks, []);
  assert.equal(state.selectedProjectId, state.projects[0].id);
  assert.equal(state.selectedTaskId, null);
});

test('the first prompt creates a task inside the selected project', () => {
  const withProject = addProject(emptyWorkspace(), 'C:/work/DevPilot', 10);
  const projectId = withProject.projects[0].id;
  const { workspace, task } = createTask(withProject, projectId, {
    prompt: 'Fix the desktop session lifecycle',
    model: 'gpt-5',
    reasoningEffort: 'high',
  }, 20);
  assert.equal(workspace.projects[0].tasks.length, 1);
  assert.equal(workspace.selectedTaskId, task.id);
  assert.equal(task.status, 'starting');
  assert.equal(task.messages[0].role, 'user');
});

test('projects are deduplicated by normalized path', () => {
  const once = addProject(emptyWorkspace(), 'C:/work/DevPilot', 10);
  const twice = addProject(once, 'C:/work/DevPilot/.', 20);
  assert.equal(twice.projects.length, 1);
  assert.equal(twice.projects[0].updatedAt, 20);
});

test('stale persisted runtime state is marked interrupted on normalization', () => {
  const state = normalizeWorkspace({
    selectedProjectId: 'ignored',
    projects: [{
      path: 'C:/work/DevPilot',
      tasks: [{ id: 'task-1', status: 'unknown', title: 'Old task' }],
    }],
  });
  assert.equal(state.projects[0].tasks[0].status, 'interrupted');
  assert.throws(() => selectProject(state, 'missing'));
});
