import type { ExecutorState, HypothesisNode, ResearchRunState } from './types.ts';

export type HypothesisTreeNode = Readonly<{
  node: HypothesisNode;
  children: readonly HypothesisTreeNode[];
}>;

export function selectHypothesisTree(state: ResearchRunState): readonly HypothesisTreeNode[] {
  const children = new Map<string | null, HypothesisNode[]>();
  for (const id of state.hypothesisOrder) {
    const node = state.hypotheses[id];
    if (!node) continue;
    const key = node.parentId && state.hypotheses[node.parentId] ? node.parentId : null;
    children.set(key, [...(children.get(key) ?? []), node]);
  }
  const build = (parentId: string | null): readonly HypothesisTreeNode[] => Object.freeze(
    (children.get(parentId) ?? []).map((node) => Object.freeze({ node, children: build(node.id) })),
  );
  return build(null);
}

export function selectActiveExecutors(state: ResearchRunState): readonly ExecutorState[] {
  return Object.freeze(state.executorOrder.map((id) => state.executors[id]).filter((executor): executor is ExecutorState => executor?.status === 'running'));
}

export function selectBestScoringPath(state: ResearchRunState): readonly string[] {
  const scored = state.hypothesisOrder
    .map((id) => state.hypotheses[id])
    .filter((node): node is HypothesisNode => Boolean(node && node.score !== null))
    .sort((left, right) => (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY));
  const best = scored[0];
  if (!best) return Object.freeze([]);
  const path: string[] = [];
  let current: HypothesisNode | undefined = best;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.id);
    current = current.parentId ? state.hypotheses[current.parentId] : undefined;
  }
  return Object.freeze(path);
}

export function selectPendingApprovals(state: ResearchRunState) {
  return Object.freeze(state.approvals.filter((approval) => approval.status === 'pending'));
}
