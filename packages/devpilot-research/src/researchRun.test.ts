import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractDevPilotEventsFromMessages,
  normalizeDevPilotEvents,
  reduceResearchRunEvents,
  selectActiveExecutors,
  selectBestScoringPath,
  selectHypothesisTree,
  selectPendingApprovals,
} from './index.ts';

test('normalizes runtime aliases and builds a scored hypothesis tree', () => {
  const events = normalizeDevPilotEvents([
    { type: 'session.start', timestamp: '2026-07-15T08:00:00Z', session_id: 's1', run_id: 'r1', data: { task: 'Find the regression', cwd: 'C:/repo', mode: 'research' } },
    { type: 'cycle.start', timestamp: '2026-07-15T08:01:00Z', data: { cycle_num: 1, total_cycles: 3 } },
    { type: 'idea.proposed', timestamp: '2026-07-15T08:02:00Z', hypothesis_id: 'h1', data: { hypothesis: 'Cache invalidation', score: 0.4 } },
    { type: 'idea.proposed', timestamp: '2026-07-15T08:03:00Z', hypothesis_id: 'h2', data: { hypothesis: 'Stale cursor', parent_id: 'h1', depth: 1, score: 0.9 } },
    { type: 'idea.completed', timestamp: '2026-07-15T08:04:00Z', hypothesis_id: 'h2', data: { result: 'Confirmed' } },
  ]);
  const state = reduceResearchRunEvents('fallback', events);

  assert.equal(state.status, 'running');
  assert.equal(state.sessionId, 's1');
  assert.equal(state.currentCycle, 1);
  assert.equal(state.hypotheses.h2.status, 'done');
  assert.deepEqual(selectBestScoringPath(state), ['h1', 'h2']);
  assert.equal(selectHypothesisTree(state)[0]?.children[0]?.node.id, 'h2');
});

test('keeps parallel executors, evidence, artifacts, files, and usage independent', () => {
  const events = normalizeDevPilotEvents([
    { type: 'executor.start', timestamp: '2026-07-15T09:00:00Z', executor_id: 'e1', hypothesis_id: 'h1', data: { branch: 'research/cache', task: 'Inspect cache' } },
    { type: 'executor.start', timestamp: '2026-07-15T09:00:01Z', executor_id: 'e2', hypothesis_id: 'h2', data: { branch: 'research/cursor', task: 'Inspect cursor' } },
    { type: 'executor.progress', timestamp: '2026-07-15T09:01:00Z', executor_id: 'e1', data: { message: 'Running cache tests' } },
    { type: 'executor.end', timestamp: '2026-07-15T09:02:00Z', executor_id: 'e2', data: { changed_files: ['src/cursor.ts'], tests: ['cursor.test.ts'], test_status: 'passed' } },
    { type: 'evidence.created', timestamp: '2026-07-15T09:03:00Z', hypothesis_id: 'h1', data: { evidence_id: 'ev1', source_title: 'Issue 42', source_url: 'https://example.test/42', source_provider: 'github' } },
    { type: 'report.generated', timestamp: '2026-07-15T09:04:00Z', data: { report_id: 'report', path: '.devpilot/REPORT.md' } },
    { type: 'memory.created', timestamp: '2026-07-15T09:05:00Z', data: { memory_id: 'memory', path: '.devpilot/MEMORY.md' } },
    { type: 'audit.completed', timestamp: '2026-07-15T09:06:00Z', data: { audit_id: 'audit', path: '.devpilot/AUDIT.json' } },
    { type: 'llm.call', data: { input_tokens: 120, output_tokens: 30 } },
  ]);
  const state = reduceResearchRunEvents('s1', events);

  assert.deepEqual(selectActiveExecutors(state).map((executor) => executor.id), ['e1']);
  assert.equal(state.executors.e2.status, 'completed');
  assert.deepEqual(state.changedFiles, ['src/cursor.ts']);
  assert.equal(state.evidence[0]?.provider, 'github');
  assert.deepEqual(state.artifacts.map((artifact) => artifact.kind), ['report', 'memory', 'audit']);
  assert.deepEqual(state.usage, { inputTokens: 120, outputTokens: 30, totalTokens: 150 });
});

test('tracks approval lifecycle and waiting state without leaking executor state', () => {
  const events = normalizeDevPilotEvents([
    { type: 'permission.requested', timestamp: '2026-07-15T10:00:00Z', executor_id: 'e1', hypothesis_id: 'h1', data: { permission_id: 'p1', operation: 'git push', affected_files: ['src/a.ts'], risk: 'high' } },
    { type: 'user.await', timestamp: '2026-07-15T10:00:01Z', data: { question: 'Approve push?' } },
  ]);
  let state = reduceResearchRunEvents('s1', events);
  assert.equal(state.status, 'awaiting-input');
  assert.equal(state.coordinator.pendingQuestion, 'Approve push?');
  assert.equal(selectPendingApprovals(state)[0]?.executorId, 'e1');

  state = reduceResearchRunEvents('s1', [...events, ...normalizeDevPilotEvents([
    { type: 'permission.resolved', timestamp: '2026-07-15T10:01:00Z', data: { permission_id: 'p1', decision: 'approved' } },
    { type: 'user.input_received', timestamp: '2026-07-15T10:01:01Z' },
  ])]);
  assert.equal(selectPendingApprovals(state).length, 0);
  assert.equal(state.approvals[0]?.status, 'approved');
  assert.equal(state.status, 'running');
});

test('extracts authoritative ACP metadata and deduplicates tool input/result copies', () => {
  const meta = { type: 'executor.progress', timestamp: '2026-07-15T11:00:00Z', executor_id: 'e1', data: { message: 'Testing' } };
  const events = extractDevPilotEventsFromMessages([{
    kind: 'tool-call',
    createdAt: Date.parse('2026-07-15T11:00:00Z'),
    tool: {
      input: { query: 'tests', _acp: { meta: { devpilot: meta } } },
      result: { ok: true, _acp: { meta: { devpilot: meta } } },
    },
    children: [],
  }]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.executorId, 'e1');
  assert.equal(events[0]?.summary, 'Testing');
});

test('reconstructs hypotheses from legacy ACP plan todos', () => {
  const events = extractDevPilotEventsFromMessages([{
    kind: 'tool-call',
    createdAt: Date.parse('2026-07-15T12:00:00Z'),
    tool: { input: { todos: [{ content: '[node-7] Verify race condition', status: 'in_progress' }] } },
    children: [],
  }]);
  assert.equal(events[0]?.type, 'hypothesis.updated');
  assert.equal(events[0]?.hypothesisId, 'node-7');
  assert.equal(events[0]?.status, 'running');
});
