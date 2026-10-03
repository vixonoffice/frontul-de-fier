import { describe, expect, it } from 'vitest';
import { createWorld, step } from './index';
import type { Command, GameSetup, Unit } from './types';

function setup(seed = 3): GameSetup {
  return {
    seed,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: false, difficulty: 'normal' },
      { team: 1, isAI: false, difficulty: 'normal' },
    ],
  };
}

describe('economy: harvesting', () => {
  it('a harvester earns credits for its team over time, purely from its own order', () => {
    const world = createWorld(setup());
    const harv = [...world.units.values()].find((u) => u.team === 0 && u.type === 'harvester') as Unit;
    expect(harv).toBeDefined();
    expect(harv.order.kind).toBe('harvest'); // pornește deja în modul de recoltare

    const startCredits = world.players[0].credits;
    let unloadedAtLeastOnce = false;
    for (let i = 0; i < 2000; i++) {
      step(world, []);
      if (world.events.some((e) => e.type === 'unload' && e.team === 0)) unloadedAtLeastOnce = true;
    }
    expect(unloadedAtLeastOnce).toBe(true);
    expect(world.players[0].credits).toBeGreaterThan(startCredits);
  });
});

describe('economy: production and placement', () => {
  it('buildStart deducts cost, progresses, and becomes ready', () => {
    const world = createWorld(setup());
    const before = world.players[0].credits;
    step(world, [{ t: 'buildStart', team: 0, building: 'turret' }]);
    expect(world.players[0].credits).toBe(before - 600);
    expect(world.players[0].production.building?.type).toBe('turret');

    let readyEvent = false;
    for (let i = 0; i < 200 && !readyEvent; i++) {
      step(world, []);
      if (world.events.some((e) => e.type === 'buildingReady')) readyEvent = true;
    }
    expect(readyEvent).toBe(true);
    expect(world.players[0].production.building?.ready).toBe(true);
  });

  it('buildPlace only succeeds on a valid, in-range, unobstructed tile', () => {
    const world = createWorld(setup());
    step(world, [{ t: 'buildStart', team: 0, building: 'turret' }]);
    for (let i = 0; i < 200; i++) step(world, []);
    expect(world.players[0].production.building?.ready).toBe(true);

    const hq = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!;
    const buildingsBefore = world.buildings.size;
    // prea departe de orice clădire proprie -> respins
    step(world, [{ t: 'buildPlace', team: 0, tx: hq.tx + 40, ty: hq.ty + 40 }]);
    expect(world.buildings.size).toBe(buildingsBefore);
    expect(world.players[0].production.building).not.toBeNull();

    // loc valid, liber, aproape de HQ -> acceptat
    let placed = false;
    for (let tx = hq.tx - 3; tx <= hq.tx + 6 && !placed; tx++) {
      for (let ty = hq.ty - 3; ty <= hq.ty + 8 && !placed; ty++) {
        const before = world.buildings.size;
        step(world, [{ t: 'buildPlace', team: 0, tx, ty }]);
        if (world.buildings.size > before) placed = true;
      }
    }
    expect(placed).toBe(true);
    expect(world.players[0].production.building).toBeNull();
  });

  it('buildCancel refunds the cost', () => {
    const world = createWorld(setup());
    const before = world.players[0].credits;
    step(world, [{ t: 'buildStart', team: 0, building: 'factory' }]);
    expect(world.players[0].credits).toBe(before - 1200);
    step(world, [{ t: 'buildCancel', team: 0 }]);
    expect(world.players[0].credits).toBe(before);
    expect(world.players[0].production.building).toBeNull();
  });

  it('training requires a factory and queues up to 5 units', () => {
    const world = createWorld(setup());
    const cmd: Command = { t: 'train', team: 0, unit: 'tank' };
    const before = world.players[0].credits;
    step(world, [cmd]); // fără fabrică -> respins
    expect(world.players[0].credits).toBe(before);
    expect(world.players[0].production.units.length).toBe(0);

    // construiește o fabrică
    step(world, [{ t: 'buildStart', team: 0, building: 'factory' }]);
    for (let i = 0; i < 250; i++) step(world, []);
    const hq = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!;
    let placed = false;
    for (let tx = hq.tx - 3; tx <= hq.tx + 6 && !placed; tx++) {
      for (let ty = hq.ty - 3; ty <= hq.ty + 8 && !placed; ty++) {
        const b = world.buildings.size;
        step(world, [{ t: 'buildPlace', team: 0, tx, ty }]);
        if (world.buildings.size > b) placed = true;
      }
    }
    expect(placed).toBe(true);

    for (let i = 0; i < 7; i++) step(world, [cmd]);
    expect(world.players[0].production.units.length).toBeLessThanOrEqual(5);

    let unitReady = false;
    for (let i = 0; i < 400 && !unitReady; i++) {
      step(world, []);
      if (world.events.some((e) => e.type === 'unitReady')) unitReady = true;
    }
    expect(unitReady).toBe(true);
  });
});
