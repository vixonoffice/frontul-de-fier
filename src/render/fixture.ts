// Lume de test construita manual, dupa tipurile din src/sim/types.ts, plus un animator
// simplu (NU simularea reala — doar cat sa miste unitati, sa traga si sa produca
// evenimente, ca randarea sa poata fi dezvoltata si testata izolat).
import {
  TERRAIN_GROUND, TERRAIN_ROCK, TERRAIN_WATER, TICK_RATE,
  type World, type MapData, type Unit, type Building, type Player, type Production,
  type EntityId, type Team, type UnitType, type BuildingType, type Vec,
} from '../sim/types';

const MAP_W = 80;
const MAP_H = 80;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildMap(): MapData {
  const w = MAP_W, h = MAP_H;
  const terrain = new Uint8Array(w * h).fill(TERRAIN_GROUND);
  const height = new Float32Array(w * h);
  const ore = new Uint16Array(w * h);
  const rnd = mulberry32(1234);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n =
        Math.sin(x * 0.09) * 0.5 + Math.sin(y * 0.11 + 1.3) * 0.5 +
        Math.sin((x + y) * 0.045) * 0.6 + Math.sin((x - y) * 0.06) * 0.4;
      height[y * w + x] = Math.max(0, Math.min(1, 0.5 + n * 0.22));
    }
  }

  const rockClusters: [number, number, number][] = [[20, 14, 5], [55, 20, 6], [30, 55, 5], [60, 60, 4], [15, 45, 4]];
  for (const [cx, cy, r] of rockClusters) {
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1 && rnd() > d * 0.6) terrain[y * w + x] = TERRAIN_ROCK;
      }
    }
  }

  const pondCx = 40, pondCy = 38, pondR = 9;
  for (let y = Math.max(0, pondCy - pondR); y < Math.min(h, pondCy + pondR); y++) {
    for (let x = Math.max(0, pondCx - pondR); x < Math.min(w, pondCx + pondR); x++) {
      const d = Math.hypot((x - pondCx) / 1.3, y - pondCy) / pondR;
      if (d < 0.8 + rnd() * 0.15) terrain[y * w + x] = TERRAIN_WATER;
    }
  }

  const oreFields: [number, number, number][] = [[14, 20, 4], [66, 16, 4], [40, 65, 4], [20, 68, 3], [62, 42, 3]];
  for (const [cx, cy, r] of oreFields) {
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
        if (terrain[y * w + x] !== TERRAIN_GROUND) continue;
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1) ore[y * w + x] = Math.round((1 - d) * 420 + rnd() * 60);
      }
    }
  }

  const starts: Vec[] = [{ x: 11, y: 11 }, { x: 69, y: 69 }];
  return { w, h, terrain, height, ore, starts };
}

let idCounter = 1;
function nextId(): EntityId { return idCounter++; }

function makeUnit(type: UnitType, team: Team, x: number, y: number, opts: Partial<Unit> = {}): Unit {
  const maxHp = type === 'tank' ? 420 : type === 'rocket' ? 260 : 300;
  return {
    id: nextId(), kind: 'unit', type, team, x, y,
    angle: opts.angle ?? Math.random() * Math.PI * 2,
    turretAngle: opts.turretAngle ?? 0,
    hp: opts.hp ?? maxHp, maxHp,
    order: opts.order ?? { kind: 'idle' },
    path: opts.path ?? [],
    carry: opts.carry ?? 0,
    cooldown: opts.cooldown ?? Math.floor(Math.random() * 40),
    lastFireTick: opts.lastFireTick ?? -999,
    moving: opts.moving ?? false,
  };
}

function makeBuilding(type: BuildingType, team: Team, tx: number, ty: number, builtTick = -999): Building {
  const size = type === 'turret' ? 1 : 3;
  const maxHp = type === 'hq' ? 2600 : type === 'factory' ? 1800 : type === 'refinery' ? 1500 : 900;
  return {
    id: nextId(), kind: 'building', type, team, tx, ty, w: size, h: size,
    hp: maxHp, maxHp, turretAngle: 0, cooldown: 0, lastFireTick: -999, builtTick,
  };
}

function emptyProduction(): Production {
  return { building: null, units: [], rally: null };
}

