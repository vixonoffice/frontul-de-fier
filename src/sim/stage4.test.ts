// Teste etapa 4 (pasul 1): tehnologie, artilerie, ziduri, Tesla, radar, asistent/AI cu conținutul nou.
import { describe, expect, it } from 'vitest';
import { canPlace, createWorld, step } from './index';
import { getInternal } from './internal';
import { buildBlockedGrid, findPath } from './path';
import { spawnBuilding, spawnUnit } from './economy';
import { TERRAIN_GROUND, TERRAIN_ROCK } from './types';
import type { Building, BuildingType, GameSetup, SimEvent, Team, World } from './types';

function setup(seed = 3): GameSetup {
  return {
    seed, mapSize: { w: 80, h: 80 }, mapStyle: 'open',
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

function stepN(world: World, n: number, collect?: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    step(world, []);
    if (collect) collect.push(...world.events);
  }
}

describe('tehnologie', () => {
  it('tancul greu și artileria cer laborator; turnul Tesla cere laborator, laboratorul radar', () => {
    const world = createWorld(setup());
    clearTeam(world, 1);
    place(world, 0, 'factory');
    place(world, 0, 'power');
    world.players[0].credits = 50000;
    step(world, [{ t: 'train', team: 0, unit: 'heavyTank' }, { t: 'train', team: 0, unit: 'artillery' }]);
    expect(world.players[0].production.units.length).toBe(0);
    step(world, [{ t: 'buildStart', team: 0, building: 'lab' }, { t: 'buildStart', team: 0, building: 'tesla' }]);
    expect(world.players[0].production.building).toBeNull(); // lab cere radar
    place(world, 0, 'radar');
    step(world, [{ t: 'buildStart', team: 0, building: 'lab' }]);
    expect(world.players[0].production.building?.type).toBe('lab');
    step(world, [{ t: 'buildCancel', team: 0 }]);
    place(world, 0, 'lab');
    step(world, [{ t: 'train', team: 0, unit: 'heavyTank' }, { t: 'train', team: 0, unit: 'artillery' }]);
    expect(world.players[0].production.units.map((s) => s.type)).toEqual(['heavyTank', 'artillery']);
    // laboratorul pierdut: ce e în coadă așteaptă, nu dispare
    for (const b of [...world.buildings.values()]) if (b.team === 0 && b.type === 'lab') world.buildings.delete(b.id);
    stepN(world, 20 * 30);
    expect(world.players[0].production.units.length).toBe(2);
    expect(world.players[0].production.units[0].progress).toBeLessThan(1);
  });

  it('tancul greu trage și în avioane', () => {
    const world = createWorld(setup());
    clearTeam(world, 0);
    clearTeam(world, 1);
    const internal = getInternal(world);
    const heavy = spawnUnit(world, internal, 0, 'heavyTank', 40, 40, null);
    const bomber = spawnUnit(world, internal, 1, 'bomber', 42, 40, null);
    bomber.alt = 3.2;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 60; i++) {
      bomber.x = 42; bomber.y = 40; bomber.alt = 3.2; bomber.order = { kind: 'idle' };
      step(world, []);
      ev.push(...world.events);
    }
    expect(ev.some((e) => e.type === 'fire' && e.sourceId === heavy.id)).toBe(true);
  });
});

