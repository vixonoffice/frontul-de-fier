// Teste etapa 2: infanterie, aviație, cerințe de clădiri, recoltor, determinism, AI.
import { describe, expect, it } from 'vitest';
import { canPlace, createWorld, hash, step } from './index';
import { getHarvestState, getInternal } from './internal';
import { buildBlockedGrid } from './path';
import { spawnBuilding, spawnUnit } from './economy';
import { parkBomberAt } from './air';
import { applyDamage, findTarget } from './combat';
import { _test as aiTest } from './ai';
import { AIR_ALTITUDE, BOMBER_PAYLOAD, BOMBER_RELOAD_TIME, BOMBERS_PER_AIRFIELD, UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import type { Building, BuildingType, Command, GameSetup, SimEvent, Team, Unit, World } from './types';

function setup(seed = 3, ai = false, diff: 'easy' | 'normal' | 'hard' = 'normal'): GameSetup {
  return {
    seed,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: ai, difficulty: diff },
      { team: 1, isAI: ai, difficulty: diff },
    ],
  };
}

/** Plasează direct o clădire lângă HQ-ul echipei (ocolește producția), pe primul loc valid. */
function place(world: World, team: Team, type: BuildingType): Building {
  const hq = [...world.buildings.values()].find((b) => b.team === team && b.type === 'hq')!;
  for (let r = 3; r < 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = hq.tx + dx, ty = hq.ty + dy;
        if (canPlace(world, team, type, tx, ty)) {
          return spawnBuilding(world, getInternal(world), buildBlockedGrid(world), team, type, tx, ty);
        }
      }
    }
  }
  throw new Error('nu s-a găsit loc pentru ' + type);
}

function stepN(world: World, n: number, collect?: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    step(world, []);
    if (collect) collect.push(...world.events);
  }
}

function clearTeamUnits(world: World, team: Team): void {
  for (const u of [...world.units.values()]) if (u.team === team) world.units.delete(u.id);
}

