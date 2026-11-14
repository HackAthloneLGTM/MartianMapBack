import type { CostGrid } from './grid.ts';
import { MinHeap } from './heap.ts';

export interface AStarOptions {
  /** Extra cost per metre climbed (requires grid.elevation). */
  uphillPenalty?: number;
  /** Smallest multiplier in the cost grid; scales the heuristic so it stays admissible. */
  minMultiplier?: number;
}

export interface AStarResult {
  /** Cell indices (row * width + col) from start to goal, or null if unreachable. */
  path: number[] | null;
  cost: number;
  expanded: number;
}

/**
 * 8-connected A* over a cost grid.
 * Step cost = metric step length × mean multiplier of the two cells (+ optional climb penalty).
 * Diagonal moves are rejected if either orthogonal neighbour is impassable (no corner cutting).
 */
export function astar(grid: CostGrid, start: number, goal: number, opts: AStarOptions = {}): AStarResult {
  const { width: w, height: h, cost, cellX, cellY } = grid;
  const n = w * h;
  const uphill = opts.uphillPenalty ?? 0;
  const elev = uphill > 0 ? grid.elevation : undefined;
  const hScale = Math.min(1, opts.minMultiplier ?? 1);

  const diag = Math.hypot(cellX, cellY);
  const nbr: [number, number, number][] = [
    [-1, 0, cellY], [1, 0, cellY], [0, -1, cellX], [0, 1, cellX],
    [-1, -1, diag], [-1, 1, diag], [1, -1, diag], [1, 1, diag],
  ];

  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();

  const goalR = Math.floor(goal / w);
  const goalC = goal - goalR * w;
  const heuristic = (r: number, c: number) => hScale * Math.hypot((r - goalR) * cellY, (c - goalC) * cellX);

  g[start] = 0;
  heap.push(start, heuristic(Math.floor(start / w), start % w));
  let expanded = 0;

  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    if (cur === goal) break;

    const r = Math.floor(cur / w);
    const c = cur - r * w;
    const curCost = cost[cur];
    const gCur = g[cur];

    for (let k = 0; k < 8; k++) {
      const [dr, dc, dist] = nbr[k];
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= h || nc >= w) continue;
      const ni = nr * w + nc;
      if (closed[ni]) continue;
      const m = cost[ni];
      if (m === Infinity) continue;
      if (dr !== 0 && dc !== 0) {
        if (cost[r * w + nc] === Infinity || cost[nr * w + c] === Infinity) continue;
      }
      let step = (dist * (curCost + m)) / 2;
      if (elev) {
        const dz = elev[ni] - elev[cur];
        if (dz > 0) step += uphill * dz;
      }
      const ng = gCur + step;
      if (ng < g[ni]) {
        g[ni] = ng;
        parent[ni] = cur;
        heap.push(ni, ng + heuristic(nr, nc));
      }
    }
  }

  if (!closed[goal]) return { path: null, cost: Infinity, expanded };

  const path: number[] = [];
  for (let i = goal; i !== -1; i = parent[i]) path.push(i);
  path.reverse();
  return { path, cost: g[goal], expanded };
}
