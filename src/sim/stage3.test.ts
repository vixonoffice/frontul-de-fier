// Teste runda 4B/C/D: curent, grade, reparații, asistent (economie / apărare), hărți, joc 3-4 jucători.
import { describe, expect, it } from 'vitest';
import { canPlace, createWorld, hash, step } from './index';
import { getInternal } from './internal';
import { buildBlockedGrid } from './path';
import { spawnBuilding, spawnUnit } from './economy';
import { applyDamage, creditKill } from './combat';
import { generateMap } from './map';
import { refineryCap } from './baseplan';
import { REPAIR_COST_FACTOR, UNITS, VETERANCY } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { TERRAIN_GROUND } from './types';
import type { Building, BuildingType, Command, GameSetup, MapStyle, SimEvent, Team, World } from './types';

function setup(seed = 3, n = 2, ai = false, diff: 'easy' | 'normal' | 'hard' = 'normal', style: MapStyle = 'open', size = 80): GameSetup {
  const players: GameSetup['players'] = [];
  for (let i = 0; i < n; i++) players.push({ team: i as Team, isAI: ai, difficulty: diff });
  return { seed, mapSize: { w: size, h: size }, players, mapStyle: style };
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

function stepN(world: World, n: number, collect?: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    step(world, []);
    if (collect) collect.push(...world.events);
  }
}

function clearTeam(world: World, team: Team): void {
  for (const u of [...world.units.values()]) if (u.team === team) world.units.delete(u.id);
}

const count = (world: World, team: Team, type: BuildingType) => [...world.buildings.values()].filter((b) => b.team === team && b.type === type).length;

describe('B4: curent', () => {
  const ticksToTank = (withPlant: boolean): number => {
    const world = createWorld(setup(3));
    clearTeam(world, 1);
    place(world, 0, 'factory');
    if (withPlant) place(world, 0, 'power');
    world.players[0].credits = 10000;
    step(world, [{ t: 'train', team: 0, unit: 'tank' }]);
    for (let i = 0; i < 20 * 60; i++) {
      step(world, []);
      if (world.events.some((e) => e.type === 'unitReady' && e.unit === 'tank')) return i;
    }
    return -1;
  };
  it('lipsa de curent înjumătățește viteza producției, centrala o readuce', () => {
    const low = ticksToTank(false);
    const ok = ticksToTank(true);
    expect(ok).toBeGreaterThan(0);
    expect(low / ok).toBeGreaterThan(1.7);
    expect(low / ok).toBeLessThan(2.3);
  });

  it('emite lowPower și power.made/used reflectă clădirile', () => {
    const world = createWorld(setup(3));
    clearTeam(world, 1);
    place(world, 0, 'factory');
    const events: SimEvent[] = [];
    stepN(world, 3, events);
    expect(events.some((e) => e.type === 'lowPower' && e.on && e.team === 0)).toBe(true);
    expect(world.players[0].power.used).toBeGreaterThan(world.players[0].power.made);
    place(world, 0, 'power');
    const ev2: SimEvent[] = [];
    stepN(world, 3, ev2);
    expect(ev2.some((e) => e.type === 'lowPower' && !e.on && e.team === 0)).toBe(true);
  });
});