describe('stage 2: producție', () => {
  it('infanteria se produce la cazarmă în paralel cu coada fabricii', () => {
    const world = createWorld(setup());
    place(world, 0, 'power'); // altfel lipsa de curent încetinește producția
    place(world, 0, 'factory');
    place(world, 0, 'barracks');
    world.players[0].credits = 5000;
    step(world, [{ t: 'train', team: 0, unit: 'tank' }, { t: 'train', team: 0, unit: 'soldier' }]);
    expect(world.players[0].production.units.length).toBe(1);
    expect(world.players[0].production.infantry.length).toBe(1);
    stepN(world, 10);
    expect(world.players[0].production.units[0].progress).toBeGreaterThan(0);
    expect(world.players[0].production.infantry[0].progress).toBeGreaterThan(0);

    const events: SimEvent[] = [];
    stepN(world, 30, events); // soldatul (1,5 s) iese înaintea tancului (3 s)
    const readyTypes = events.filter((e) => e.type === 'unitReady').map((e) => (e as { unit: string }).unit);
    expect(readyTypes).toContain('soldier');
    expect(readyTypes).not.toContain('tank');
    stepN(world, 100, events);
    expect(events.filter((e) => e.type === 'unitReady' && e.unit === 'tank').length).toBe(1);
  });

  it('trainCancel rambursează integral din coada corectă', () => {
    const world = createWorld(setup());
    place(world, 0, 'barracks');
    const before = world.players[0].credits;
    step(world, [{ t: 'train', team: 0, unit: 'bazooka' }]);
    expect(world.players[0].credits).toBe(before - UNITS.bazooka.cost);
    step(world, [{ t: 'trainCancel', team: 0, unit: 'bazooka' }]);
    expect(world.players[0].credits).toBe(before);
    expect(world.players[0].production.infantry.length).toBe(0);
  });

  it('un soldat nu se poate antrena fără cazarmă', () => {
    const world = createWorld(setup());
    const before = world.players[0].credits;
    step(world, [{ t: 'train', team: 0, unit: 'soldier' }]);
    expect(world.players[0].credits).toBe(before);
    expect(world.players[0].production.infantry.length).toBe(0);
  });

  it('buildStart respectă requires și buildCancel rambursează', () => {
    const world = createWorld(setup());
    world.players[0].credits = 10000;
    step(world, [{ t: 'buildStart', team: 0, building: 'airfield' }]); // cere fabrică
    expect(world.players[0].production.building).toBeNull();
    expect(world.players[0].credits).toBe(10000);
    step(world, [{ t: 'buildStart', team: 0, building: 'rocketTurret' }]); // cere fabrică
    expect(world.players[0].production.building).toBeNull();
    place(world, 0, 'factory');
    step(world, [{ t: 'buildStart', team: 0, building: 'airfield' }]);
    expect(world.players[0].production.building?.type).toBe('airfield');
    expect(world.players[0].credits).toBe(10000 - BUILDINGS.airfield.cost);
    step(world, [{ t: 'buildCancel', team: 0 }]);
    expect(world.players[0].credits).toBe(10000);
  });

  it('maxim BOMBERS_PER_AIRFIELD bombardiere per aerodrom (vii + în coadă)', () => {
    const world = createWorld(setup());
    place(world, 0, 'factory');
    place(world, 0, 'airfield');
    world.players[0].credits = 100000;
    const train: Command = { t: 'train', team: 0, unit: 'bomber' };
    for (let i = 0; i < 5; i++) step(world, [train]);
    expect(world.players[0].production.air.length).toBe(BOMBERS_PER_AIRFIELD);
    stepN(world, 20 * 14 * BOMBERS_PER_AIRFIELD + 40);
    const bombers = [...world.units.values()].filter((u) => u.type === 'bomber');
    expect(bombers.length).toBe(BOMBERS_PER_AIRFIELD);
    step(world, [train]);
    expect(world.players[0].production.air.length).toBe(0); // plin: nu mai intră altele
    // al doilea aerodrom => încă 3
    place(world, 0, 'airfield');
    for (let i = 0; i < 5; i++) step(world, [train]);
    expect(world.players[0].production.air.length).toBe(BOMBERS_PER_AIRFIELD);
    // bombardierele parcate stau pe locuri distincte
    const spots = new Set(bombers.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)}`));
    expect(spots.size).toBe(bombers.length);
    for (const b of bombers) expect(b.alt).toBe(0);
  });
});

describe('stage 2: ținte aer/sol', () => {
  it('tancul și turela nu țintesc bombardiere în zbor; rocketTurret și antitancul da', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    clearTeamUnits(world, 0);
    clearTeamUnits(world, 1);
    const bomber = spawnUnit(world, internal, 1, 'bomber', 40, 40, null);
    bomber.alt = AIR_ALTITUDE;
    const tank = spawnUnit(world, internal, 0, 'tank', 39, 40, null);
    const bazooka = spawnUnit(world, internal, 0, 'bazooka', 39, 41, null);
    const tb = spawnBuilding(world, internal, buildBlockedGrid(world), 0, 'turret', 38, 38);
    const rt = spawnBuilding(world, internal, buildBlockedGrid(world), 0, 'rocketTurret', 38, 43);
    place(world, 0, 'power'); // fără lipsă de curent
    stepN(world, 8);
    const events: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      // menține bombardierul pe loc, în zbor
      bomber.x = 40; bomber.y = 40; bomber.alt = AIR_ALTITUDE; bomber.hp = 180; bomber.order = { kind: 'idle' };
      step(world, []);
      events.push(...world.events);
    }
    const fired = (id: number) => events.some((e) => e.type === 'fire' && e.sourceId === id);
    expect(fired(tank.id)).toBe(false);
    expect(fired(tb.id)).toBe(false);
    expect(fired(bazooka.id)).toBe(true);
    expect(fired(rt.id)).toBe(true);
    expect(findTarget(world, 0, { x: 39, y: 40 }, 6, undefined, undefined, undefined, UNITS.tank.weapon!)).toBeNull();
  });

  it('bazooka preferă vehiculele, pușca preferă infanteria', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    clearTeamUnits(world, 0);
    clearTeamUnits(world, 1);
    const inf = spawnUnit(world, internal, 1, 'soldier', 41, 40, null);
    const veh = spawnUnit(world, internal, 1, 'tank', 43.5, 40, null);
    spawnUnit(world, internal, 0, 'soldier', 40, 40, null);
    stepN(world, 8);
    const from = { x: 40, y: 40 };
    expect(findTarget(world, 0, from, 5, undefined, undefined, undefined, UNITS.bazooka.weapon!)?.id).toBe(veh.id);
    expect(findTarget(world, 0, from, 5, undefined, undefined, undefined, UNITS.soldier.weapon!)?.id).toBe(inf.id);
  });

  it('un bombardier parcat (alt 0) poate fi lovit de tun', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    clearTeamUnits(world, 0);
    clearTeamUnits(world, 1);
    const af = place(world, 1, 'airfield');
    const bomber = spawnUnit(world, internal, 1, 'bomber', 40, 40, null);
    parkBomberAt(internal, bomber, af, 0);
    spawnUnit(world, internal, 0, 'tank', bomber.x - 2, bomber.y, null);
    stepN(world, 8);
    expect(bomber.alt).toBe(0);
    expect(findTarget(world, 0, { x: bomber.x - 2, y: bomber.y }, 6, undefined, undefined, undefined, UNITS.tank.weapon!)?.id).toBe(bomber.id);
  });
});

describe('stage 2: raid de bombardament', () => {
  it('decolare, bombe pe clădire, întoarcere, parcare și reîncărcare', () => {
    const world = createWorld(setup());
    clearTeamUnits(world, 1); // fără lansatoare inamice care să-l doboare
    place(world, 0, 'factory');
    const airfield = place(world, 0, 'airfield');
    world.players[0].credits = 10000;
    step(world, [{ t: 'train', team: 0, unit: 'bomber' }]);
    stepN(world, 20 * 15);
    const bomber = [...world.units.values()].find((u) => u.type === 'bomber' && u.team === 0) as Unit;
    expect(bomber).toBeDefined();
    expect(bomber.alt).toBe(0);
    expect(bomber.ammo).toBe(BOMBER_PAYLOAD);
    expect(bomber.x).toBeGreaterThanOrEqual(airfield.tx);
    expect(bomber.x).toBeLessThanOrEqual(airfield.tx + airfield.w);

    const target = [...world.buildings.values()].find((b) => b.team === 1 && b.type === 'refinery')!;
    const hp0 = target.hp;
    const tc = { x: target.tx + target.w / 2, y: target.ty + target.h / 2 };
    step(world, [{ t: 'bomb', team: 0, ids: [bomber.id], x: tc.x, y: tc.y }]);
    expect(bomber.order.kind).toBe('bombRun');

    const events: SimEvent[] = [];
    let maxAlt = 0;
    let sawAmmoEmpty = false;
    let parkedTick = -1;
    for (let i = 0; i < 20 * 120 && parkedTick < 0; i++) {
      step(world, []);
      events.push(...world.events);
      maxAlt = Math.max(maxAlt, bomber.alt);
      if (bomber.ammo === 0) sawAmmoEmpty = true;
      if (sawAmmoEmpty && bomber.order.kind === 'idle' && bomber.alt === 0) parkedTick = world.tick;
    }
    expect(maxAlt).toBeCloseTo(AIR_ALTITUDE, 1);
    expect(events.filter((e) => e.type === 'fire' && e.weapon === 'bomb').length).toBe(BOMBER_PAYLOAD);
    expect(events.filter((e) => e.type === 'hit' && e.weapon === 'bomb').length).toBe(BOMBER_PAYLOAD);
    expect(target.hp).toBeLessThan(hp0);
    expect(parkedTick).toBeGreaterThan(0);
    expect(world.units.has(bomber.id)).toBe(true);
    expect(bomber.hp).toBe(bomber.maxHp);
    expect(bomber.ammo).toBe(0);

    stepN(world, Math.ceil(BOMBER_RELOAD_TIME * 20) + 5);
    expect(bomber.ammo).toBe(BOMBER_PAYLOAD);
  });

  it('fără aerodrom bombardierul în zbor se rotește lângă bază și nu crapă', () => {
    const world = createWorld(setup());
    clearTeamUnits(world, 1);
    const internal = getInternal(world);
    const hq = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!;
    const b = spawnUnit(world, internal, 0, 'bomber', hq.tx + 1.5, hq.ty + 1.5, null);
    b.alt = AIR_ALTITUDE;
    b.order = { kind: 'move', x: hq.tx + 20, y: hq.ty };
    stepN(world, 20 * 60);
    expect(world.units.has(b.id)).toBe(true);
    expect(b.alt).toBeCloseTo(AIR_ALTITUDE, 1);
    expect(Math.hypot(b.x - (hq.tx + 1.5), b.y - (hq.ty + 1.5))).toBeLessThan(14);
    expect(b.ammo).toBeGreaterThan(0);
  });

  it('attack pe o clădire devine raid de bombardament', () => {
    const world = createWorld(setup());
    clearTeamUnits(world, 1);
    place(world, 0, 'factory');
    place(world, 0, 'airfield');
    world.players[0].credits = 10000;
    step(world, [{ t: 'train', team: 0, unit: 'bomber' }]);
    stepN(world, 20 * 15);
    const bomber = [...world.units.values()].find((u) => u.type === 'bomber') as Unit;
    const target = [...world.buildings.values()].find((x) => x.team === 1 && x.type === 'hq')!;
    step(world, [{ t: 'attack', team: 0, ids: [bomber.id], targetId: target.id }]);
    expect(bomber.order.kind).toBe('bombRun');
  });
});

describe('stage 2: recoltor', () => {
  it('fuge sub foc, nu reia până nu trec câteva secunde fără daună, apoi reia recoltarea', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    const harv = [...world.units.values()].find((u) => u.team === 0 && u.type === 'harvester') as Unit;
    const weapon = UNITS.tank.weapon!;
    step(world, [{ t: 'move', team: 0, ids: [harv.id], x: harv.x + 3, y: harv.y }]);
    let idleWhileHit = false;
    for (let i = 0; i < 150; i++) {
      applyDamage(world, internal, harv, 1, weapon); // atacatorul lovește în continuu
      step(world, []);
      if (i > 120 && harv.order.kind === 'idle') idleWhileHit = true;
    }
    expect(idleWhileHit).toBe(true); // a ajuns, dar încă e sub foc: stă
    let resumed = false;
    for (let i = 0; i < 200 && !resumed; i++) {
      step(world, []);
      if (harv.order.kind === 'harvest') resumed = true;
    }
    expect(resumed).toBe(true);
    const credits = world.players[0].credits;
    stepN(world, 20 * 120);
    expect(world.players[0].credits).toBeGreaterThan(credits);
  });

  it('un recoltor oprit (idle) reia singur recoltarea', () => {
    const world = createWorld(setup());
    const harv = [...world.units.values()].find((u) => u.team === 0 && u.type === 'harvester') as Unit;
    step(world, [{ t: 'stop', team: 0, ids: [harv.id] }]);
    expect(harv.order.kind).toBe('idle');
    stepN(world, 20 * 6);
    expect(harv.order.kind).toBe('harvest');
  });

  it('comanda harvest trimite recoltorul la minereul cel mai apropiat de punct și continuă bucla', () => {
    const world = createWorld(setup(7));
    const internal = getInternal(world);
    const harv = [...world.units.values()].find((u) => u.team === 0 && u.type === 'harvester') as Unit;
    const { w, ore } = world.map;
    // alege un tile de minereu îndepărtat de recoltor
    let far = -1, farD = -1;
    for (let i = 0; i < ore.length; i++) {
      if (ore[i] <= 0) continue;
      const d = Math.hypot((i % w) - harv.x, ((i / w) | 0) - harv.y);
      if (d > farD) { farD = d; far = i; }
    }
    expect(far).toBeGreaterThanOrEqual(0);
    const fx = (far % w) + 0.5, fy = ((far / w) | 0) + 0.5;
    step(world, [{ t: 'harvest', team: 0, ids: [harv.id], x: fx + 1, y: fy }]);
    expect(harv.order.kind).toBe('harvest');
    const tile = getHarvestState(internal, harv.id).oreTile;
    expect(tile).toBeGreaterThanOrEqual(0);
    expect(Math.hypot((tile % w) - fx, ((tile / w) | 0) - fy)).toBeLessThan(5);
    const credits = world.players[0].credits;
    let mined = false;
    for (let i = 0; i < 20 * 200; i++) {
      step(world, []);
      if (harv.carry > 0) mined = true;
    }
    expect(mined).toBe(true);
    expect(world.players[0].credits).toBeGreaterThan(credits);
    expect(harv.order.kind).toBe('harvest');
  });
});

describe('stage 2: determinism și AI', () => {
  it('aceeași sămânță + comenzi cu unități noi => același hash', () => {
    const run = (): { hashes: number[]; bombs: number } => {
      const world = createWorld(setup(21));
      place(world, 0, 'factory');
      place(world, 0, 'barracks');
      place(world, 0, 'airfield');
      place(world, 1, 'rocketTurret');
      world.players[0].credits = 20000;
      const hashes: number[] = [];
      let bombs = 0;
      for (let t = 1; t <= 1500; t++) {
        const cmds: Command[] = [];
        if (t === 1) cmds.push({ t: 'train', team: 0, unit: 'bomber' }, { t: 'train', team: 0, unit: 'soldier' }, { t: 'train', team: 0, unit: 'bazooka' });
        if (t === 400) {
          const ids = [...world.units.values()].filter((u) => u.team === 0 && (u.type === 'bomber' || u.type === 'soldier' || u.type === 'bazooka')).map((u) => u.id);
          const tgt = [...world.buildings.values()].find((b) => b.team === 1 && b.type === 'refinery')!;
          const air = ids.filter((id) => world.units.get(id)!.type === 'bomber');
          cmds.push({ t: 'bomb', team: 0, ids: air, x: tgt.tx + 1, y: tgt.ty + 1 });
          cmds.push({ t: 'attackMove', team: 0, ids: ids.filter((id) => !air.includes(id)), x: tgt.tx, y: tgt.ty });
        }
        step(world, cmds);
        bombs += world.events.filter((e) => e.type === 'fire' && e.weapon === 'bomb').length;
        if (t % 100 === 0) hashes.push(hash(world));
      }
      return { hashes, bombs };
    };
    const a = run();
    const b = run();
    expect(a.hashes).toEqual(b.hashes);
    expect(a.bombs).toBeGreaterThan(0);
  });

  it('pe easy primul val vine mai târziu și e mai mic decât pe normal', () => {
    const { easy, normal } = aiTest.AI_PARAMS;
    expect(easy.firstWave).toBeGreaterThan(normal.firstWave);
    expect(easy.waveBaseSize).toBeLessThan(normal.waveBaseSize);
  });

  it('AI vs AI pe normal se termină cu un câștigător în 20 de minute', () => {
    for (const seed of [777, 5]) {
      const world = createWorld(setup(seed, true, 'normal'));
      let sawBarracks = false;
      for (let t = 1; t <= 20 * 60 * 20 && world.winner === null; t++) {
        step(world, []);
        if (t % 200 === 0 && [...world.buildings.values()].some((b) => b.type === 'barracks')) sawBarracks = true;
      }
      expect(world.winner, `seed ${seed}`).not.toBeNull();
      expect(sawBarracks).toBe(true);
    }
  }, 120000);
});
