import { describe, expect, it } from 'vitest';
import { evaTiming } from '../src/analysis/eva.js';
import { astar } from '../src/routing/astar.js';
import { blockingThreshold, multiplierFor, type CostGrid } from '../src/routing/grid.js';
import { MinHeap } from '../src/routing/heap.js';
import { DEFAULT_OPTIONS } from '../src/config.js';

/** '.' = cost 1, '~' = cost 3, '#' = blocked. */
function gridFrom(rows: string[]): CostGrid {
  const height = rows.length;
  const width = rows[0].length;
  const cost = new Float32Array(width * height);
  rows.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      cost[r * width + c] = ch === '#' ? Infinity : ch === '~' ? 3 : 1;
    }),
  );
  return { width, height, cellX: 1, cellY: 1, cost };
}

const idx = (g: CostGrid, r: number, c: number) => r * g.width + c;
const rc = (g: CostGrid, i: number) => [Math.floor(i / g.width), i % g.width];

describe('MinHeap', () => {
  it('pops in priority order', () => {
    const h = new MinHeap();
    [5, 1, 4, 2, 3, 0].forEach((p) => h.push(p, p));
    const out: number[] = [];
    while (h.size) out.push(h.pop());
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('astar', () => {
  it('goes straight on open ground', () => {
    const g = gridFrom(['.....']);
    const r = astar(g, 0, 4);
    expect(r.path).toEqual([0, 1, 2, 3, 4]);
    expect(r.cost).toBeCloseTo(4);
  });

  it('routes around a wall', () => {
    const g = gridFrom([
      '.....',
      '.###.',
      '.#...',
      '.#.#.',
      '.....',
    ]);
    const r = astar(g, idx(g, 2, 2), idx(g, 0, 2));
    expect(r.path).not.toBeNull();
    for (const i of r.path!) expect(g.cost[i]).not.toBe(Infinity);
  });

  it('never cuts corners between blocked cells', () => {
    const g = gridFrom([
      '.#',
      '#.',
    ]);
    expect(astar(g, 0, 3).path).toBeNull();

    const g2 = gridFrom([
      '..',
      '#.',
    ]);
    // Diagonal 0→3 would clip the '#' at (1,0): must go via (0,1).
    expect(astar(g2, 0, 3).path).toEqual([0, 1, 3]);
  });

  it('returns null when unreachable', () => {
    const g = gridFrom(['..#..']);
    expect(astar(g, 0, 4).path).toBeNull();
  });

  it('prefers a longer detour over expensive terrain', () => {
    const g = gridFrom([
      '.....',
      '~~~~.',
      '.....',
    ]);
    // Crossing directly would cost ~51; the detour through the gap at column 4 costs ~10.
    g.cost.fill(50, idx(g, 1, 0), idx(g, 1, 4));
    const r = astar(g, idx(g, 0, 0), idx(g, 2, 0));
    const cols = r.path!.map((i) => rc(g, i)[1]);
    expect(Math.max(...cols)).toBe(4);
  });
});

describe('slope classes', () => {
  const c = DEFAULT_OPTIONS.slopeClasses;
  it('maps slopes to guide multipliers', () => {
    expect(multiplierFor(2, c)).toBe(1);
    expect(multiplierFor(7, c)).toBe(1.5);
    expect(multiplierFor(12, c)).toBe(3);
    expect(multiplierFor(20, c)).toBeNull();
    expect(blockingThreshold(c)).toBe(15);
  });
});

describe('evaTiming', () => {
  it('matches the guide example (900 m → 138 min)', () => {
    const t = evaTiming(900, DEFAULT_OPTIONS);
    expect(t.oneWayMinutes).toBeCloseTo(54);
    expect(t.totalEvaMinutes).toBeCloseTo(138);
    expect(t.doseMSv).toBeCloseTo((138 / 60) * (0.67 / 24));
  });

  it('matches the guide dose example (2.5 h → ~0.070 mSv)', () => {
    const t = evaTiming(1000, { ...DEFAULT_OPTIONS, returnTrip: true, scienceStopMin: 30 });
    expect(t.totalEvaMinutes).toBeCloseTo(150);
    expect(t.doseMSv).toBeCloseTo(0.0698, 3);
  });
});