export function createFixtureWorld(): World {
  idCounter = 1;
  const map = buildMap();
  const units = new Map<EntityId, Unit>();
  const buildings = new Map<EntityId, Building>();

  // --- baze ---
  const b1 = makeBuilding('hq', 0, 9, 9, -400);
  const b2 = makeBuilding('refinery', 0, 13, 9);
  const b3 = makeBuilding('factory', 0, 9, 13);
  const b4 = makeBuilding('turret', 0, 13, 13);
  const b5 = makeBuilding('turret', 0, 7, 16, 60); // se ridica din teren in primele 3s (demo)
  for (const b of [b1, b2, b3, b4, b5]) buildings.set(b.id, b);

  const r1 = makeBuilding('hq', 1, 68, 68, -400);
  const r2 = makeBuilding('refinery', 1, 64, 68);
  const r3 = makeBuilding('factory', 1, 68, 64);
  const r4 = makeBuilding('turret', 1, 64, 64);
  const r5 = makeBuilding('turret', 1, 71, 61, 60);
  for (const b of [r1, r2, r3, r4, r5]) buildings.set(b.id, b);

  // --- unitati echipa 0 (albastru) ---
  const t0: EntityId[] = [];
  for (let i = 0; i < 9; i++) {
    const u = makeUnit('tank', 0, 10 + (i % 3) * 1.4, 18 + Math.floor(i / 3) * 1.4);
    t0.push(u.id);
    units.set(u.id, u);
  }
  for (let i = 0; i < 5; i++) {
    const u = makeUnit('rocket', 0, 16 + (i % 2) * 1.4, 10 + Math.floor(i / 2) * 1.4);
    t0.push(u.id);
    units.set(u.id, u);
  }
  for (let i = 0; i < 3; i++) {
    const u = makeUnit('harvester', 0, 14, 20 + i * 1.6, { carry: i === 0 ? 0.9 : i === 1 ? 0.3 : 0, order: { kind: 'harvest', phase: i === 1 ? 'toRefinery' : 'mining' } });
    t0.push(u.id);
    units.set(u.id, u);
  }
  // cateva unitati mobile / avansate spre centru, cu path si tinta
  for (let i = 0; i < 4; i++) {
    const u = makeUnit('tank', 0, 28 + i * 2, 30 + i, {
      order: { kind: 'attackMove', x: 50, y: 48 },
      path: [{ x: 32 + i, y: 36 }, { x: 42, y: 42 }, { x: 50, y: 48 }],
      moving: true,
    });
    t0.push(u.id);
    units.set(u.id, u);
  }
  // doua damaged, una in flacari
  const dmg1 = units.get(t0[2])!; dmg1.hp = Math.round(dmg1.maxHp * 0.42);
  const dmg2 = units.get(t0[0])!; dmg2.hp = Math.round(dmg2.maxHp * 0.18);

  // --- unitati echipa 1 (rosu) ---
  const t1: EntityId[] = [];
  for (let i = 0; i < 9; i++) {
    const u = makeUnit('tank', 1, 67 - (i % 3) * 1.4, 60 - Math.floor(i / 3) * 1.4);
    t1.push(u.id);
    units.set(u.id, u);
  }
  for (let i = 0; i < 5; i++) {
    const u = makeUnit('rocket', 1, 62 - (i % 2) * 1.4, 68 - Math.floor(i / 2) * 1.4);
    t1.push(u.id);
    units.set(u.id, u);
  }
  for (let i = 0; i < 3; i++) {
    const u = makeUnit('harvester', 1, 66, 42 + i * 1.6, { carry: i === 0 ? 0.6 : 0, order: { kind: 'harvest', phase: 'toOre' } });
    t1.push(u.id);
    units.set(u.id, u);
  }
  for (let i = 0; i < 4; i++) {
    const u = makeUnit('tank', 1, 52 - i * 2, 50 - i, {
      order: { kind: 'attackMove', x: 30, y: 32 },
      path: [{ x: 48 - i, y: 46 }, { x: 40, y: 40 }, { x: 30, y: 32 }],
      moving: true,
    });
    t1.push(u.id);
    units.set(u.id, u);
  }
  const dmg3 = units.get(t1[1])!; dmg3.hp = Math.round(dmg3.maxHp * 0.3);

  // cateva unitati in ordin de atac direct (pentru a exercita fire/tracer/hit)
  const attacker = units.get(t0[10])!; // primul tanc attackMove
  const target = units.get(t1[10])!;
  attacker.order = { kind: 'attack', targetId: target.id };
  target.order = { kind: 'attack', targetId: attacker.id };

  const players: Player[] = [
    { team: 0, credits: 2450, isAI: false, difficulty: 'normal', production: emptyProduction(), defeated: false },
    { team: 1, credits: 1800, isAI: true, difficulty: 'normal', production: emptyProduction(), defeated: false },
  ];

  const fog = [new Uint8Array(map.w * map.h), new Uint8Array(map.w * map.h)];

  const world: World = {
    tick: 0,
    map,
    units,
    buildings,
    projectiles: [],
    players,
    fog,
    events: [],
    winner: null,
    nextId: idCounter,
    rng: 0,
    waveTimer: 400,
  };
  return world;
}

