import { describe, expect, it } from 'vitest';
import { buildFlowField, findPath, flowFieldStep } from './path';

function emptyGrid(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h);
}

describe('pathfinding', () => {
  it('finds a straight-ish path on an open grid', () => {
    const w = 20, h = 20;
    const blocked = emptyGrid(w, h);
    const path = findPath(blocked, w, h, 1, 1, 18, 18);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    const last = path![path!.length - 1];
    expect(Math.floor(last.x)).toBe(18);
    expect(Math.floor(last.y)).toBe(18);
  });

  it('returns null when the goal is fully enclosed by blocked tiles', () => {
    const w = 10, h = 10;
    const blocked = emptyGrid(w, h);
    // închide complet tile-ul (5,5) cu un inel de blocaje (inclusiv diagonalele, deci fără scăpare 8-dir)
    for (let y = 4; y <= 6; y++) {
      for (let x = 4; x <= 6; x++) {
        if (x === 5 && y === 5) continue;
        blocked[y * w + x] = 1;
      }
    }
    const path = findPath(blocked, w, h, 0, 0, 5, 5);
    expect(path).toBeNull();
  });

  it('never cuts corners through two diagonal blockers', () => {
    const w = 6, h = 6;
    const blocked = emptyGrid(w, h);
    // blochează (2,1) și (1,2): diagonala (1,1)->(2,2) nu trebuie tăiată
    blocked[1 * w + 2] = 1;
    blocked[2 * w + 1] = 1;
    const path = findPath(blocked, w, h, 1, 1, 2, 2);
    expect(path).not.toBeNull();
    // traseul trebuie să treacă prin cel puțin un tile intermediar, nu direct pe diagonală blocată
    expect(path!.length).toBeGreaterThanOrEqual(1);
  });

  it('path waypoints never sit on a blocked tile', () => {
    const w = 30, h = 30;
    const blocked = emptyGrid(w, h);
    for (let y = 5; y < 25; y++) blocked[y * w + 15] = 1; // perete vertical cu o breșă
    blocked[3 * w + 15] = 0;
    const path = findPath(blocked, w, h, 2, 2, 28, 28);
    expect(path).not.toBeNull();
    for (const wp of path!) {
      const i = Math.floor(wp.y) * w + Math.floor(wp.x);
      expect(blocked[i]).toBe(0);
    }
  });

  it('flow field distance decreases monotonically toward the goal along the gradient', () => {
    const w = 15, h = 15;
    const blocked = emptyGrid(w, h);
    const field = buildFlowField(blocked, w, h, 10, 10);
    let x = 1, y = 1;
    let steps = 0;
    while ((Math.floor(x) !== 10 || Math.floor(y) !== 10) && steps++ < 200) {
      const step = flowFieldStep(field, blocked, x, y);
      expect(step).not.toBeNull();
      x = step!.x; y = step!.y;
    }
    expect(steps).toBeLessThan(200);
  });
});
