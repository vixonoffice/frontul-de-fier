import { describe, expect, it } from 'vitest';
import { createWorld, step } from './index';
import type { Command, GameSetup, Unit } from './types';

function duelSetup(seed = 5): GameSetup {
  return {
    seed,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: false, difficulty: 'normal' },
      { team: 1, isAI: false, difficulty: 'normal' },
    ],
  };
}

describe('combat', () => {
  it('a tank ordered to attack kills an isolated enemy unit', () => {
    const world = createWorld(duelSetup());
    // ia un tanc al echipei 0 și-l teleportează chiar lângă un tanc al echipei 1, izolat
    const myTank = [...world.units.values()].find((u) => u.team === 0 && u.type === 'tank') as Unit;
    const enemyTank = [...world.units.values()].find((u) => u.team === 1 && u.type === 'tank') as Unit;
    myTank.x = 40; myTank.y = 40; myTank.hp = 10000; myTank.maxHp = 10000;
    enemyTank.x = 42; enemyTank.y = 40;

    const cmd: Command = { t: 'attack', team: 0, ids: [myTank.id], targetId: enemyTank.id };
    let destroyed = false;
    for (let i = 0; i < 400 && !destroyed; i++) {
      step(world, i === 0 ? [cmd] : []);
      if (world.events.some((e) => e.type === 'destroyed' && e.id === enemyTank.id)) destroyed = true;
    }
    expect(destroyed).toBe(true);
    expect(world.units.has(enemyTank.id)).toBe(false);
  });

  it('a turret building auto-defends against a visible enemy in range', () => {
    const world = createWorld({
      seed: 9,
      mapSize: { w: 80, h: 80 },
      players: [
        { team: 0, isAI: false, difficulty: 'normal' },
        { team: 1, isAI: true, difficulty: 'normal' },
      ],
    });
    const turret = [...world.buildings.values()].find((b) => b.type === 'turret');
    expect(turret).toBeDefined();
    const enemyTank = [...world.units.values()].find((u) => u.team !== turret!.team && u.type === 'tank') as Unit;
    enemyTank.hp = 320;
    enemyTank.x = turret!.tx + 0.5 + 2;
    enemyTank.y = turret!.ty + 0.5;

    let fired = false;
    for (let i = 0; i < 100; i++) {
      step(world, []);
      if (world.events.some((e) => e.type === 'fire' && e.sourceId === turret!.id)) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('splash damage from a rocket affects more than just the primary target when clustered', () => {
    const world = createWorld(duelSetup(11));
    const myRocket = [...world.units.values()].find((u) => u.team === 0 && u.type === 'rocket') as Unit;
    const enemyA = [...world.units.values()].find((u) => u.team === 1 && u.type === 'tank') as Unit;
    const enemyB = [...world.units.values()].filter((u) => u.team === 1 && u.type === 'tank')[1] as Unit;
    myRocket.x = 30; myRocket.y = 30; myRocket.hp = 10000;
    enemyA.x = 34; enemyA.y = 30; enemyA.hp = 320;
    enemyB.x = 34.4; enemyB.y = 30.4; enemyB.hp = 320; // suficient de apropiat de splash (0.7 tile)

    const cmd: Command = { t: 'attack', team: 0, ids: [myRocket.id], targetId: enemyA.id };
    for (let i = 0; i < 200; i++) step(world, i === 0 ? [cmd] : []);
    expect(enemyB.hp).toBeLessThan(320);
  });
});