// ---------------- animator (doar pentru test vizual, nu e simularea reala) ----------------

interface AnimState {
  everSeen: Uint8Array[];
  t0: EntityId[];
  t1: EntityId[];
  nextProjectileId: number;
}

function teamUnitIds(world: World, team: Team): EntityId[] {
  const ids: EntityId[] = [];
  for (const u of world.units.values()) if (u.team === team) ids.push(u.id);
  return ids;
}

export function createFixtureAnimator(world: World): (dt: number) => void {
  const state: AnimState = {
    everSeen: world.fog.map((f) => new Uint8Array(f.length)),
    t0: teamUnitIds(world, 0),
    t1: teamUnitIds(world, 1),
    nextProjectileId: 900000,
  };

  const moveTowards = (u: Unit, tx: number, ty: number, speed: number): void => {
    const dx = tx - u.x, dy = ty - u.y;
    const dist = Math.hypot(dx, dy);
    u.moving = dist > 0.05;
    if (!u.moving) return;
    const targetAngle = Math.atan2(dy, dx);
    let diff = targetAngle - u.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    u.angle += Math.max(-0.12, Math.min(0.12, diff));
    const step = Math.min(dist, speed);
    u.x += (dx / dist) * step;
    u.y += (dy / dist) * step;
  };

  const stepUnitAlongPath = (u: Unit): void => {
    if (u.path.length === 0) {
      if (u.order.kind === 'move' || u.order.kind === 'attackMove') {
        moveTowards(u, u.order.x, u.order.y, 0.07);
      } else {
        u.moving = false;
      }
      return;
    }
    const wp = u.path[0];
    const d = Math.hypot(wp.x - u.x, wp.y - u.y);
    if (d < 0.15) {
      u.path.shift();
    } else {
      moveTowards(u, wp.x, wp.y, 0.08);
    }
  };

  return function stepFixture(_dt: number): void {
    world.events = [];
    world.tick += 1;

    for (const u of world.units.values()) {
      if (u.order.kind === 'move' || u.order.kind === 'attackMove') {
        stepUnitAlongPath(u);
      } else if (u.order.kind === 'harvest') {
        // ciclu simplu: umple si descarca
        if (u.order.phase === 'mining' || u.order.phase === 'toOre') {
          u.carry = Math.min(1, u.carry + 0.003);
          if (u.carry >= 1) u.order = { kind: 'harvest', phase: 'toRefinery' };
        } else if (u.order.phase === 'toRefinery') {
          u.carry = Math.max(0, u.carry - 0.004);
          if (u.carry <= 0.05) {
            world.events.push({ type: 'unload', team: u.team, x: u.x, y: u.y, amount: 300 });
            u.order = { kind: 'harvest', phase: 'mining' };
          }
        }
      } else if (u.order.kind === 'attack') {
        const target = world.units.get(u.order.targetId);
        if (target && target.hp > 0) {
          const dx = target.x - u.x, dy = target.y - u.y;
          const dist = Math.hypot(dx, dy);
          u.turretAngle = Math.atan2(dy, dx);
          if (dist > 7) {
            moveTowards(u, target.x, target.y, 0.06);
          } else {
            u.moving = false;
            if (u.cooldown <= 0) {
              const weapon = u.type === 'rocket' ? 'rocket' : 'shell';
              world.events.push({ type: 'fire', sourceId: u.id, x: u.x, y: u.y, angle: u.turretAngle, weapon });
              u.lastFireTick = world.tick;
              u.cooldown = u.type === 'rocket' ? 55 : 32;
              world.events.push({ type: 'hit', x: target.x, y: target.y, weapon });
              target.hp -= u.type === 'rocket' ? 38 : 22;
              if (target.hp <= 0) {
                target.hp = 0;
                world.events.push({ type: 'destroyed', id: target.id, kind: 'unit', team: target.team, x: target.x, y: target.y, size: 1 });
              }
            }
          }
        }
      }
      if (u.cooldown > 0) u.cooldown -= 1;
    }

    // respawn cele distruse, ca sa avem mereu lupta vizibila in demo
    for (const ev of world.events) {
      if (ev.type === 'destroyed' && ev.kind === 'unit') {
        const dead = world.units.get(ev.id);
        if (dead) {
          world.units.delete(ev.id);
          const spawnTeam = dead.team;
          const base = spawnTeam === 0 ? { x: 11, y: 20 } : { x: 66, y: 60 };
          const fresh = makeUnit(dead.type, spawnTeam, base.x + Math.random() * 3, base.y + Math.random() * 3);
          world.units.set(fresh.id, fresh);
          world.nextId = idCounter;
          if (spawnTeam === 0) state.t0.push(fresh.id); else state.t1.push(fresh.id);
          const enemyIds = spawnTeam === 0 ? state.t1 : state.t0;
          const liveEnemy = enemyIds.map((id) => world.units.get(id)).find((e) => e && e.hp > 0);
          if (liveEnemy) fresh.order = { kind: 'attack', targetId: liveEnemy.id };
        }
      }
    }

    // turelele clădirilor trag pe orice inamic suficient de apropiat
    for (const b of world.buildings.values()) {
      if (b.type !== 'turret' || world.tick < b.builtTick) continue;
      if (b.cooldown > 0) { b.cooldown -= 1; continue; }
      const cx = b.tx + b.w / 2, cy = b.ty + b.h / 2;
      let closest: Unit | null = null, closestD = 9999;
      for (const u of world.units.values()) {
        if (u.team === b.team) continue;
        const d = Math.hypot(u.x - cx, u.y - cy);
        if (d < 9 && d < closestD) { closest = u; closestD = d; }
      }
      if (closest) {
        b.turretAngle = Math.atan2(closest.y - cy, closest.x - cx);
        world.events.push({ type: 'fire', sourceId: b.id, x: cx, y: cy, angle: b.turretAngle, weapon: 'shell' });
        world.events.push({ type: 'hit', x: closest.x, y: closest.y, weapon: 'shell' });
        closest.hp -= 18;
        b.cooldown = 40;
        if (closest.hp <= 0) {
          closest.hp = 0;
          world.events.push({ type: 'destroyed', id: closest.id, kind: 'unit', team: closest.team, x: closest.x, y: closest.y, size: 1 });
        }
      }
    }

    // proiectile de recuzita (traverseaza harta, vizual)
    world.projectiles = world.projectiles.filter((p) => {
      const target = world.units.get(p.targetId) ?? world.buildings.get(p.targetId);
      const tx = target ? (target.kind === 'unit' ? target.x : target.tx + target.w / 2) : p.tx;
      const ty = target ? (target.kind === 'unit' ? target.y : target.ty + target.h / 2) : p.ty;
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const speed = p.kind === 'rocket' ? 0.5 : 1.4;
      if (d < speed) return false;
      p.x += (dx / d) * speed;
      p.y += (dy / d) * speed;
      p.tx = tx; p.ty = ty;
      return true;
    });
    if (world.tick % 90 === 0) {
      const a = state.t0[Math.floor(Math.random() * state.t0.length)];
      const b = state.t1[Math.floor(Math.random() * state.t1.length)];
      const ua = world.units.get(a), ub = world.units.get(b);
      if (ua && ub) {
        world.projectiles.push({ id: state.nextProjectileId++, kind: 'rocket', team: ua.team, x: ua.x, y: ua.y, fromX: ua.x, fromY: ua.y, targetId: ub.id, tx: ub.x, ty: ub.y });
      }
    }

    // ceata de razboi: cerc de vizibilitate in jurul unitatilor/cladirilor fiecarei echipe
    const w = world.map.w, h = world.map.h;
    for (let team = 0; team < world.fog.length; team++) {
      const visible = new Uint8Array(w * h);
      const mark = (cx: number, cy: number, r: number): void => {
        const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
        const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            if (Math.hypot(x - cx, y - cy) <= r) visible[y * w + x] = 1;
          }
        }
      };
      for (const u of world.units.values()) if (u.team === team) mark(u.x, u.y, 8);
      for (const b of world.buildings.values()) if (b.team === team) mark(b.tx + b.w / 2, b.ty + b.h / 2, 9);
      const seen = state.everSeen[team];
      const fogTeam = world.fog[team];
      for (let i = 0; i < visible.length; i++) {
        if (visible[i]) { seen[i] = 1; fogTeam[i] = 2; }
        else fogTeam[i] = seen[i] ? 1 : 0;
      }
    }
  };
}

export const FIXTURE_TICK_RATE = TICK_RATE;
