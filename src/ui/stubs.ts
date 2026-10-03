// Doar pentru dezvoltare: un SimAPI și un RenderAPI minimale, ca UI-ul să poată fi construit și
// testat independent de echipele de simulare și randare. NU face parte din integrarea finală —
// src/sim/index.ts și src/render/index.ts (placeholder-ele) importă de aici, și orchestratorul
// le înlocuiește cu implementările reale.
import {
  TICK_RATE,
  TERRAIN_GROUND,
  TERRAIN_ROCK,
  type World,
  type Command,
  type GameSetup,
  type SimAPI,
  type Team,
  type Unit,
  type Building,
  type BuildingType,
  type UnitType,
  type Vec,
  type MapData,
  type EntityId,
} from '../sim/types';
import type { RenderAPI, PickResult, Ghost, CreateRenderer } from '../render/api';

// ---------------------------------------------------------------- sim stub
const FOOTPRINT: Record<BuildingType, { w: number; h: number }> = {
  hq: { w: 3, h: 3 },
  refinery: { w: 3, h: 2 },
  factory: { w: 3, h: 3 },
  turret: { w: 1, h: 1 },
};
const BUILD_TIME: Record<BuildingType, number> = { hq: 0, refinery: 8, factory: 10, turret: 6 };
const BUILD_COST: Record<BuildingType, number> = { hq: 0, refinery: 1000, factory: 1200, turret: 600 };
const UNIT_TIME: Record<UnitType, number> = { tank: 6, rocket: 8, harvester: 9 };
const UNIT_COST: Record<UnitType, number> = { tank: 600, rocket: 800, harvester: 900 };
const UNIT_SPEED: Record<UnitType, number> = { tank: 2.6, rocket: 2.1, harvester: 1.8 }; // tile-uri/secundă
const UNIT_HP: Record<UnitType, number> = { tank: 320, rocket: 170, harvester: 700 };
const BUILDING_HP: Record<BuildingType, number> = { hq: 1700, refinery: 900, factory: 1100, turret: 520 };
const SIGHT = 6.5;

function makeMap(w: number, h: number, starts: Vec[]): MapData {
  const terrain = new Uint8Array(w * h);
  const height = new Float32Array(w * h);
  const ore = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      terrain[i] = edge ? TERRAIN_ROCK : TERRAIN_GROUND;
      height[i] = 0.2 + 0.05 * Math.sin(x * 0.4) + 0.05 * Math.cos(y * 0.37);
    }
  }
  const oreSpots: Vec[] = [
    { x: w * 0.28, y: h * 0.72 },
    { x: w * 0.74, y: h * 0.22 },
    { x: w * 0.5, y: h * 0.5 },
  ];
  for (const s of oreSpots) {
    const r = 3.4;
    for (let y = Math.floor(s.y - r); y <= s.y + r; y++) {
      for (let x = Math.floor(s.x - r); x <= s.x + r; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < r) ore[y * w + x] = Math.round(260 * (1 - d / r)) + 60;
      }
    }
  }
  return { w, h, terrain, height, ore, starts };
}

function freshFog(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h);
}

interface StubState {
  nextFire: Map<EntityId, number>;
}

let uidCounter = 1;
function nextId(): EntityId {
  return uidCounter++;
}

function addUnit(world: World, team: Team, type: UnitType, x: number, y: number): Unit {
  const u: Unit = {
    id: nextId(),
    kind: 'unit',
    type,
    team,
    x,
    y,
    angle: 0,
    turretAngle: 0,
    hp: UNIT_HP[type],
    maxHp: UNIT_HP[type],
    order: { kind: 'idle' },
    path: [],
    carry: 0,
    cooldown: 0,
    lastFireTick: -999,
    moving: false,
  };
  world.units.set(u.id, u);
  return u;
}

