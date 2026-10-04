// Mișcare: urmărire traseu/flow-field cu viteză unghiulară limitată, separare locală (grilă spațială),
// re-planificare când traseul e blocat.
import type { Unit, Vec, World } from './types';
import { UNITS } from '../data/units';
import { fatan2, turnToward, angleDiff } from './fmath';
import { buildFlowField, findPath, flowFieldStep, isFree } from './path';
import type { Internal } from './internal';
import { getNav } from './internal';
import { sortedUnitIds } from './entities';

// Un recoltor atacat care a fugit nu reia imediat munca dacă a luat daună recent.
export const HARVEST_CALM_TICKS = 60; // 3 s fără daună

const ARRIVE_EPS = 0.08;
const MISALIGNED_SLOWDOWN = 0.35;
const ALIGN_WINDOW = 0.6; // radiani — sub acest unghi, viteză completă
const REPATH_INTERVAL = 0.5;

/** Un pas de urmărire a traseului/flow-field-ului curent al unității. Întoarce punctul-țintă imediat, sau null dacă stă pe loc. */
function nextSteerTarget(world: World, internal: Internal, blocked: Uint8Array, unit: Unit, dt: number): Vec | null {
  if (unit.path.length > 0) {
    const wp = unit.path[0];
    if (!isFree(blocked, world.map.w, world.map.h, Math.floor(wp.x), Math.floor(wp.y))) {
      // waypoint-ul a devenit blocat (clădire nouă) — re-planifică spre destinația finală a ordinului
      const nav = getNav(internal, unit.id);
      nav.repathCooldown -= dt;
      if (nav.repathCooldown <= 0) {
        nav.repathCooldown = REPATH_INTERVAL;
        const dest = destinationOf(unit);
        if (dest) {
          const p = findPath(blocked, world.map.w, world.map.h, Math.floor(unit.x), Math.floor(unit.y), Math.floor(dest.x), Math.floor(dest.y));
          unit.path = p ?? [];
        } else {
          unit.path = [];
        }
      }
      if (unit.path.length === 0) return null;
      return unit.path[0];
    }
    return wp;
  }
  const nav = getNav(internal, unit.id);
  if (nav.engagedTarget !== null) return null; // în luptă: stă pe loc, combat.ts decide traseul de urmărire
  if (nav.flow) {
    const dest = destinationOf(unit);
    if (dest) {
      const dd = Math.hypot(unit.x - dest.x, unit.y - dest.y);
      if (dd <= 3) {
        // suficient de aproape: comută la A* individual pentru precizie la sosire în formație
        nav.flow = null;
        const p = findPath(blocked, world.map.w, world.map.h, Math.floor(unit.x), Math.floor(unit.y), Math.floor(dest.x), Math.floor(dest.y));
        unit.path = p ?? [];
        return unit.path[0] ?? null;
      }
    }
    const step = flowFieldStep(nav.flow, blocked, unit.x, unit.y);
    if (step) return step;
  }
  return null;
}

function destinationOf(unit: Unit): Vec | null {
  if (unit.order.kind === 'move' || unit.order.kind === 'attackMove') return { x: unit.order.x, y: unit.order.y };
  return null;
}

export function stepMovement(world: World, internal: Internal, blocked: Uint8Array, dt: number): void {
  const ids = sortedUnitIds(world);
  for (const id of ids) {
    const unit = world.units.get(id);
    if (!unit || UNITS[unit.type].domain === 'air') continue; // avioanele zboară din air.ts
    moveOne(world, internal, blocked, unit, dt);
  }
  separate(world, blocked, ids);
}

function moveOne(world: World, internal: Internal, blocked: Uint8Array, unit: Unit, dt: number): void {
  const def = UNITS[unit.type];
  const target = nextSteerTarget(world, internal, blocked, unit, dt);
  if (!target) {
    unit.moving = false;
    if (unit.path.length === 0) {
      const nav = getNav(internal, unit.id);
      if (nav.flow) {
        // am ajuns la destinație urmărind flow field-ul: fixează poziția finală dacă e un ordin de mutare
        nav.flow = null;
      }
      onArrived(world, internal, unit);
    }
    return;
  }
  unit.moving = true;
  const dx = target.x - unit.x, dy = target.y - unit.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const desiredAngle = fatan2(dy, dx);
  unit.angle = turnToward(unit.angle, desiredAngle, def.turnRate * dt);
  const aligned = Math.abs(angleDiff(unit.angle, desiredAngle)) < ALIGN_WINDOW;
  const speed = def.speed * dt * (aligned ? 1 : MISALIGNED_SLOWDOWN);
  if (d <= speed + ARRIVE_EPS) {
    unit.x = target.x; unit.y = target.y;
    if (unit.path.length > 0) unit.path.shift();
  } else {
    unit.x += (dx / d) * speed;
    unit.y += (dy / d) * speed;
  }
}

function onArrived(world: World, internal: Internal, unit: Unit): void {
  if (unit.order.kind === 'move') {
    if (unit.type === 'harvester') {
      // recoltorul își reia treaba automat; dacă încă e sub foc, rămâne idle și îl reia watchdog-ul din economy.ts
      const calm = world.tick - (internal.lastDamageTick.get(unit.id) ?? -1e9) >= HARVEST_CALM_TICKS;
      unit.order = calm ? { kind: 'harvest', phase: 'seek' } : { kind: 'idle' };
    } else {
      unit.order = { kind: 'idle' };
    }
  }
  // 'attackMove' e tratat în combat.ts (revine la idle când ajunge și nu mai are țintă)
}

// --- separare locală printr-o grilă spațială (evită O(n^2) la populații mari) ---
function cellKey(x: number, y: number, cell: number): number {
  return (Math.floor(y / cell) * 100000) + Math.floor(x / cell);
}