describe('B5: grade', () => {
  it('distrugerile promovează unitatea și cresc viața / dauna', () => {
    const world = createWorld(setup(3));
    const internal = getInternal(world);
    clearTeam(world, 0);
    clearTeam(world, 1);
    const tank = spawnUnit(world, internal, 0, 'tank', 40, 40, null);
    const events: SimEvent[] = [];
    for (let i = 0; i < VETERANCY.killsFor[0]; i++) creditKill(world, internal, tank.id);
    events.push(...world.events);
    expect(tank.rank).toBe(1);
    expect(tank.maxHp).toBeCloseTo(UNITS.tank.hp * VETERANCY.hpMult[1], 5);
    expect(tank.hp).toBeCloseTo(UNITS.tank.hp * VETERANCY.hpMult[1], 5);
    expect(events.some((e) => e.type === 'promoted' && e.rank === 1)).toBe(true);
    for (let i = VETERANCY.killsFor[0]; i < VETERANCY.killsFor[1]; i++) creditKill(world, internal, tank.id);
    expect(tank.rank).toBe(2);
    // dauna crește cu gradul
    const victim = spawnUnit(world, internal, 1, 'tank', 41, 40, null);
    victim.hp = 1000; victim.maxHp = 1000;
    applyDamage(world, internal, victim, 100, UNITS.tank.weapon!, tank.id);
    expect(1000 - victim.hp).toBeCloseTo(100 * VETERANCY.damageMult[2], 5);
    // elita se regenerează
    world.units.delete(victim.id);
    tank.hp = tank.maxHp - 50;
    stepN(world, 20 * 5);
    expect(tank.hp).toBeGreaterThan(tank.maxHp - 50 + VETERANCY.eliteRegenPerSec * 4);
  });

  it('o distrugere prin tragere e creditată unității care a tras', () => {
    const world = createWorld(setup(3));
    const internal = getInternal(world);
    clearTeam(world, 0);
    clearTeam(world, 1);
    const tank = spawnUnit(world, internal, 0, 'tank', 40, 40, null);
    const prey = spawnUnit(world, internal, 1, 'tank', 43, 40, null);
    prey.hp = 5;
    step(world, [{ t: 'attack', team: 0, ids: [tank.id], targetId: prey.id }]);
    stepN(world, 20 * 10);
    expect(world.units.has(prey.id)).toBe(false);
    expect(tank.kills).toBe(1);
  });
});

describe('B6: reparații', () => {
  it('costă proporțional, se oprește la viață plină și așteaptă când nu sunt bani', () => {
    const world = createWorld(setup(3));
    clearTeam(world, 1);
    clearTeam(world, 0); // fără recoltoare care să aducă bani
    const f = place(world, 0, 'factory');
    place(world, 0, 'power');
    f.hp = f.maxHp / 2;
    world.players[0].credits = 0;
    step(world, [{ t: 'repair', team: 0, id: f.id, on: true }]);
    stepN(world, 40);
    expect(f.hp).toBeCloseTo(f.maxHp / 2, 3); // fără bani nu se repară
    expect(f.repairing).toBe(true);
    world.players[0].credits = 10000;
    stepN(world, 20 * 30);
    expect(f.hp).toBe(f.maxHp);
    expect(f.repairing).toBe(false);
    const spent = 10000 - world.players[0].credits;
    expect(spent).toBeCloseTo(REPAIR_COST_FACTOR * BUILDINGS.factory.cost * 0.5, 0);
  });
});