describe('artilerie', () => {
  it('nu trage sub raza minimă (se retrage la ordin explicit) și obuzul nu urmărește ținta', () => {
    const world = createWorld(setup());
    clearTeam(world, 0);
    clearTeam(world, 1);
    const internal = getInternal(world);
    const art = spawnUnit(world, internal, 0, 'artillery', 40, 40, null);
    const prey = spawnUnit(world, internal, 1, 'tank', 42, 40, null);
    prey.hp = 100000; prey.maxHp = 100000;
    step(world, [{ t: 'attack', team: 0, ids: [art.id], targetId: prey.id }]);
    const events: SimEvent[] = [];
    let firedTooClose = false;
    for (let i = 0; i < 20 * 15; i++) {
      step(world, []);
      events.push(...world.events);
      prey.x = 42; prey.y = 40; // inamicul stă pe loc
      const d = Math.hypot(art.x - prey.x, art.y - prey.y);
      if (world.events.some((e) => e.type === 'fire' && e.sourceId === art.id) && d < 3.5 - 0.5) firedTooClose = true;
      if (events.some((e) => e.type === 'fire' && e.sourceId === art.id)) break;
    }
    expect(firedTooClose).toBe(false);
    expect(events.some((e) => e.type === 'fire' && e.sourceId === art.id && e.weapon === 'artillery')).toBe(true);
    expect(Math.hypot(art.x - 42, art.y - 40)).toBeGreaterThanOrEqual(3.3);
    // obuzul e în aer: mută ținta; locul de impact rămâne cel de la tragere
    const shell = world.projectiles.find((p) => p.kind === 'artillery');
    expect(shell).toBeDefined();
    const tx = shell!.tx, ty = shell!.ty;
    prey.x = 60; prey.y = 60;
    const hits: SimEvent[] = [];
    for (let i = 0; i < 20 * 5; i++) { prey.x = 60; prey.y = 60; step(world, []); hits.push(...world.events); }
    const hit = hits.find((e) => e.type === 'hit' && e.weapon === 'artillery');
    expect(hit).toBeDefined();
    if (hit && hit.type === 'hit') {
      expect(Math.hypot(hit.x - tx, hit.y - ty)).toBeLessThan(0.01);
      expect(Math.hypot(hit.x - 60, hit.y - 60)).toBeGreaterThan(10);
    }
    expect(prey.hp).toBe(100000);
  });

  it('inactivă, preferă clădirile și turelele în fața unităților', () => {
    const world = createWorld(setup());
    clearTeam(world, 0);
    clearTeam(world, 1);
    const internal = getInternal(world);
    const art = spawnUnit(world, internal, 0, 'artillery', 30, 30, null);
    art.hp = 100000; art.maxHp = 100000;
    // o turelă și un tanc în rază (și în câmpul vizual), la distanță de raza minimă
    const tur = spawnBuilding(world, internal, buildBlockedGrid(world), 1, 'turret', 35, 30);
    const tk = spawnUnit(world, internal, 1, 'tank', 34, 33, null);
    tk.hp = 100000; tk.maxHp = 100000;
    stepN(world, 8);
    const ev: SimEvent[] = [];
    stepN(world, 20 * 8, ev);
    const shot = world.projectiles.length === 0 ? null : world.projectiles[0];
    expect(ev.some((e) => e.type === 'fire' && e.sourceId === art.id)).toBe(true);
    void shot;
    // țintele alese: turela e lovită înaintea tancului
    expect(tur.hp).toBeLessThan(tur.maxHp);
    expect(tk.hp).toBe(100000);
  });
});

/** Teren de test: totul stâncă, un culoar orizontal de 2 tile-uri la y = 40..41. */
function corridorWorld(): World {
  const world = createWorld(setup());
  clearTeam(world, 0);
  clearTeam(world, 1);
  const { w, h, terrain, ore } = world.map;
  terrain.fill(TERRAIN_ROCK);
  ore.fill(0);
  for (let x = 5; x < w - 5; x++) { terrain[40 * w + x] = TERRAIN_GROUND; terrain[41 * w + x] = TERRAIN_GROUND; }
  void h;
  return world;
}

