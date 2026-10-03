import { describe, expect, it } from 'vitest';
import { createWorld, hash, step } from './index';
import type { Command, GameSetup } from './types';

function setup2p(seed: number): GameSetup {
  return {
    seed,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: true, difficulty: 'hard' },
      { team: 1, isAI: true, difficulty: 'hard' },
    ],
  };
}

// un mic "script" de comenzi determinist, aplicat identic în ambele lumi
function scriptAt(tick: number, world: ReturnType<typeof createWorld>): Command[] {
  const cmds: Command[] = [];
  if (tick === 20) {
    const ids = [...world.units.keys()].filter((id) => world.units.get(id)!.team === 0);
    if (ids.length) cmds.push({ t: 'move', team: 0, ids, x: 40, y: 40 });
  }
  if (tick === 40) {
    cmds.push({ t: 'buildStart', team: 0, building: 'turret' });
  }
  return cmds;
}

describe('determinism', () => {
  it('two worlds with the same seed and command script stay identical for 3000 ticks', () => {
    const w1 = createWorld(setup2p(1234));
    const w2 = createWorld(setup2p(1234));
    expect(hash(w1)).toBe(hash(w2));

    for (let t = 1; t <= 3000; t++) {
      step(w1, scriptAt(t, w1));
      step(w2, scriptAt(t, w2));
      if (t % 100 === 0) {
        expect(hash(w1)).toBe(hash(w2));
      }
    }
  });

  it('different seeds produce different maps (sanity, not a hash guarantee)', () => {
    const a = createWorld(setup2p(1));
    const b = createWorld(setup2p(2));
    expect([...a.map.terrain]).not.toEqual([...b.map.terrain]);
  });
});
