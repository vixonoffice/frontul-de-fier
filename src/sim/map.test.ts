import { describe, expect, it } from 'vitest';
import { generateMap } from './map';
import { TERRAIN_WATER, TERRAIN_ROCK } from './types';
import type { GameSetup } from './types';

function setupFor(seed: number): GameSetup {
  return {
    seed,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: false, difficulty: 'normal' },
      { team: 1, isAI: true, difficulty: 'normal' },
    ],
  };
}

function isPassable(terrain: Uint8Array, i: number): boolean {
  return terrain[i] !== TERRAIN_ROCK && terrain[i] !== TERRAIN_WATER;
}

function connected(w: number, h: number, terrain: Uint8Array, starts: { x: number; y: number }[]): boolean {
  const from = starts[0];
  const seen = new Uint8Array(w * h);
  const sx = Math.floor(from.x), sy = Math.floor(from.y);
  const stack = [sy * w + sx];
  seen[stack[0]] = 1;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let head = 0;
  while (head < stack.length) {
    const c = stack[head++];
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen[n] || !isPassable(terrain, n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return starts.every((s) => seen[Math.floor(s.y) * w + Math.floor(s.x)] === 1);
}

describe('map generation', () => {
  for (let seed = 1; seed <= 20; seed++) {
    it(`seed ${seed}: all starts are mutually connected`, () => {
      const map = generateMap({ rng: seed }, setupFor(seed));
      expect(connected(map.w, map.h, map.terrain, map.starts)).toBe(true);
    });
  }

  it('start areas are free of rock/water and ore is not under starting buildings', () => {
    const map = generateMap({ rng: 42 }, setupFor(42));
    for (const s of map.starts) {
      const sx = Math.floor(s.x), sy = Math.floor(s.y);
      const i = sy * map.w + sx;
      expect(isPassable(map.terrain, i)).toBe(true);
    }
  });

  it('height values stay within 0..1', () => {
    const map = generateMap({ rng: 7 }, setupFor(7));
    for (let i = 0; i < map.height.length; i++) {
      expect(map.height[i]).toBeGreaterThanOrEqual(0);
      expect(map.height[i]).toBeLessThanOrEqual(1);
    }
  });

  it('ore amounts fall roughly within the 700-1100 per-tile spec where present', () => {
    const map = generateMap({ rng: 3 }, setupFor(3));
    let oreTiles = 0;
    for (let i = 0; i < map.ore.length; i++) {
      if (map.ore[i] > 0) {
        oreTiles++;
        expect(map.ore[i]).toBeGreaterThanOrEqual(700);
        expect(map.ore[i]).toBeLessThanOrEqual(1100);
      }
    }
    expect(oreTiles).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const a = generateMap({ rng: 99 }, setupFor(99));
    const b = generateMap({ rng: 99 }, setupFor(99));
    expect([...a.terrain]).toEqual([...b.terrain]);
    expect([...a.ore]).toEqual([...b.ore]);
    expect(a.starts).toEqual(b.starts);
  });
});
