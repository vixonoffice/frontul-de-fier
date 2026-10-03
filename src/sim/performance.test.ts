import { describe, expect, it } from 'vitest';
import { createWorld, step } from './index';
import { getInternal, getNav } from './internal';
import { issueMoveOrder } from './movement';
import { buildBlockedGrid } from './path';
import type { GameSetup, UnitType } from './types';
import { spawnUnit } from './economy';

function setup(): GameSetup {
  return {
    seed: 42,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: false, difficulty: 'normal' },
      { team: 1, isAI: false, difficulty: 'normal' },
    ],
  };
}

describe('performance', () => {
  it('handles 200 units for 1000 ticks within a reasonable time budget', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    const types: UnitType[] = ['tank', 'rocket'];
    // populează ~200 unități suplimentare în jurul fiecărei baze
    let n = 0;
    for (const team of [0, 1] as const) {
      const start = world.map.starts[team];
      for (let i = 0; i < 100; i++) {
        const type = types[i % types.length];
        const x = Math.max(2, Math.min(world.map.w - 2, start.x + (i % 10) - 5));
        const y = Math.max(2, Math.min(world.map.h - 2, start.y + Math.floor(i / 10) - 5));
        spawnUnit(world, internal, team, type, x, y, null);
        n++;
      }
    }
    expect(world.units.size).toBeGreaterThanOrEqual(200);

    // declanșează mișcări de grup mari (>=6) ca să exercităm și flow field-ul
    const blocked = buildBlockedGrid(world);
    const team0Ids = [...world.units.values()].filter((u) => u.team === 0).map((u) => u.id);
    const team1Ids = [...world.units.values()].filter((u) => u.team === 1).map((u) => u.id);
    issueMoveOrder(world, internal, blocked, team0Ids, world.map.w - 10, world.map.h - 10, 'attackMove');
    issueMoveOrder(world, internal, blocked, team1Ids, 10, 10, 'attackMove');
    for (const id of [...team0Ids, ...team1Ids]) void getNav(internal, id);

    const TICKS = 1000;
    const start = performance.now();
    for (let i = 0; i < TICKS; i++) step(world, []);
    const elapsed = performance.now() - start;
    const msPerTick = elapsed / TICKS;

    // eslint-disable-next-line no-console
    console.log(`performance: ${n * 2} extra units, ${world.units.size} total, ${TICKS} ticks in ${elapsed.toFixed(1)}ms -> ${msPerTick.toFixed(3)} ms/tick`);

    expect(world.units.size).toBeGreaterThan(0); // simularea n-a crăpat
    // raportăm ms/tick; ținta e <4ms/tick pe mașina de dezvoltare, dar nu facem testul fragil pe CI lent
    expect(msPerTick).toBeLessThan(40);
  }, 60000);
});