describe('C: asistentul', () => {
  it('economia se oprește la plafonul de rafinării și ține 3 recoltoare per rafinărie', () => {
    const world = createWorld(setup(5));
    clearTeam(world, 1);
    world.players[0].credits = 30000;
    step(world, [{ t: 'assist', team: 0, mode: 'economy', on: true }]);
    stepN(world, 20 * 60 * 8);
    const internal = getInternal(world);
    const base = world.buildings.get([...world.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!.id)!;
    const cap = refineryCap(world, internal, { x: base.tx + 1.5, y: base.ty + 1.5 });
    const refs = count(world, 0, 'refinery');
    expect(refs).toBeGreaterThanOrEqual(2);
    expect(refs).toBeLessThanOrEqual(cap);
    const harvs = [...world.units.values()].filter((u) => u.team === 0 && UNITS[u.type].cargoCap > 0).length;
    expect(harvs).toBeGreaterThanOrEqual(3 * refs - 1);
    expect(harvs).toBeLessThanOrEqual(3 * refs + 1);
    // curent pozitiv
    expect(world.players[0].power.made).toBeGreaterThanOrEqual(world.players[0].power.used);
    // încă 2 minute: nu mai apar rafinării peste plafon
    stepN(world, 20 * 120);
    expect(count(world, 0, 'refinery')).toBeLessThanOrEqual(cap);
  }, 60000);

  it('apărarea pune turele pe cel puțin 3 laturi ale unei baze pe teren deschis', () => {
    const world = createWorld(setup(8));
    clearTeam(world, 1);
    // mută baza echipei 0 în mijlocul hărții și curăță terenul din jur
    const { w, terrain, ore } = world.map;
    const dx = 40 - Math.floor(world.map.starts[0].x), dy = 40 - Math.floor(world.map.starts[0].y);
    for (let y = 22; y < 60; y++) for (let x = 22; x < 60; x++) { terrain[y * w + x] = TERRAIN_GROUND; ore[y * w + x] = 0; }
    for (const b of world.buildings.values()) if (b.team === 0) { b.tx += dx; b.ty += dy; }
    for (const u of world.units.values()) if (u.team === 0) { u.x += dx; u.y += dy; }
    world.players[0].credits = 40000;
    step(world, [{ t: 'assist', team: 0, mode: 'defense', on: true }]);
    stepN(world, 20 * 60 * 6);
    const hq = [...world.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!;
    const bx = hq.tx + 1.5, by = hq.ty + 1.5;
    const turrets = [...world.buildings.values()].filter((b) => b.team === 0 && b.type === 'turret');
    expect(turrets.length).toBeGreaterThanOrEqual(4);
    const sides = new Set<string>();
    for (const t of turrets) {
      const ddx = t.tx - bx, ddy = t.ty - by;
      sides.add(Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'E' : 'W') : (ddy > 0 ? 'S' : 'N'));
    }
    expect(sides.size).toBeGreaterThanOrEqual(3);
    const guards = [...world.units.values()].filter((u) => u.team === 0 && u.role === 'guard');
    expect(guards.length).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('atacul singur nu dă niciun ordin de atac și își setează un punct de adunare', () => {
    const world = createWorld(setup(4));
    clearTeam(world, 1);
    world.players[0].credits = 20000;
    step(world, [{ t: 'assist', team: 0, mode: 'attack', on: true }]);
    stepN(world, 20 * 60 * 2);
    expect(world.players[0].production.rally).not.toBeNull();
    for (const u of world.units.values()) {
      if (u.team === 0) expect(['attack', 'attackMove', 'bombRun']).not.toContain(u.order.kind);
    }
  }, 60000);
});

describe('hărți', () => {
  const styles: MapStyle[] = ['open', 'passes', 'lakes', 'islands'];
  const sizes = [64, 80, 96];

  function connectedAll(map: ReturnType<typeof generateMap>): boolean {
    const { w, h, terrain, starts } = map;
    const seen = new Uint8Array(w * h);
    const s0 = Math.floor(starts[0].y) * w + Math.floor(starts[0].x);
    const stack = [s0];
    seen[s0] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (seen[k] || terrain[k] !== TERRAIN_GROUND) continue;
        seen[k] = 1;
        stack.push(k);
      }
    }
    return starts.every((s) => seen[Math.floor(s.y) * w + Math.floor(s.x)] === 1);
  }

  it('startul fiecărui jucător e conectat, corect (minereu egal) și construibil, pe toate stilurile / mărimile / numerele de jucători', () => {
    for (const style of styles) for (const size of sizes) for (const n of [2, 3, 4]) {
      for (let seed = 1; seed <= 10; seed++) {
        const s = setup(seed, n, true, 'normal', style, size);
        const map = generateMap({ rng: seed }, s);
        const tag = `${style} ${size} n${n} seed${seed}`;
        expect(map.starts.length, tag).toBe(n);
        expect(connectedAll(map), tag).toBe(true);
        const sums: number[] = [];
        for (const st of map.starts) {
          const sx = Math.floor(st.x), sy = Math.floor(st.y);
          // teren construibil: HQ (3x3) + rafinărie (3x2) din createWorld
          for (let y = sy - 4; y <= sy - 2; y++) for (let x = sx - 4; x <= sx - 2; x++) expect(map.terrain[y * map.w + x], tag).toBe(TERRAIN_GROUND);
          for (let y = sy - 5; y <= sy - 4; y++) for (let x = sx; x <= sx + 2; x++) expect(map.terrain[y * map.w + x], tag).toBe(TERRAIN_GROUND);
          let sum = 0;
          for (let y = Math.max(0, sy - 16); y <= Math.min(map.h - 1, sy + 16); y++) for (let x = Math.max(0, sx - 16); x <= Math.min(map.w - 1, sx + 16); x++) {
            if (Math.sqrt((x - sx) ** 2 + (y - sy) ** 2) <= 16) sum += map.ore[y * map.w + x];
          }
          sums.push(sum);
        }
        const mx = Math.max(...sums), mn = Math.min(...sums);
        expect(mn, tag).toBeGreaterThan(0);
        expect(mx / mn, tag).toBeLessThan(1.35);
      }
    }
  });

  it('pozițiile de start diferă între seed-uri, iar omul nu e mereu în același loc', () => {
    const humanStarts = new Set<string>();
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const map = generateMap({ rng: seed }, setup(seed, 2, true, 'normal', 'random'));
      humanStarts.add(`${map.starts[0].x},${map.starts[0].y}`);
      layouts.add(JSON.stringify(map.starts));
    }
    expect(humanStarts.size).toBeGreaterThanOrEqual(2);
    expect(layouts.size).toBeGreaterThanOrEqual(2);
  });

  it('stilul random alege stiluri diferite după seed', () => {
    const sig = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const map = generateMap({ rng: seed }, setup(seed, 2, true, 'normal', 'random'));
      let water = 0, rock = 0;
      for (const t of map.terrain) { if (t === 2) water++; if (t === 1) rock++; }
      sig.add(`${Math.round(water / 400)}-${Math.round(rock / 400)}`);
    }
    expect(sig.size).toBeGreaterThanOrEqual(3);
  });
});

