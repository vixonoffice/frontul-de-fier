// Teste runda 4A: recoltoare la rafinărie (dock + coadă), formații, strivire.
import { describe, expect, it } from 'vitest';
import { canPlace, createWorld, step } from './index';
import { getInternal } from './internal';
import { buildBlockedGrid } from './path';
import { spawnBuilding, spawnUnit, dockCenter } from './economy';
import type { Building, BuildingType, GameSetup, SimEvent, Team, Unit, World } from './types';

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

function place(world: World, team: Team, type: BuildingType): Building {
  const hq = [...world.buildings.values()].find((b) => b.team === team && b.type === 'hq')!;
  for (let r = 3; r < 16; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (canPlace(world, team, type, hq.tx + dx, hq.ty + dy)) {
          return spawnBuilding(world, getInternal(world), buildBlockedGrid(world), team, type, hq.tx + dx, hq.ty + dy);
        }
      }
    }
  }
  throw new Error('fără loc');
}

function clearTeam(world: World, team: Team): void {
  for (const u of [...world.units.values()]) if (u.team === team) world.units.delete(u.id);
}

describe('A1: recoltoare și rafinării', () => {
  it('4 recoltoare, o rafinărie: toate livrează, niciodată mai mult de unul pe dock, fără blocaj', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    clearTeam(world, 1);
    const refinery = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'refinery')!;
    const first = [...world.units.values()].find((u) => u.team === 0 && u.type === 'harvester')!;
    const harvs: Unit[] = [first];
    for (let i = 0; i < 3; i++) harvs.push(spawnUnit(world, internal, 0, 'harvester', first.x + 1 + i, first.y + 1, null));
    const dc = dockCenter(world, buildBlockedGrid(world), refinery);
    const delivered = new Map<number, number>(harvs.map((h) => [h.id, 0]));
    const lastCarry = new Map<number, number>(harvs.map((h) => [h.id, 0]));
    let maxOnDock = 0;
    let lastDeliveryTick = 0;
    for (let t = 0; t < 20 * 180; t++) {
      step(world, []);
      let onDock = 0;
      for (const h of harvs) {
        if (Math.hypot(h.x - dc.x, h.y - dc.y) < 0.4) onDock++;
        if (h.carry < (lastCarry.get(h.id) ?? 0)) { delivered.set(h.id, (delivered.get(h.id) ?? 0) + 1); lastDeliveryTick = world.tick; }
        lastCarry.set(h.id, h.carry);
      }
      maxOnDock = Math.max(maxOnDock, onDock);
    }
    expect(maxOnDock).toBeLessThanOrEqual(1);
    for (const h of harvs) expect(delivered.get(h.id)).toBeGreaterThanOrEqual(2);
    expect(world.tick - lastDeliveryTick).toBeLessThan(20 * 30); // încă livrează la final: fără blocaj
  });

  it('cu 2 rafinării, livrările se împart aproximativ egal', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    clearTeam(world, 1);
    const r1 = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'refinery')!;
    const r2 = place(world, 0, 'refinery');
    const first = [...world.units.values()].find((u) => u.team === 0 && u.type === 'harvester')!;
    for (let i = 0; i < 5; i++) spawnUnit(world, internal, 0, 'harvester', first.x + 1 + i, first.y + 1, null);
    const counts = [0, 0];
    const c1 = { x: r1.tx + r1.w / 2, y: r1.ty + r1.h / 2 }, c2 = { x: r2.tx + r2.w / 2, y: r2.ty + r2.h / 2 };
    for (let t = 0; t < 20 * 240; t++) {
      step(world, []);
      for (const e of world.events as SimEvent[]) {
        if (e.type !== 'unload' || e.team !== 0) continue;
        const d1 = Math.hypot(e.x - c1.x, e.y - c1.y), d2 = Math.hypot(e.x - c2.x, e.y - c2.y);
        counts[d1 <= d2 ? 0 : 1]++;
      }
    }
    const total = counts[0] + counts[1];
    expect(total).toBeGreaterThan(20);
    expect(Math.min(counts[0], counts[1]) / total).toBeGreaterThan(0.15);
  });
});

