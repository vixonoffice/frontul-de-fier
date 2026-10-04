// Teste runda 3: cozi lungi plătite pe rând, asistentul (economie / apărare / atac), roluri și gardieni.
import { describe, expect, it } from 'vitest';
import { canPlace, createWorld, hash, step } from './index';
import { getInternal } from './internal';
import { buildBlockedGrid } from './path';
import { spawnBuilding, spawnUnit } from './economy';
import { runAssist } from './assist';
import { MAX_QUEUE, UNITS } from '../data/units';
import type { Building, BuildingType, Command, GameSetup, SimEvent, Team, Unit, World } from './types';

function setup(seed = 3, p1: 'human' | 'easy' | 'normal' = 'human'): GameSetup {
  return {
    seed,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: false, difficulty: 'normal' },
      { team: 1, isAI: p1 !== 'human', difficulty: p1 === 'easy' ? 'easy' : 'normal' },
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
  throw new Error('fără loc pentru ' + type);
}

function stepN(world: World, n: number, collect?: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    step(world, []);
    if (collect) collect.push(...world.events);
  }
}

const count = (world: World, team: Team, type: BuildingType) => [...world.buildings.values()].filter((b) => b.team === team && b.type === type).length;
const toggle = (mode: 'economy' | 'defense' | 'attack' | 'allIn', on = true): Command => ({ t: 'assist', team: 0, mode, on });

describe('cozi lungi plătite pe rând', () => {
  it('50 de tancuri fără bani în plus ies pe rând, pe măsură ce vin banii, fără credite negative', () => {
    const world = createWorld(setup());
    place(world, 0, 'factory');
    world.players[0].credits = 0;
    step(world, [{ t: 'train', team: 0, unit: 'tank', count: 50 }]);
    expect(world.players[0].production.units.length).toBe(50);
    expect(world.players[0].production.units.every((s) => !s.paid)).toBe(true);
    let minCredits = Infinity;
    const events: SimEvent[] = [];
    for (let i = 0; i < 20 * 150; i++) {
      step(world, []);
      events.push(...world.events);
      minCredits = Math.min(minCredits, world.players[0].credits);
    }
    expect(minCredits).toBeGreaterThanOrEqual(0);
    const ready = events.filter((e) => e.type === 'unitReady' && e.unit === 'tank').length;
    expect(ready).toBeGreaterThanOrEqual(2);
    expect(world.players[0].production.units.length).toBe(50 - ready - (world.players[0].production.units[0]?.paid ? 0 : 0));
  });

  it('coada e limitată la MAX_QUEUE', () => {
    const world = createWorld(setup());
    place(world, 0, 'barracks');
    step(world, [{ t: 'train', team: 0, unit: 'soldier', count: 500 }]);
    expect(world.players[0].production.infantry.length).toBe(MAX_QUEUE);
  });

  it('trainCancel cu all rambursează doar sloturile plătite', () => {
    const world = createWorld(setup());
    place(world, 0, 'factory');
    const cost = UNITS.tank.cost;
    world.players[0].credits = cost + 7;
    step(world, [{ t: 'train', team: 0, unit: 'tank', count: 5 }]);
    const q = world.players[0].production.units;
    expect(q.length).toBe(5);
    expect(q.filter((s) => s.paid).length).toBe(1);
    expect(world.players[0].credits).toBe(7);
    step(world, [{ t: 'trainCancel', team: 0, unit: 'tank', all: true }]);
    expect(world.players[0].production.units.length).toBe(0);
    expect(world.players[0].credits).toBe(cost + 7);
  });
});

