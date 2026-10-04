import { describe, expect, it } from 'vitest';
import { createWorld, step } from './index';
import type { GameSetup } from './types';

function setup2p(seed = 1): GameSetup {
  return {
    seed,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: false, difficulty: 'normal' },
      { team: 1, isAI: true, difficulty: 'normal' },
    ],
  };
}

describe('smoke', () => {
  it('creates a world with expected starting entities', () => {
    const world = createWorld(setup2p());
    expect(world.units.size).toBe(2 * 4); // 2 tanks + 1 rocket + 1 harvester, per team
    expect(world.buildings.size).toBe(2 * 3); // hq+refinery per team, +2 turrets for AI team
    expect(world.players[0].credits).toBe(5000);
  });

  it('steps 100 ticks without throwing', () => {
    const world = createWorld(setup2p());
    for (let i = 0; i < 100; i++) step(world, []);
    expect(world.tick).toBe(100);
  });
});