function separate(world: World, blocked: Uint8Array, ids: number[]): void {
  const cell = 2; // tile-uri per celulă a grilei de separare
  const buckets = new Map<number, Unit[]>();
  const units: Unit[] = [];
  for (const id of ids) {
    const u = world.units.get(id);
    if (!u) continue;
    units.push(u);
    const key = cellKey(u.x, u.y, cell);
    const arr = buckets.get(key);
    if (arr) arr.push(u); else buckets.set(key, [u]);
  }
  const w = world.map.w, h = world.map.h;
  for (const a of units) {
    if (UNITS[a.type].domain === 'air') continue;
    const bx = Math.floor(a.x / cell), by = Math.floor(a.y / cell);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const arr = buckets.get(((by + oy) * 100000) + (bx + ox));
        if (!arr) continue;
        for (const b of arr) {
          if (b.id <= a.id || UNITS[b.type].domain === 'air') continue; // fiecare pereche o singură dată, ordine determinist pe id
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const minD = (UNITS[a.type].radius + UNITS[b.type].radius) * 0.8;
          if (d > 0 && d < minD) {
            const push = (minD - d) / 2;
            const nx = dx / d, ny = dy / d;
            tryPush(a, -nx * push, -ny * push, blocked, w, h);
            tryPush(b, nx * push, ny * push, blocked, w, h);
          } else if (d === 0) {
            // perfect suprapuse (foarte rar): micșorează determinist pe baza id-urilor
            tryPush(a, -0.01, 0, blocked, w, h);
            tryPush(b, 0.01, 0, blocked, w, h);
          }
        }
      }
    }
  }
  for (const u of units) {
    u.x = Math.max(0.1, Math.min(w - 0.1, u.x));
    u.y = Math.max(0.1, Math.min(h - 0.1, u.y));
  }
}

function tryPush(u: Unit, dx: number, dy: number, blocked: Uint8Array, w: number, h: number): void {
  const nx = u.x + dx, ny = u.y + dy;
  const curFree = isFree(blocked, w, h, Math.floor(u.x), Math.floor(u.y));
  if (isFree(blocked, w, h, Math.floor(nx), Math.floor(ny)) || !curFree) {
    u.x = nx; u.y = ny;
  }
}

// ================= comenzi de deplasare în grup (formație + flow field) =================

const GROUP_FLOW_THRESHOLD = 6;

/** Caută N tile-uri libere lângă (gx,gy) prin BFS pe inele — sloturi de formație. */
function findFormationSlots(blocked: Uint8Array, w: number, h: number, gx: number, gy: number, n: number): Vec[] {
  const slots: Vec[] = [];
  const seen = new Set<number>();
  const start = Math.max(0, Math.min(w - 1, gx)) + Math.max(0, Math.min(h - 1, gy)) * w;
  const q: Array<[number, number]> = [[Math.max(0, Math.min(w - 1, gx)), Math.max(0, Math.min(h - 1, gy))]];
  seen.add(start);
  let head = 0;
  while (head < q.length && slots.length < n) {
    const [x, y] = q[head++];
    if (isFree(blocked, w, h, x, y)) slots.push({ x: x + 0.5, y: y + 0.5 });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const key = ny * w + nx;
      if (seen.has(key)) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  while (slots.length < n) slots.push({ x: gx + 0.5, y: gy + 0.5 });
  return slots;
}

/** Emite un ordin de deplasare/attack-move pentru un grup, cu formație și (pentru grupuri mari) flow field partajat. */
export function issueMoveOrder(
  world: World,
  internal: Internal,
  blocked: Uint8Array,
  ids: readonly number[],
  destX: number,
  destY: number,
  kind: 'move' | 'attackMove',
): void {
  const w = world.map.w, h = world.map.h;
  const gx = Math.floor(destX), gy = Math.floor(destY);
  const sortedIds = [...ids].sort((a, b) => a - b);
  const slots = findFormationSlots(blocked, w, h, gx, gy, sortedIds.length);

  // atribuire greedy determinist: pentru fiecare unitate (în ordine de id), slotul neutilizat cel mai apropiat
  const used = new Array(slots.length).fill(false);
  const assigned = new Map<number, Vec>();
  for (const id of sortedIds) {
    const u = world.units.get(id);
    if (!u) continue;
    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < slots.length; i++) {
      if (used[i]) continue;
      const d = (slots[i].x - u.x) ** 2 + (slots[i].y - u.y) ** 2;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI >= 0) { used[bestI] = true; assigned.set(id, slots[bestI]); }
  }

  const useFlow = sortedIds.length >= GROUP_FLOW_THRESHOLD;
  const sharedFlow = useFlow ? buildFlowField(blocked, w, h, gx, gy) : null;

  for (const id of sortedIds) {
    const u = world.units.get(id);
    if (!u) continue;
    if (u.type === 'harvester') {
      const nav = getNav(internal, id);
      nav.engagedTarget = null;
      nav.flow = null;
    }
    const slot = assigned.get(id) ?? { x: destX, y: destY };
    const nav = getNav(internal, id);
    nav.engagedTarget = null;
    // recoltorul nu atacă: attackMove devine move (și apoi își reia recoltarea)
    u.order = kind === 'move' || u.type === 'harvester' ? { kind: 'move', x: slot.x, y: slot.y } : { kind: 'attackMove', x: slot.x, y: slot.y };
    if (sharedFlow) {
      nav.flow = sharedFlow;
      u.path = [];
    } else {
      nav.flow = null;
      const p = findPath(blocked, w, h, Math.floor(u.x), Math.floor(u.y), Math.floor(slot.x), Math.floor(slot.y));
      u.path = p ?? [];
    }
  }
}

export { destinationOf };