describe('asistentul', () => {
  it('economia singură ajunge la 2 rafinării + cazarmă + fabrică în 3 minute', () => {
    const world = createWorld(setup());
    step(world, [toggle('economy')]);
    stepN(world, 20 * 60 * 3);
    expect(count(world, 0, 'refinery')).toBeGreaterThanOrEqual(2);
    expect(count(world, 0, 'barracks')).toBeGreaterThanOrEqual(1);
    expect(count(world, 0, 'factory')).toBeGreaterThanOrEqual(1);
    // clădirile lasă culoar de 1 tile între ele
    const bs = [...world.buildings.values()].filter((b) => b.team === 0 && b.type !== 'hq');
    for (const a of bs) for (const b of bs) {
      if (a.id >= b.id) continue;
      const gapX = Math.max(a.tx - (b.tx + b.w), b.tx - (a.tx + a.w));
      const gapY = Math.max(a.ty - (b.ty + b.h), b.ty - (a.ty + a.h));
      expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(1);
    }
  });

  it('atacul singur produce: cazarmă + fabrică și cel puțin 10 unități de luptă cu rol attack, fără ordine de la asistent', () => {
    const world = createWorld(setup());
    step(world, [toggle('attack')]);
    const bad: string[] = [];
    for (let i = 0; i < 20 * 60 * 3; i++) {
      step(world, []);
      for (const u of world.units.values()) {
        if (u.team === 0 && (u.order.kind === 'attack' || u.order.kind === 'attackMove' || u.order.kind === 'bombRun')) bad.push(u.order.kind);
      }
    }
    expect(count(world, 0, 'barracks')).toBeGreaterThanOrEqual(1);
    expect(count(world, 0, 'factory')).toBeGreaterThanOrEqual(1);
    const army = [...world.units.values()].filter((u) => u.team === 0 && ['tank', 'rocket', 'soldier', 'bazooka'].includes(u.type) && u.role === 'attack');
    expect(army.length).toBeGreaterThanOrEqual(10);
    expect(bad.length).toBe(0);
  });

  it('apărarea singură construiește turele și produce gardieni', () => {
    const world = createWorld(setup());
    place(world, 0, 'factory');
    place(world, 0, 'barracks');
    place(world, 0, 'refinery');
    place(world, 0, 'airfield');
    step(world, [toggle('defense')]);
    stepN(world, 20 * 60 * 2);
    expect(count(world, 0, 'turret')).toBeGreaterThanOrEqual(3);
    const guards = [...world.units.values()].filter((u) => u.team === 0 && u.role === 'guard');
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  it('toate trei pornite, 5 minute pe easy: baza supraviețuiește, fără comenzi umane', () => {
    const world = createWorld(setup(11, 'easy'));
    step(world, [toggle('economy'), toggle('defense'), toggle('attack')]);
    stepN(world, 20 * 60 * 5);
    expect([...world.buildings.values()].some((b) => b.team === 0 && b.type === 'hq')).toBe(true);
    expect(world.winner).not.toBe(1);
  }, 60000);

  it('cu asistentul oprit nu dă nicio comandă', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    for (let i = 0; i < 400; i++) {
      step(world, []);
      expect(runAssist(world, internal)).toEqual([]);
    }
    // și modul allIn singur nu face nimic
    step(world, [toggle('allIn')]);
    for (let i = 0; i < 400; i++) {
      step(world, []);
      expect(runAssist(world, internal)).toEqual([]);
    }
  });

  it('determinist cu asistentul pornit', () => {
    const run = (): number[] => {
      const world = createWorld(setup(21, 'easy'));
      const hs: number[] = [];
      for (let t = 1; t <= 2400; t++) {
        step(world, t === 1 ? [toggle('economy'), toggle('defense'), toggle('attack')] : []);
        if (t % 200 === 0) hs.push(hash(world));
      }
      return hs;
    };
    expect(run()).toEqual(run());
  }, 60000);
});

describe('roluri și gardieni', () => {
  it('comanda role ignoră recoltoarele și unitățile inamice', () => {
    const world = createWorld(setup());
    const harv = [...world.units.values()].find((u) => u.team === 0 && u.type === 'harvester') as Unit;
    const enemy = [...world.units.values()].find((u) => u.team === 1 && u.type === 'tank') as Unit;
    const mine = [...world.units.values()].find((u) => u.team === 0 && u.type === 'tank') as Unit;
    step(world, [{ t: 'role', team: 0, ids: [harv.id, enemy.id, mine.id], role: 'guard' }]);
    expect(harv.role).toBe('attack');
    expect(enemy.role).toBe('attack');
    expect(mine.role).toBe('guard');
  });

  it('gardienii răspund la un atac asupra rafinăriei și apoi se întorc la post; unitățile attack nu', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    for (const u of [...world.units.values()]) if (u.team === 1) world.units.delete(u.id);
    const tanks = [...world.units.values()].filter((u) => u.team === 0 && u.type === 'tank');
    const refinery = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'refinery')!;
    const guards = tanks.slice(0, 2);
    // al treilea tanc, rol attack, departe de rafinărie
    const striker = spawnUnit(world, internal, 0, 'tank', refinery.tx - 14, refinery.ty + 6, null);
    step(world, [{ t: 'role', team: 0, ids: guards.map((g) => g.id), role: 'guard' }]);
    const posts = guards.map((g) => ({ x: g.x, y: g.y }));
    const strikerStart = { x: striker.x, y: striker.y };
    const enemy = spawnUnit(world, internal, 1, 'tank', refinery.tx + 1.5, refinery.ty - 3, null);
    enemy.hp = 140; enemy.maxHp = 140;
    step(world, [{ t: 'attack', team: 1, ids: [enemy.id], targetId: refinery.id }]);
    let moved = 0;
    let killed = false;
    for (let i = 0; i < 20 * 25 && !killed; i++) {
      step(world, []);
      for (let k = 0; k < guards.length; k++) moved = Math.max(moved, Math.hypot(guards[k].x - posts[k].x, guards[k].y - posts[k].y));
      if (!world.units.has(enemy.id)) killed = true;
    }
    expect(killed).toBe(true);
    expect(moved).toBeGreaterThan(2);
    expect(Math.hypot(striker.x - strikerStart.x, striker.y - strikerStart.y)).toBeLessThan(1);
    stepN(world, 20 * 30);
    for (let k = 0; k < guards.length; k++) {
      expect(world.units.has(guards[k].id)).toBe(true);
      expect(Math.hypot(guards[k].x - posts[k].x, guards[k].y - posts[k].y)).toBeLessThan(3.5);
    }
  });

  it('un ordin move dat unui gardian îi mută postul; asistentul nu schimbă rolul setat de jucător', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    const tank = [...world.units.values()].find((u) => u.team === 0 && u.type === 'tank') as Unit;
    step(world, [{ t: 'role', team: 0, ids: [tank.id], role: 'guard' }]);
    const tx = tank.x + 5, ty = tank.y + 2;
    step(world, [{ t: 'move', team: 0, ids: [tank.id], x: tx, y: ty }]);
    expect(internal.guardPost.get(tank.id)).toEqual({ x: tx, y: ty });
    // jucătorul pune un tanc pe attack explicit; apărarea nu-l promovează
    const other = [...world.units.values()].filter((u) => u.team === 0 && u.type === 'tank')[1];
    step(world, [{ t: 'role', team: 0, ids: [other.id], role: 'attack' }, toggle('defense')]);
    stepN(world, 20 * 30);
    expect(other.role).toBe('attack');
  });
});