describe('ziduri', () => {
  it('blochează traseul la sol, iar un attack-move sparge zidul din cale', () => {
    const world = corridorWorld();
    const internal = getInternal(world);
    const { w, h } = world.map;
    const tank = spawnUnit(world, internal, 0, 'tank', 30.5, 40.5, null);
    // două ziduri inamice închid culoarul
    const w1 = spawnBuilding(world, internal, buildBlockedGrid(world), 1, 'wall', 38, 40);
    const w2 = spawnBuilding(world, internal, buildBlockedGrid(world), 1, 'wall', 38, 41);
    const blocked = buildBlockedGrid(world);
    expect(findPath(blocked, w, h, 30, 40, 50, 40)).toBeNull();
    step(world, [{ t: 'attackMove', team: 0, ids: [tank.id], x: 50.5, y: 40.5 }]);
    const ev: SimEvent[] = [];
    stepN(world, 20 * 120, ev);
    expect(world.buildings.has(w1.id) && world.buildings.has(w2.id)).toBe(false);
    expect(tank.x).toBeGreaterThan(45);
    expect(ev.some((e) => e.type === 'destroyed' && e.kind === 'building')).toBe(true);
  }, 60000);

  it('lanț de ziduri: după unul plasat începe singur următorul, până la buildCancel', () => {
    const world = createWorld(setup());
    clearTeam(world, 1);
    world.players[0].credits = 2000;
    step(world, [{ t: 'buildStart', team: 0, building: 'wall' }]);
    stepN(world, 20);
    expect(world.players[0].production.building?.ready).toBe(true);
    const hq = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!;
    const spots: Array<{ tx: number; ty: number }> = [];
    for (let dy = -3; dy <= 12 && spots.length < 4; dy++) {
      if (canPlace(world, 0, 'wall', hq.tx + 6, hq.ty + dy)) spots.push({ tx: hq.tx + 6, ty: hq.ty + dy });
    }
    expect(spots.length).toBe(4);
    const before = world.buildings.size;
    step(world, [{ t: 'buildPlace', team: 0, tx: spots[0].tx, ty: spots[0].ty }]);
    expect(world.buildings.size).toBe(before + 1);
    expect(world.players[0].production.building?.type).toBe('wall'); // următorul a pornit singur
    expect(world.players[0].credits).toBe(2000 - 200);
    stepN(world, 20);
    step(world, [{ t: 'buildPlace', team: 0, tx: spots[1].tx, ty: spots[1].ty }]);
    expect(world.players[0].production.building?.type).toBe('wall');
    step(world, [{ t: 'buildCancel', team: 0 }]);
    expect(world.players[0].production.building).toBeNull();
    // după anulare nu mai merge lanțul
    step(world, [{ t: 'buildStart', team: 0, building: 'turret' }]);
    stepN(world, 80);
    step(world, [{ t: 'buildPlace', team: 0, tx: spots[2].tx, ty: spots[2].ty }]);
    expect(world.players[0].production.building?.type).not.toBe('wall');
  });

  it('zidul nu ține un jucător în viață și nu e țintă automată', () => {
    const world = createWorld(setup());
    const internal = getInternal(world);
    for (const b of [...world.buildings.values()]) if (b.team === 1) world.buildings.delete(b.id);
    spawnBuilding(world, internal, buildBlockedGrid(world), 1, 'wall', 10, 10);
    stepN(world, 3);
    expect(world.players[1].defeated).toBe(true);
    expect(world.winner).toBe(0);
  });
});

describe('Tesla și radar', () => {
  function teslaWorld(powered: boolean): { world: World; tesla: Building } {
    const world = createWorld(setup());
    clearTeam(world, 0);
    clearTeam(world, 1);
    const internal = getInternal(world);
    place(world, 0, 'factory');
    place(world, 0, 'radar');
    place(world, 0, 'lab');
    if (powered) { place(world, 0, 'power'); place(world, 0, 'power'); }
    const tesla = place(world, 0, 'tesla');
    const e = spawnUnit(world, internal, 1, 'tank', tesla.tx + 4, tesla.ty + 0.5, null);
    e.hp = 100000; e.maxHp = 100000;
    return { world, tesla };
  }

  it('lovește instant: fire și hit în același tick', () => {
    const { world, tesla } = teslaWorld(true);
    let both = false;
    for (let i = 0; i < 80 && !both; i++) {
      step(world, []);
      const f = world.events.some((e) => e.type === 'fire' && e.sourceId === tesla.id && e.weapon === 'tesla');
      const h = world.events.some((e) => e.type === 'hit' && e.weapon === 'tesla');
      if (f && h) both = true;
      expect(world.projectiles.some((p) => p.kind === 'tesla')).toBe(false);
    }
    expect(both).toBe(true);
    const victim = [...world.units.values()].find((u) => u.team === 1)!;
    expect(victim.hp).toBeLessThan(100000);
  });

  it('nu trage deloc în lipsă de curent', () => {
    const { world, tesla } = teslaWorld(false);
    const ev: SimEvent[] = [];
    stepN(world, 20 * 15, ev);
    expect(world.players[0].power.used).toBeGreaterThan(world.players[0].power.made);
    expect(ev.some((e) => e.type === 'fire' && e.sourceId === tesla.id)).toBe(false);
  });

  it('Player.radar: fals fără radar și în lipsă de curent, adevărat cu radar alimentat', () => {
    const world = createWorld(setup());
    stepN(world, 3);
    expect(world.players[0].radar).toBe(false);
    place(world, 0, 'factory');
    place(world, 0, 'radar');
    stepN(world, 3);
    expect(world.players[0].radar).toBe(false); // curent insuficient
    place(world, 0, 'power');
    stepN(world, 3);
    expect(world.players[0].radar).toBe(true);
    for (const b of [...world.buildings.values()]) if (b.team === 0 && b.type === 'power') world.buildings.delete(b.id);
    stepN(world, 3);
    expect(world.players[0].radar).toBe(false);
  });
});