function addBuilding(world: World, team: Team, type: BuildingType, tx: number, ty: number, builtTick: number): Building {
  const f = FOOTPRINT[type];
  const b: Building = {
    id: nextId(),
    kind: 'building',
    type,
    team,
    tx,
    ty,
    w: f.w,
    h: f.h,
    hp: BUILDING_HP[type],
    maxHp: BUILDING_HP[type],
    turretAngle: 0,
    cooldown: 0,
    lastFireTick: -999,
    builtTick,
  };
  world.buildings.set(b.id, b);
  return b;
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function createStubSim(): SimAPI {
  const stubByWorld = new WeakMap<World, StubState>();
  const waveByWorld = new WeakMap<World, { next: number }>();

  function createWorld(setup: GameSetup): World {
    uidCounter = 1;
    const { w, h } = setup.mapSize;
    const starts: Vec[] = setup.players.map((_, i) => ({
      x: i % 2 === 0 ? w * 0.18 : w * 0.82,
      y: i < 2 ? h * 0.2 : h * 0.8,
    }));
    const map = makeMap(w, h, starts);
    const players = setup.players.map((p) => ({
      team: p.team,
      credits: 2000,
      isAI: p.isAI,
      difficulty: p.difficulty,
      production: { building: null, units: [], rally: null },
      defeated: false,
    }));
    const world: World = {
      tick: 0,
      map,
      units: new Map(),
      buildings: new Map(),
      projectiles: [],
      players,
      fog: setup.players.map(() => freshFog(w, h)),
      events: [],
      winner: null,
      nextId: 1,
      rng: 0x9e3779b9,
      waveTimer: TICK_RATE * 45,
    };
    setup.players.forEach((p, i) => {
      const s = starts[i];
      addBuilding(world, p.team, 'hq', Math.round(s.x) - 1, Math.round(s.y) - 1, 0);
      addBuilding(world, p.team, 'refinery', Math.round(s.x) + 3, Math.round(s.y) - 1, 0);
      addUnit(world, p.team, 'harvester', s.x - 2, s.y + 3);
      addUnit(world, p.team, 'tank', s.x - 3, s.y + 1);
      addUnit(world, p.team, 'tank', s.x - 1.5, s.y + 1.6);
      addUnit(world, p.team, 'rocket', s.x - 4, s.y + 2);
    });
    stubByWorld.set(world, { nextFire: new Map() });
    waveByWorld.set(world, { next: world.waveTimer });
    return world;
  }

  function tileBlocked(world: World, tx: number, ty: number): boolean {
    const { w, h, terrain } = world.map;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return true;
    if (terrain[ty * w + tx] === TERRAIN_ROCK) return true;
    for (const b of world.buildings.values()) {
      if (tx >= b.tx && tx < b.tx + b.w && ty >= b.ty && ty < b.ty + b.h) return true;
    }
    return false;
  }

  function canPlace(world: World, team: Team, type: BuildingType, tx: number, ty: number): boolean {
    const f = FOOTPRINT[type];
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        if (tileBlocked(world, tx + x, ty + y)) return false;
        const i = (ty + y) * world.map.w + (tx + x);
        if (world.map.ore[i] > 0) return false;
      }
    }
    const cx = tx + f.w / 2;
    const cy = ty + f.h / 2;
    for (const b of world.buildings.values()) {
      if (b.team !== team) continue;
      const bcx = b.tx + b.w / 2;
      const bcy = b.ty + b.h / 2;
      if (dist(cx, cy, bcx, bcy) < 9) return true;
    }
    return false;
  }

  function updateFog(world: World) {
    for (let ti = 0; ti < world.players.length; ti++) {
      const fog = world.fog[ti];
      for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1;
      const team = world.players[ti].team;
      const mark = (x: number, y: number, r: number) => {
        const x0 = Math.max(0, Math.floor(x - r));
        const x1 = Math.min(world.map.w - 1, Math.ceil(x + r));
        const y0 = Math.max(0, Math.floor(y - r));
        const y1 = Math.min(world.map.h - 1, Math.ceil(y + r));
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            if (dist(xx + 0.5, yy + 0.5, x, y) <= r) fog[yy * world.map.w + xx] = 2;
          }
        }
      };
      for (const u of world.units.values()) if (u.team === team) mark(u.x, u.y, SIGHT);
      for (const b of world.buildings.values()) if (b.team === team) mark(b.tx + b.w / 2, b.ty + b.h / 2, SIGHT);
    }
  }

  function applyCommand(world: World, cmd: Command) {
    const player = world.players.find((p) => p.team === cmd.team);
    if (!player) return;
    switch (cmd.t) {
      case 'move':
        for (const id of cmd.ids) {
          const u = world.units.get(id);
          if (u && u.team === cmd.team) u.order = { kind: 'move', x: cmd.x, y: cmd.y };
        }
        break;
      case 'attackMove':
        for (const id of cmd.ids) {
          const u = world.units.get(id);
          if (u && u.team === cmd.team) u.order = { kind: 'attackMove', x: cmd.x, y: cmd.y };
        }
        break;
      case 'attack':
        for (const id of cmd.ids) {
          const u = world.units.get(id);
          if (u && u.team === cmd.team) u.order = { kind: 'attack', targetId: cmd.targetId };
        }
        break;
      case 'stop':
        for (const id of cmd.ids) {
          const u = world.units.get(id);
          if (u && u.team === cmd.team) {
            u.order = { kind: 'idle' };
            u.path = [];
          }
        }
        break;
      case 'harvest':
        for (const id of cmd.ids) {
          const u = world.units.get(id);
          if (u && u.team === cmd.team && u.type === 'harvester') u.order = { kind: 'harvest', phase: 'toOre' };
        }
        break;
      case 'buildStart': {
        if (player.production.building) break;
        const cost = BUILD_COST[cmd.building];
        if (player.credits < cost) break;
        player.credits -= cost;
        player.production.building = { type: cmd.building, progress: 0, ready: false };
        break;
      }
      case 'buildPlace': {
        const slot = player.production.building;
        if (!slot || !slot.ready) break;
        if (!canPlace(world, cmd.team, slot.type, cmd.tx, cmd.ty)) break;
        addBuilding(world, cmd.team, slot.type, cmd.tx, cmd.ty, world.tick);
        world.events.push({ type: 'buildingPlaced', team: cmd.team, id: world.nextId, building: slot.type });
        player.production.building = null;
        break;
      }
      case 'buildCancel':
        if (player.production.building) {
          player.credits += BUILD_COST[player.production.building.type];
          player.production.building = null;
        }
        break;
      case 'train': {
        if (player.production.units.length >= 5) break;
        const cost = UNIT_COST[cmd.unit];
        if (player.credits < cost) break;
        player.credits -= cost;
        player.production.units.push({ type: cmd.unit, progress: 0, ready: false });
        break;
      }
      case 'trainCancel': {
        const q = player.production.units;
        const idx = q.map((s) => s.type).lastIndexOf(cmd.unit);
        if (idx >= 0) {
          player.credits += UNIT_COST[q[idx].type];
          q.splice(idx, 1);
        }
        break;
      }
      case 'rally':
        player.production.rally = { x: cmd.x, y: cmd.y };
        break;
    }
  }

  function findFactory(world: World, team: Team): Building | null {
    for (const b of world.buildings.values()) if (b.team === team && b.type === 'factory') return b;
    return null;
  }

  function tickProduction(world: World, dtSeconds: number) {
    for (const player of world.players) {
      const slot = player.production.building;
      if (slot && !slot.ready) {
        slot.progress = Math.min(1, slot.progress + dtSeconds / Math.max(1, BUILD_TIME[slot.type]));
        if (slot.progress >= 1) {
          slot.ready = true;
          world.events.push({ type: 'buildingReady', team: player.team, building: slot.type });
        }
      }
      const fac = findFactory(world, player.team);
      if (fac && player.production.units.length) {
        const head = player.production.units[0];
        if (!head.ready) {
          head.progress = Math.min(1, head.progress + dtSeconds / Math.max(1, UNIT_TIME[head.type]));
          if (head.progress >= 1) {
            head.ready = true;
            player.production.units.shift();
            const spot = player.production.rally ?? { x: fac.tx + fac.w / 2, y: fac.ty + fac.h + 1.5 };
            const u = addUnit(world, player.team, head.type, fac.tx + fac.w / 2, fac.ty + fac.h + 0.5);
            u.order = { kind: 'move', x: spot.x, y: spot.y };
            world.events.push({ type: 'unitReady', team: player.team, id: u.id, unit: head.type });
          }
        }
      }
    }
  }

  function moveToward(u: Unit, tx: number, ty: number, dtSeconds: number): boolean {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    const speed = UNIT_SPEED[u.type] * dtSeconds;
    u.moving = d > 0.05;
    if (d <= speed) {
      u.x = tx;
      u.y = ty;
      u.moving = false;
      return true;
    }
    u.angle = Math.atan2(dy, dx);
    u.x += (dx / d) * speed;
    u.y += (dy / d) * speed;
    return false;
  }

  function tickUnits(world: World, dtSeconds: number) {
    for (const u of world.units.values()) {
      if (u.order.kind === 'move' && moveToward(u, u.order.x, u.order.y, dtSeconds)) {
        u.order = { kind: 'idle' };
      } else if (u.order.kind === 'attackMove') {
        moveToward(u, u.order.x, u.order.y, dtSeconds);
        let bestId: EntityId | null = null;
        let bestD = 999;
        for (const o of world.units.values()) {
          if (o.team === u.team) continue;
          const d = dist(u.x, u.y, o.x, o.y);
          if (d < 5 && d < bestD) {
            bestD = d;
            bestId = o.id;
          }
        }
        if (bestId !== null) u.order = { kind: 'attack', targetId: bestId };
      } else if (u.order.kind === 'attack') {
        const target = world.units.get(u.order.targetId) ?? world.buildings.get(u.order.targetId);
        if (!target || target.hp <= 0) {
          u.order = { kind: 'idle' };
        } else {
          const tx = target.kind === 'unit' ? target.x : target.tx + target.w / 2;
          const ty = target.kind === 'unit' ? target.y : target.ty + target.h / 2;
          const d = dist(u.x, u.y, tx, ty);
          const range = u.type === 'rocket' ? 6.5 : 4.2;
          if (d > range) {
            moveToward(u, tx, ty, dtSeconds);
          } else {
            u.angle = Math.atan2(ty - u.y, tx - u.x);
            u.turretAngle = u.angle;
            u.moving = false;
            u.cooldown -= dtSeconds;
            if (u.cooldown <= 0) {
              u.cooldown = u.type === 'rocket' ? 2.2 : 1.1;
              target.hp -= u.type === 'rocket' ? 42 : 24;
              u.lastFireTick = world.tick;
              world.events.push({ type: 'fire', sourceId: u.id, x: u.x, y: u.y, angle: u.angle, weapon: u.type === 'rocket' ? 'rocket' : 'shell' });
              if (target.hp <= 0) {
                world.events.push({
                  type: 'destroyed',
                  id: target.id,
                  kind: target.kind,
                  team: target.team,
                  x: tx,
                  y: ty,
                  size: target.kind === 'unit' ? 1 : Math.max(target.w, target.h),
                });
                if (target.kind === 'unit') world.units.delete(target.id);
                else world.buildings.delete(target.id);
                u.order = { kind: 'idle' };
              } else if (target.team === world.players.find((p) => !p.isAI)?.team) {
                world.events.push({ type: 'underAttack', team: target.team, x: tx, y: ty });
              }
            }
          }
        }
      } else if (u.order.kind === 'harvest') {
        u.carry = Math.min(300, u.carry + dtSeconds * 40);
        if (u.carry >= 300) {
          const owner = world.players.find((p) => p.team === u.team);
          if (owner) {
            owner.credits += 300;
            world.events.push({ type: 'unload', team: u.team, x: u.x, y: u.y, amount: 300 });
          }
          u.carry = 0;
        }
      }
    }
  }

  function step(world: World, commands: Command[]): void {
    world.events = [];
    for (const cmd of commands) applyCommand(world, cmd);
    const dt = 1 / TICK_RATE;
    tickUnits(world, dt);
    tickProduction(world, dt);
    for (const player of world.players) player.credits += dt * 6; // tichet mic de venit, ca numărul să se miște vizibil
    updateFog(world);
    world.waveTimer -= 1;
    if (world.waveTimer <= 0) {
      world.waveTimer = TICK_RATE * (50 + Math.floor(Math.random() * 20));
      const human = world.players.find((p) => !p.isAI);
      if (human) world.events.push({ type: 'waveIncoming', team: human.team, wave: Math.floor(world.tick / (TICK_RATE * 60)) + 1 });
    }
    world.tick += 1;
  }

  function hash(world: World): number {
    let h = world.tick | 0;
    for (const p of world.players) h = (h * 31 + Math.floor(p.credits)) | 0;
    return h;
  }

  return { createWorld, step, canPlace, hash };
}

