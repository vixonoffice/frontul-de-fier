// Mișcare: urmărire traseu/flow-field cu viteză unghiulară limitată, separare locală (grilă spațială),
// re-planificare când traseul e blocat.
import type { Unit, UnitType, Vec, World } from './types';
import { CRUSHERS, UNITS } from '../data/units';
import { fatan2, fcos, fsin, turnToward, angleDiff, dist } from './fmath';
import { buildFlowField, findPath, flowFieldStep, isFree } from './path';
import type { Internal } from './internal';
import { getNav } from './internal';
import { sortedUnitIds } from './entities';
import { creditKill, destroyEntity } from './combat';

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
      const dd = dist(unit.x - dest.x, unit.y - dest.y);
      if (dd <= 3) {
        // suficient de aproape: comută la A* individual pentru precizie la sosire în formație
        nav.flow = null;
        unit.path = planPath(blocked, world.map.w, world.map.h, unit, dest);
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
  separate(world, internal, blocked, ids);
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
      onArrived(world, internal, unit, dt);
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

function onArrived(world: World, internal: Internal, unit: Unit, dt: number): void {
  // oprită pe slot: se întoarce cu fața în direcția de mers a formației
  const nav = getNav(internal, unit.id);
  if (nav.face !== null && unit.order.kind !== 'move') {
    unit.angle = turnToward(unit.angle, nav.face, UNITS[unit.type].turnRate * dt);
    if (UNITS[unit.type].turretTurnRate > 0 && unit.cooldown <= 0 && nav.engagedTarget === null) unit.turretAngle = unit.angle;
    if (Math.abs(angleDiff(unit.angle, nav.face)) < 0.02) nav.face = null;
  }
  if (unit.order.kind === 'move') {
    if (UNITS[unit.type].cargoCap > 0) {
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

function separate(world: World, internal: Internal, blocked: Uint8Array, ids: number[]): void {
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
  crushAndDodge(world, internal, blocked, units, buckets, cell);
  for (const a of units) {
    if (UNITS[a.type].domain === 'air' || !world.units.has(a.id)) continue;
    const bx = Math.floor(a.x / cell), by = Math.floor(a.y / cell);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const arr = buckets.get(((by + oy) * 100000) + (bx + ox));
        if (!arr) continue;
        for (const b of arr) {
          if (b.id <= a.id || UNITS[b.type].domain === 'air' || !world.units.has(b.id)) continue;
          // recoltoarele proprii trec unele prin altele (nu se blochează între ele)
          if (a.team === b.team && UNITS[a.type].cargoCap > 0 && UNITS[b.type].cargoCap > 0) continue; // fiecare pereche o singură dată, ordine determinist pe id
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const minD = (UNITS[a.type].radius + UNITS[b.type].radius) * 0.9;
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

/** Strivire: un vehicul greu în mișcare omoară instant infanteria inamică peste care trece; infanteria inactivă se ferește. */
function crushAndDodge(world: World, internal: Internal, blocked: Uint8Array, units: Unit[], buckets: Map<number, Unit[]>, cell: number): void {
  const w = world.map.w, h = world.map.h;
  const crushed: Array<{ victim: Unit; by: Unit }> = [];
  for (const a of units) {
    if (!a.moving || !CRUSHERS.includes(a.type) || UNITS[a.type].domain === 'air') continue;
    const bx = Math.floor(a.x / cell), by = Math.floor(a.y / cell);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const arr = buckets.get(((by + oy) * 100000) + (bx + ox));
        if (!arr) continue;
        for (const b of arr) {
          if (b.team === a.team || UNITS[b.type].armor !== 'infantry' || b.alt > 0) continue;
          const d = dist(b.x - a.x, b.y - a.y);
          if (d < (UNITS[a.type].radius + UNITS[b.type].radius) * 0.8) {
            if (!crushed.some((c) => c.victim.id === b.id)) crushed.push({ victim: b, by: a });
          } else if (d < 1.8 && b.order.kind === 'idle' && !b.moving) {
            // ocolirea: dacă vehiculul vine spre el, face un pas lateral
            const dx = b.x - a.x, dy = b.y - a.y;
            const ca = fcos(a.angle), sa = fsin(a.angle);
            if ((ca * dx + sa * dy) / d > 0.8) {
              const side = (-sa * dx + ca * dy) >= 0 ? 1 : -1;
              const step = UNITS[b.type].speed * 0.05 * 0.25;
              const nx = b.x - sa * side * step, ny = b.y + ca * side * step;
              if (isFree(blocked, w, h, Math.floor(nx), Math.floor(ny))) { b.x = nx; b.y = ny; }
            }
          }
        }
      }
    }
  }
  for (const { victim, by } of crushed) {
    if (!world.units.has(victim.id)) continue;
    world.events.push({ type: 'crushed', id: victim.id, team: victim.team, x: victim.x, y: victim.y });
    destroyEntity(world, internal, victim);
    creditKill(world, internal, by.id);
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
const VEHICLE_SPACING = 0.95;   // distanța dintre vehicule în formație
const INFANTRY_SPACING = 0.55;  // distanța dintre infanteriști
/** Rânduri: tancurile în față, apoi lansatoare/antitanc, infanteria (fragilă) în spate. */
const TIER: Partial<Record<UnitType, number>> = { tank: 0, warHarvester: 0, harvester: 0, rocket: 1, bazooka: 1, soldier: 2 };

function isVehicle(t: UnitType): boolean {
  return UNITS[t].radius >= 0.3;
}

/** Traseu spre un punct exact (nu doar spre centrul tile-ului): ultimul waypoint e chiar locul din formație. */
export function planPath(blocked: Uint8Array, w: number, h: number, unit: Unit, dest: Vec): Vec[] {
  const sx = Math.max(0, Math.min(w - 1, Math.floor(unit.x))), sy = Math.max(0, Math.min(h - 1, Math.floor(unit.y)));
  const gx = Math.floor(dest.x), gy = Math.floor(dest.y);
  const p = findPath(blocked, w, h, sx, sy, gx, gy);
  if (!p) return [];
  if (p.length === 0) return dist(dest.x - unit.x, dest.y - unit.y) > 0.06 && isFree(blocked, w, h, gx, gy) ? [{ x: dest.x, y: dest.y }] : [];
  const last = p[p.length - 1];
  if (Math.floor(last.x) === gx && Math.floor(last.y) === gy && isFree(blocked, w, h, gx, gy)) p[p.length - 1] = { x: dest.x, y: dest.y };
  return p;
}

/** Cel mai apropiat punct liber de `ideal` (tile liber, la cel puțin `minD` de punctele deja alese). */
function freeSpotNear(blocked: Uint8Array, w: number, h: number, ideal: Vec, taken: Vec[], minD: number): Vec | null {
  const ix = Math.floor(ideal.x), iy = Math.floor(ideal.y);
  let best: Vec | null = null, bestD = Infinity;
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = ix + dx, ty = iy + dy;
        if (!isFree(blocked, w, h, tx, ty)) continue;
        // în tile-ul ideal păstrăm poziția exactă, altfel centrul tile-ului
        const c = r === 0 ? ideal : { x: tx + 0.5, y: ty + 0.5 };
        if (taken.some((t) => (t.x - c.x) ** 2 + (t.y - c.y) ** 2 < minD * minD)) continue;
        const d = (c.x - ideal.x) ** 2 + (c.y - ideal.y) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
    }
    if (best && r >= 1) break;
  }
  return best;
}

/** Sloturile unei formații centrate pe țintă: rânduri perpendiculare pe direcția de mers, atribuite determinist. */
function formationSlots(blocked: Uint8Array, w: number, h: number, units: Unit[], dest: Vec, heading: Vec): Map<number, Vec> {
  const n = units.length;
  const anyVehicle = units.some((u) => isVehicle(u.type));
  const s = anyVehicle ? VEHICLE_SPACING : INFANTRY_SPACING;
  const cols = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(n * 1.6))));
  const rx = -heading.y, ry = heading.x; // „dreapta” formației
  const sorted = units.slice().sort((a, b) => (TIER[a.type] ?? 1) - (TIER[b.type] ?? 1) || a.id - b.id);
  const out = new Map<number, Vec>();
  const taken: Vec[] = [];
  for (let row = 0, i = 0; i < n; row++) {
    const rowUnits = sorted.slice(i, i + cols);
    i += rowUnits.length;
    // în rând: unitățile se ordonează după poziția laterală, ca traseele să nu se încrucișeze
    rowUnits.sort((a, b) => (a.x * rx + a.y * ry) - (b.x * rx + b.y * ry) || a.id - b.id);
    const k = rowUnits.length;
    for (let c = 0; c < k; c++) {
      const lat = (c - (k - 1) / 2) * s;
      const ideal = { x: dest.x + rx * lat - heading.x * row * s, y: dest.y + ry * lat - heading.y * row * s };
      const spot = freeSpotNear(blocked, w, h, ideal, taken, s * 0.8) ?? ideal;
      taken.push(spot);
      out.set(rowUnits[c].id, spot);
    }
  }
  return out;
}

/** Emite un ordin de deplasare/attack-move pentru un grup: fiecare unitate primește propriul slot într-o formație. */
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
  const gx = Math.max(0, Math.min(w - 1, Math.floor(destX))), gy = Math.max(0, Math.min(h - 1, Math.floor(destY)));
  const units: Unit[] = [];
  for (const id of [...ids].sort((a, b) => a - b)) {
    const u = world.units.get(id);
    if (u) units.push(u);
  }
  if (units.length === 0) return;
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= units.length; cy /= units.length;
  let hx = destX - cx, hy = destY - cy;
  const hl = Math.sqrt(hx * hx + hy * hy);
  if (hl < 0.5) { hx = 0; hy = 1; } else { hx /= hl; hy /= hl; }
  const faceAngle = fatan2(hy, hx);
  const slots = formationSlots(blocked, w, h, units, { x: destX, y: destY }, { x: hx, y: hy });

  const useFlow = units.length >= GROUP_FLOW_THRESHOLD;
  const sharedFlow = useFlow ? buildFlowField(blocked, w, h, gx, gy) : null;

  for (const u of units) {
    const nav = getNav(internal, u.id);
    nav.engagedTarget = null;
    nav.face = faceAngle;
    if (UNITS[u.type].cargoCap > 0) { nav.flow = null; }
    const slot = slots.get(u.id) ?? { x: destX, y: destY };
    // recoltorul nu atacă din mers: attackMove devine move (și apoi își reia recoltarea)
    u.order = kind === 'move' || UNITS[u.type].cargoCap > 0 ? { kind: 'move', x: slot.x, y: slot.y } : { kind: 'attackMove', x: slot.x, y: slot.y };
    if (sharedFlow) {
      nav.flow = sharedFlow;
      u.path = [];
    } else {
      nav.flow = null;
      u.path = planPath(blocked, w, h, u, slot);
    }
  }
}

// ================= punct de adunare: sloturi libere pe o grilă în jurul lui =================

/** Un loc liber lângă `rally` pentru o unitate nouă: nimeni (nici ca poziție, nici ca destinație) la mai puțin de ~0,8 spațiere. */
export function rallySlot(world: World, blocked: Uint8Array, team: number, type: UnitType, rally: Vec): Vec {
  const { w, h } = world.map;
  const s = isVehicle(type) ? VEHICLE_SPACING : INFANTRY_SPACING;
  const pts: Vec[] = [];
  for (const u of world.units.values()) {
    if (u.team !== team || UNITS[u.type].domain === 'air') continue;
    if (u.order.kind === 'move' || u.order.kind === 'attackMove') pts.push({ x: u.order.x, y: u.order.y });
    else pts.push({ x: u.x, y: u.y });
  }
  const cand: Array<{ x: number; y: number; d: number }> = [];
  for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) cand.push({ x: rally.x + i * s, y: rally.y + j * s, d: i * i + j * j });
  cand.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  for (const c of cand) {
    if (!isFree(blocked, w, h, Math.floor(c.x), Math.floor(c.y))) continue;
    if (pts.some((p) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < (s * 0.8) ** 2)) continue;
    return { x: c.x, y: c.y };
  }
  return rally;
}

/** Trimite o unitate nou produsă la un slot liber din jurul punctului de adunare. */
export function rallyUnit(world: World, internal: Internal, blocked: Uint8Array, u: Unit, rally: Vec): void {
  const slot = rallySlot(world, blocked, u.team, u.type, rally);
  const nav = getNav(internal, u.id);
  nav.flow = null;
  nav.face = fatan2(rally.y - u.y, rally.x - u.x);
  u.order = { kind: 'move', x: slot.x, y: slot.y };
  u.path = planPath(blocked, world.map.w, world.map.h, u, slot);
}

export { destinationOf };
