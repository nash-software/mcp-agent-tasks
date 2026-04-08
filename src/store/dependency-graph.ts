/**
 * Cycle detection for task dependency graph.
 *
 * An edge [A, B] means "A depends on B" (B must be done before A).
 * A cycle would mean a task (in)directly depends on itself.
 */
export function detectCycle(
  existingEdges: Array<[string, string]>,
  newEdge: [string, string],
): boolean {
  // Build adjacency map: task -> set of tasks it depends on
  const adj = new Map<string, Set<string>>();

  const addEdge = (from: string, to: string): void => {
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from)!.add(to);
  };

  for (const [from, to] of existingEdges) {
    addEdge(from, to);
  }
  addEdge(newEdge[0], newEdge[1]);

  // DFS from newEdge[1] (the dependency target).
  // If we can reach newEdge[0] (the task), there is a cycle.
  const target = newEdge[0];
  const start = newEdge[1];

  const visited = new Set<string>();
  const stack = [start];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === target) return true;
    if (visited.has(node)) continue;
    visited.add(node);

    const neighbors = adj.get(node);
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }
  }

  return false;
}