// -------------------------------------------------------------- render stub
const TILE_PX = 24;
const TEAM_COLORS: Record<number, string> = { 0: '#3d9bff', 1: '#ff4a3a', 2: '#6fd97f', 3: '#f0b13a' };

interface Pulse { x: number; y: number; kind: 'move' | 'attack'; born: number }

export function createStubRenderer(canvas: HTMLCanvasElement): RenderAPI {
  const ctx = canvas.getContext('2d')!;
  let widthCss = canvas.clientWidth || 800;
  let heightCss = canvas.clientHeight || 600;
  let dpr = 1;
  let zoom = 1;
  const cam = { x: 0, y: 0 }; // colțul stânga-sus al vederii, în tile-uri
  let localTeam: Team = 0;
  let selection: EntityId[] = [];
  let ghost: Ghost | null = null;
  const pulses: Pulse[] = [];
  let clock = 0;

  function pxPerTile(): number {
    return TILE_PX * zoom;
  }
  function screenToWorld(sx: number, sy: number): Vec {
    const p = pxPerTile();
    return { x: cam.x + sx / p, y: cam.y + sy / p };
  }
  function worldToScreenXY(wx: number, wy: number): Vec {
    const p = pxPerTile();
    return { x: (wx - cam.x) * p, y: (wy - cam.y) * p };
  }

  function render(world: World, _alpha: number, dtSeconds: number): void {
    clock += dtSeconds;
    const w = widthCss;
    const h = heightCss;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);
    const p = pxPerTile();
    const x0 = Math.max(0, Math.floor(cam.x));
    const y0 = Math.max(0, Math.floor(cam.y));
    const x1 = Math.min(world.map.w - 1, Math.ceil(cam.x + w / p));
    const y1 = Math.min(world.map.h - 1, Math.ceil(cam.y + h / p));
    const fog = world.fog[localTeam];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * world.map.w + tx;
        const seenState = fog ? fog[i] : 2;
        if (seenState === 0) continue;
        const s = worldToScreenXY(tx, ty);
        const rock = world.map.terrain[i] === TERRAIN_ROCK;
        const ore = world.map.ore[i];
        ctx.fillStyle = rock ? '#23282c' : ore > 0 ? '#5b4a1f' : '#262b22';
        ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.ceil(p) + 1, Math.ceil(p) + 1);
        if (ore > 0 && !rock) {
          ctx.fillStyle = '#f0b13a';
          const r = Math.max(1.5, (p / 24) * 3);
          ctx.beginPath();
          ctx.arc(s.x + p / 2, s.y + p / 2, r, 0, Math.PI * 2);
          ctx.fill();
        }
        if (seenState === 1) {
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          ctx.fillRect(Math.round(s.x), Math.round(s.y), Math.ceil(p) + 1, Math.ceil(p) + 1);
        }
      }
    }
    // clădiri
    for (const b of world.buildings.values()) {
      if (b.team !== localTeam) {
        const cx = Math.floor(b.tx + b.w / 2);
        const cy = Math.floor(b.ty + b.h / 2);
        if (fog && fog[cy * world.map.w + cx] !== 2) continue;
      }
      const s = worldToScreenXY(b.tx, b.ty);
      const ww = b.w * p;
      const hh = b.h * p;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fillRect(s.x + 2, s.y + 3, ww, hh);
      ctx.fillStyle = TEAM_COLORS[b.team] ?? '#888';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(s.x, s.y, ww, hh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.35)';
      ctx.strokeRect(s.x + 0.5, s.y + 0.5, ww - 1, hh - 1);
      ctx.fillStyle = 'rgba(5,7,8,.75)';
      ctx.font = '10px sans-serif';
      ctx.fillText(b.type, s.x + 4, s.y + 12);
      if (b.hp < b.maxHp) drawHpBar(s.x, s.y - 6, ww, b.hp / b.maxHp);
      if (selection.includes(b.id)) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - 2, s.y - 2, ww + 4, hh + 4);
      }
    }
    // unități
    for (const u of world.units.values()) {
      if (u.team !== localTeam) {
        const tx = Math.floor(u.x);
        const ty = Math.floor(u.y);
        if (fog && fog[ty * world.map.w + tx] !== 2) continue;
      }
      const s = worldToScreenXY(u.x, u.y);
      const r = Math.max(3, p * 0.32);
      if (selection.includes(u.id)) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = TEAM_COLORS[u.team] ?? '#888';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + Math.cos(u.angle) * r * 1.6, s.y + Math.sin(u.angle) * r * 1.6);
      ctx.stroke();
      if (u.hp < u.maxHp) drawHpBar(s.x - r, s.y - r - 7, r * 2, u.hp / u.maxHp);
    }
    // fantomă de plasare
    if (ghost) {
      const s = worldToScreenXY(ghost.tx, ghost.ty);
      const fw = ghost.type === 'turret' ? 1 : 3;
      const fh = ghost.type === 'refinery' ? 2 : ghost.type === 'turret' ? 1 : 3;
      ctx.fillStyle = ghost.valid ? 'rgba(111,217,127,.35)' : 'rgba(255,74,58,.35)';
      ctx.fillRect(s.x, s.y, fw * p, fh * p);
      ctx.strokeStyle = ghost.valid ? '#6fd97f' : '#ff4a3a';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x, s.y, fw * p, fh * p);
    }
    // pulsuri
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pu = pulses[i];
      const age = clock - pu.born;
      if (age > 0.6) {
        pulses.splice(i, 1);
        continue;
      }
      const s = worldToScreenXY(pu.x, pu.y);
      ctx.globalAlpha = 1 - age / 0.6;
      ctx.strokeStyle = pu.kind === 'attack' ? '#ff4a3a' : '#6fd97f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6 + age * 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawHpBar(x: number, y: number, w: number, frac: number) {
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = frac > 0.55 ? '#6fd97f' : frac > 0.28 ? '#f0b13a' : '#ff4a3a';
    ctx.fillRect(x, y, Math.max(0, w * frac), 4);
  }

  function resize(width: number, height: number, newDpr: number): void {
    widthCss = width;
    heightCss = height;
    dpr = newDpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  function pick(screenX: number, screenY: number): PickResult {
    const wp = screenToWorld(screenX, screenY);
    return { world: wp, entityId: pickEntityNear(wp) };
  }

  let worldRef: World | null = null;
  function pickEntityNear(wp: Vec): EntityId | null {
    if (!worldRef) return null;
    let best: EntityId | null = null;
    let bestD = 0.6;
    for (const u of worldRef.units.values()) {
      if (u.team !== localTeam) {
        const fog = worldRef.fog[localTeam];
        const tx = Math.floor(u.x);
        const ty = Math.floor(u.y);
        if (fog && fog[ty * worldRef.map.w + tx] !== 2) continue;
      }
      const d = Math.hypot(u.x - wp.x, u.y - wp.y);
      if (d < bestD) {
        bestD = d;
        best = u.id;
      }
    }
    if (best !== null) return best;
    for (const b of worldRef.buildings.values()) {
      if (wp.x >= b.tx && wp.x < b.tx + b.w && wp.y >= b.ty && wp.y < b.ty + b.h) {
        if (b.team !== localTeam) {
          const fog = worldRef.fog[localTeam];
          const cx = Math.floor(b.tx + b.w / 2);
          const cy = Math.floor(b.ty + b.h / 2);
          if (fog && fog[cy * worldRef.map.w + cx] !== 2) continue;
        }
        return b.id;
      }
    }
    return null;
  }

  function pickBox(x0: number, y0: number, x1: number, y1: number, team: Team): EntityId[] {
    if (!worldRef) return [];
    const a = screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const b = screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    const out: EntityId[] = [];
    for (const u of worldRef.units.values()) {
      if (u.team === team && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y) out.push(u.id);
    }
    return out;
  }

  function worldToScreen(p: Vec): Vec | null {
    return worldToScreenXY(p.x, p.y);
  }
  function panBy(dxPixels: number, dyPixels: number): void {
    const pp = pxPerTile();
    cam.x += dxPixels / pp;
    cam.y += dyPixels / pp;
  }
  function zoomBy(factor: number, screenX: number, screenY: number): void {
    const before = screenToWorld(screenX, screenY);
    zoom = Math.min(3, Math.max(0.5, zoom * factor));
    const pp = pxPerTile();
    cam.x = before.x - screenX / pp;
    cam.y = before.y - screenY / pp;
  }
  function centerOn(p: Vec): void {
    const pp = pxPerTile();
    cam.x = p.x - widthCss / pp / 2;
    cam.y = p.y - heightCss / pp / 2;
  }
  function viewQuad(): Vec[] {
    const pp = pxPerTile();
    const vw = widthCss / pp;
    const vh = heightCss / pp;
    return [
      { x: cam.x, y: cam.y },
      { x: cam.x + vw, y: cam.y },
      { x: cam.x + vw, y: cam.y + vh },
      { x: cam.x, y: cam.y + vh },
    ];
  }
  function setLocalTeam(team: Team): void {
    localTeam = team;
  }
  function setSelection(ids: EntityId[]): void {
    selection = ids;
  }
  function setGhost(g: Ghost | null): void {
    ghost = g;
  }
  function pulse(p: Vec, kind: 'move' | 'attack'): void {
    pulses.push({ x: p.x, y: p.y, kind, born: clock });
  }
  function dispose(): void {
    pulses.length = 0;
  }

  // reține referința lumii la fiecare apel render() ca pick/pickBox să funcționeze
  const api: RenderAPI = {
    render(world, alpha, dtSeconds) {
      worldRef = world;
      render(world, alpha, dtSeconds);
    },
    resize,
    pick,
    pickBox,
    worldToScreen,
    panBy,
    zoomBy,
    centerOn,
    viewQuad,
    setLocalTeam,
    setSelection,
    setGhost,
    pulse,
    dispose,
  };
  return api;
}

export const createStubRendererFactory: CreateRenderer = (canvas: HTMLCanvasElement) => createStubRenderer(canvas);