describe('A2: formații', () => {
  it('12 unități trimise într-un punct ajung pe sloturi distincte (>= 0.6 tile) și se opresc', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    clearTeam(world, 1);
    clearTeam(world, 0);
    const start = world.map.starts[0];
    const units: Unit[] = [];
    for (let i = 0; i < 12; i++) units.push(spawnUnit(world, internal, 0, i % 3 === 0 ? 'rocket' : 'tank', start.x - 3 + (i % 6) * 1.1, start.y + 3 + Math.floor(i / 6) * 1.1, null));
    const dest = { x: world.map.w / 2, y: world.map.h / 2 };
    step(world, [{ t: 'move', team: 0, ids: units.map((u) => u.id), x: dest.x, y: dest.y }]);
    let stopped = -1;
    for (let t = 0; t < 20 * 90; t++) {
      step(world, []);
      if (units.every((u) => !u.moving && u.order.kind === 'idle')) { stopped = t; break; }
    }
    expect(stopped).toBeGreaterThan(0);
    stepAfter(world, 40);
    let minD = Infinity;
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      minD = Math.min(minD, Math.hypot(units[i].x - units[j].x, units[i].y - units[j].y));
    }
    expect(minD).toBeGreaterThanOrEqual(0.6);
    // și rămân pe loc
    const before = units.map((u) => ({ x: u.x, y: u.y }));
    stepAfter(world, 60);
    units.forEach((u, i) => expect(Math.hypot(u.x - before[i].x, u.y - before[i].y)).toBeLessThan(0.05));
  });

  it('unitățile produse la un punct de adunare iau sloturi libere distincte', () => {
    const world = createWorld(setup());
    clearTeam(world, 1);
    place(world, 0, 'barracks');
    const hq = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!;
    world.players[0].credits = 100000;
    step(world, [{ t: 'rally', team: 0, x: hq.tx + 1.5, y: hq.ty + 9 }, { t: 'train', team: 0, unit: 'soldier', count: 10 }]);
    stepAfter(world, 20 * 40);
    const soldiers = [...world.units.values()].filter((u) => u.type === 'soldier' && u.team === 0);
    expect(soldiers.length).toBeGreaterThanOrEqual(8);
    let minD = Infinity;
    for (let i = 0; i < soldiers.length; i++) for (let j = i + 1; j < soldiers.length; j++) {
      minD = Math.min(minD, Math.hypot(soldiers[i].x - soldiers[j].x, soldiers[i].y - soldiers[j].y));
    }
    expect(minD).toBeGreaterThanOrEqual(0.3);
  });
});

function stepAfter(world: World, n: number): void {
  for (let i = 0; i < n; i++) step(world, []);
}

describe('A3: strivire', () => {
  it('tancul strivește infanteria inamică, nu pe a lui', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    clearTeam(world, 1);
    clearTeam(world, 0);
    // un culoar orizontal de teren liber, lung de 16 tile-uri
    const { w, h, terrain } = world.map;
    let ry = 0, rx = 0;
    outer: for (let y = 5; y < h - 5; y++) for (let x = 5; x < w - 20; x++) {
      let ok = true;
      for (let k = 0; k < 16 && ok; k++) for (let dy = -1; dy <= 1; dy++) if (terrain[(y + dy) * w + x + k] !== 0) { ok = false; break; }
      if (ok && ![...world.buildings.values()].some((b) => b.ty < y + 3 && b.ty + b.h > y - 3 && b.tx < x + 17 && b.tx + b.w > x - 1)) { ry = y; rx = x; break outer; }
    }
    expect(ry).toBeGreaterThan(0);
    const tank = spawnUnit(world, internal, 0, 'tank', rx + 0.5, ry + 0.5, null);
    const enemies = [0, 1, 2].map((i) => spawnUnit(world, internal, 1, 'soldier', rx + 4 + i * 3, ry + 0.5, null));
    const own = spawnUnit(world, internal, 0, 'soldier', rx + 13.5, ry + 0.5, null);
    enemies.forEach((e) => { e.hp = 100000; e.maxHp = 100000; });
    own.hp = 100000; own.maxHp = 100000;
    // soldații inamici nu trag (nu văd): le anulăm arma ținând tancul nevăzut nu merge, deci le dăm hp mare
    step(world, [{ t: 'move', team: 0, ids: [tank.id], x: rx + 15.5, y: ry + 0.5 }]);
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      step(world, []);
      events.push(...world.events);
    }
    const crushed = events.filter((e) => e.type === 'crushed');
    expect(crushed.length).toBeGreaterThanOrEqual(1);
    expect(crushed.every((e) => e.type === 'crushed' && e.team === 1)).toBe(true);
    expect(world.units.has(own.id)).toBe(true);
    expect(tank.kills).toBeGreaterThanOrEqual(1);
  });
});