describe('joc 3-4 jucători (FFA)', () => {
  it('determinist: același seed și comenzi dau același hash, cu 4 echipe, asistent și AI', () => {
    const run = (): number[] => {
      const world = createWorld({
        seed: 31, mapSize: { w: 80, h: 80 }, mapStyle: 'random',
        players: [
          { team: 0, isAI: false, difficulty: 'normal' },
          { team: 1, isAI: true, difficulty: 'hard' },
          { team: 2, isAI: true, difficulty: 'normal' },
          { team: 3, isAI: true, difficulty: 'easy' },
        ],
      });
      const hs: number[] = [];
      for (let t = 1; t <= 3000; t++) {
        const cmds: Command[] = t === 1 ? [
          { t: 'assist', team: 0, mode: 'economy', on: true },
          { t: 'assist', team: 0, mode: 'defense', on: true },
          { t: 'assist', team: 0, mode: 'attack', on: true },
        ] : [];
        step(world, cmds);
        if (t % 250 === 0) hs.push(hash(world));
      }
      return hs;
    };
    expect(run()).toEqual(run());
  }, 60000);

  it('tick-ul cu 4 AI rămâne în buget', () => {
    const world = createWorld(setup(12, 4, true, 'normal', 'open'));
    const t0 = performance.now();
    stepN(world, 2000);
    const ms = (performance.now() - t0) / 2000;
    // eslint-disable-next-line no-console
    console.log(`4 AI: ${ms.toFixed(3)} ms/tick`);
    expect(ms).toBeLessThan(8);
  }, 60000);

  it('un joc cu 4 AI normale se termină cu exact un câștigător în 30 de minute (cel puțin 3 din 4 seed-uri)', () => {
    let ok = 0;
    const lines: string[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const world = createWorld(setup(seed, 4, true, 'normal', 'random'));
      let t = 0;
      for (; t < 20 * 60 * 30 && world.winner === null; t++) step(world, []);
      const alive = world.players.filter((p) => !p.defeated).length;
      lines.push(`seed ${seed}: winner=${world.winner} alive=${alive} at ${(t / 1200).toFixed(1)} min`);
      if (world.winner !== null && alive === 1) ok++;
    }
    // eslint-disable-next-line no-console
    console.log('FFA4: ' + lines.join(' | '));
    expect(ok).toBeGreaterThanOrEqual(3);
  }, 300000);
});

describe('AI: hard contra normal', () => {
  it('hard bate normal în AI-vs-AI pe cel puțin 3 din 4 seed-uri (părțile alternează)', () => {
    let hardWins = 0;
    const lines: string[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const hardTeam = (seed % 2) as Team;
      const world = createWorld({
        seed, mapSize: { w: 80, h: 80 }, mapStyle: 'random',
        players: [
          { team: 0, isAI: true, difficulty: hardTeam === 0 ? 'hard' : 'normal' },
          { team: 1, isAI: true, difficulty: hardTeam === 1 ? 'hard' : 'normal' },
        ],
      });
      let t = 0;
      for (; t < 20 * 60 * 20 && world.winner === null; t++) step(world, []);
      lines.push(`seed ${seed}: winner=${world.winner} (hard=${hardTeam}) at ${(t / 1200).toFixed(1)} min`);
      if (world.winner === hardTeam) hardWins++;
    }
    // eslint-disable-next-line no-console
    console.log('hard vs normal: ' + lines.join(' | '));
    expect(hardWins).toBeGreaterThanOrEqual(3);
  }, 300000);
});
