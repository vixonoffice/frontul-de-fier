// Aviație: bombardierele. Zbor în linie dreaptă (ignoră terenul, clădirile și separarea de la sol),
// decolare/aterizare lină, lansarea bombelor pe linia de zbor, întoarcerea la aerodrom și reîncărcarea.
// Toată starea suplimentară stă în Internal.bomber; contractul World păstrează doar alt/ammo/order.
import type { Building, EntityId, Unit, Vec, World } from './types';
import { AIR_ALTITUDE, BOMBER_PAYLOAD, BOMBER_RELOAD_TIME, UNITS } from '../data/units';
import type { Internal } from './internal';
import { getBomberState } from './internal';
import { angleDiff, dist, fatan2, fcos, fsin, turnToward } from './fmath';
import { center, sortedBuildingIds, sortedUnitIds } from './entities';

/** Sub această înălțime avionul e considerat „la sol” (poate fi lovit de orice armă). */
export const FLYING_ALT = 0.25;
const CLIMB_RATE = 2.2;            // tile/s, urcare și coborâre
const MAX_SPOTS = 6;               // locuri de parcare pe aerodrom (3 pe rând, 2 rânduri)
const LOITER_RADIUS = 5;
const ARRIVE_RADIUS = 1.0;         // sosire la punctul unui ordin move
const LAND_SNAP = 0.4;             // distanța la care aterizează efectiv pe loc
const MISALIGNED = 0.4;            // radiani; peste, aproape de țintă nu mai virează (iese și revine)
const DROP_ALIGN = 0.5;

export function isFlying(u: Unit): boolean {
  return u.alt > FLYING_ALT;
}

export function isAir(u: Unit): boolean {
  return UNITS[u.type].domain === 'air';
}

/** Poziția unui loc de parcare pe footprint-ul aerodromului. */
export function parkingSpot(b: Building, spot: number): Vec {
  const col = spot % 3, row = Math.floor(spot / 3) % 2;
  return { x: b.tx + (b.w * (col + 0.5)) / 3, y: b.ty + b.h * (row === 0 ? 0.4 : 0.75) };
}

function ownAirfields(world: World, team: number): Building[] {
  const out: Building[] = [];
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (b && b.team === team && b.type === 'airfield') out.push(b);
  }
  return out;
}

function occupiedSpots(world: World, internal: Internal, airfieldId: EntityId, selfId: EntityId): Set<number> {
  const occ = new Set<number>();
  for (const [id, st] of internal.bomber) {
    if (id === selfId || st.airfieldId !== airfieldId || !world.units.has(id)) continue;
    occ.add(st.spot);
  }
  return occ;
}

/** Cel mai apropiat aerodrom propriu cu loc liber (altfel cel mai apropiat, orice). */
export function chooseAirfield(world: World, internal: Internal, u: Unit): { b: Building; spot: number } | null {
  let best: { b: Building; spot: number } | null = null;
  let bestD = Infinity;
  let fallback: Building | null = null;
  let fallbackD = Infinity;
  for (const b of ownAirfields(world, u.team)) {
    const c = center(b);
    const d = dist(c.x - u.x, c.y - u.y);
    if (d < fallbackD) { fallbackD = d; fallback = b; }
    const occ = occupiedSpots(world, internal, b.id, u.id);
    let spot = -1;
    for (let i = 0; i < MAX_SPOTS; i++) if (!occ.has(i)) { spot = i; break; }
    if (spot >= 0 && d < bestD) { bestD = d; best = { b, spot }; }
  }
  if (best) return best;
  return fallback ? { b: fallback, spot: 0 } : null;
}

/** Creează un bombardier parcat pe un aerodrom (folosit de producție). */
export function bomberSpawnSpot(world: World, internal: Internal, team: number): { b: Building; spot: number } | null {
  let best: { b: Building; spot: number } | null = null;
  let bestCount = Infinity;
  for (const b of ownAirfields(world, team)) {
    const occ = occupiedSpots(world, internal, b.id, -1);
    let spot = -1;
    for (let i = 0; i < MAX_SPOTS; i++) if (!occ.has(i)) { spot = i; break; }
    if (spot < 0) continue;
    if (occ.size < bestCount) { bestCount = occ.size; best = { b, spot }; }
  }
  return best;
}

export function parkBomberAt(internal: Internal, u: Unit, b: Building, spot: number): void {
  const st = getBomberState(internal, u.id);
  st.airfieldId = b.id; st.spot = spot; st.parked = true; st.rearm = 0;
  const p = parkingSpot(b, spot);
  u.x = p.x; u.y = p.y; u.alt = 0; u.ammo = BOMBER_PAYLOAD; u.moving = false;
}

function homeAnchor(world: World, u: Unit): Vec {
  let fallback: Vec | null = null;
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (!b || b.team !== u.team) continue;
    if (b.type === 'hq') return center(b);
    if (!fallback) fallback = center(b);
  }
  return fallback ?? { x: world.map.w / 2, y: world.map.h / 2 };
}

function clampMap(world: World, u: Unit): void {
  u.x = Math.max(0.5, Math.min(world.map.w - 0.5, u.x));
  u.y = Math.max(0.5, Math.min(world.map.h - 0.5, u.y));
}

function approachAlt(u: Unit, desired: number, dt: number): void {
  const delta = desired - u.alt;
  const step = CLIMB_RATE * dt;
  u.alt = Math.abs(delta) <= step ? desired : u.alt + (delta > 0 ? step : -step);
  if (u.alt < 0) u.alt = 0;
}

/** Zboară spre punct: virează cu raza limitată; dacă e prea aproape și nealiniat, merge drept și revine. */
function flyToward(world: World, u: Unit, tx: number, ty: number, dt: number, speedCap: number): void {
  const def = UNITS.bomber;
  const dx = tx - u.x, dy = ty - u.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const speed = Math.min(def.speed * Math.max(0.3, Math.min(1, 0.3 + (0.7 * u.alt) / AIR_ALTITUDE)), speedCap);
  const desired = fatan2(dy, dx);
  const diff = angleDiff(u.angle, desired);
  const r = speed / def.turnRate;
  if (!(d < 2 * r && Math.abs(diff) > MISALIGNED)) u.angle = turnToward(u.angle, desired, def.turnRate * dt);
  u.turretAngle = u.angle;
  u.x += fcos(u.angle) * speed * dt;
  u.y += fsin(u.angle) * speed * dt;
  clampMap(world, u);
  u.moving = true;
}

function releaseBomb(world: World, internal: Internal, u: Unit): void {
  const weapon = UNITS.bomber.weapon!;
  const id = world.nextId++;
  world.projectiles.push({
    id, kind: 'bomb', team: u.team, x: u.x, y: u.y, fromX: u.x, fromY: u.y,
    targetId: 0, tx: u.x, ty: u.y, z: u.alt,
  });
  internal.projectileWeapon.set(id, weapon);
  internal.projectileSource.set(id, u.id);
  u.lastFireTick = world.tick;
  world.events.push({ type: 'fire', sourceId: u.id, x: u.x, y: u.y, angle: u.angle, weapon: 'bomb' });
}

export function updateBomber(world: World, internal: Internal, u: Unit, dt: number): void {
  const def = UNITS.bomber;
  const st = getBomberState(internal, u.id);

  if (st.airfieldId !== null && !world.buildings.has(st.airfieldId)) {
    st.airfieldId = null;
    st.parked = false;
  }

  // ordine străine bombardierului -> acasă
  const k = u.order.kind;
  if (k !== 'idle' && k !== 'move' && k !== 'bombRun' && k !== 'returnToBase') u.order = { kind: 'returnToBase' };
  if (u.order.kind === 'idle' && !st.parked) u.order = { kind: 'returnToBase' };

  if (u.order.kind === 'idle') {
    // parcat: stă pe loc și se reîncarcă
    const af = world.buildings.get(st.airfieldId as EntityId);
    if (!af) { u.order = { kind: 'returnToBase' }; return; }
    const p = parkingSpot(af, st.spot);
    u.x = p.x; u.y = p.y; u.alt = 0; u.moving = false;
    if (u.ammo < BOMBER_PAYLOAD) {
      st.rearm -= dt;
      if (st.rearm <= 0) u.ammo = BOMBER_PAYLOAD;
    }
    return;
  }

  st.parked = false; // a decolat (sau e deja în aer)

  if (u.order.kind === 'bombRun') {
    const { x, y } = u.order;
    if (u.ammo <= 0 && !st.dropping) { u.order = { kind: 'returnToBase' }; st.dropping = false; return; }
    approachAlt(u, AIR_ALTITUDE, dt);
    if (!st.dropping) {
      const dx = x - u.x, dy = y - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      flyToward(world, u, x, y, dt, def.speed);
      const dropStart = 0.5 * (u.ammo - 1) * def.speed * def.weapon!.reload;
      if (d <= dropStart + 0.15 && Math.abs(angleDiff(u.angle, fatan2(dy, dx))) < DROP_ALIGN && u.alt >= AIR_ALTITUDE * 0.9) {
        st.dropping = true;
        st.dropTimer = 0;
      }
    } else {
      // linie dreaptă, fără viraje, cu o bombă la fiecare `reload`
      u.x += fcos(u.angle) * def.speed * dt;
      u.y += fsin(u.angle) * def.speed * dt;
      clampMap(world, u);
      u.moving = true;
      st.dropTimer -= dt;
      while (st.dropTimer <= 0 && u.ammo > 0) {
        releaseBomb(world, internal, u);
        u.ammo -= 1;
        st.dropTimer += def.weapon!.reload;
      }
      if (u.ammo <= 0) { st.dropping = false; u.order = { kind: 'returnToBase' }; }
    }
    return;
  }

  st.dropping = false;

  if (u.order.kind === 'move') {
    const { x, y } = u.order;
    approachAlt(u, AIR_ALTITUDE, dt);
    flyToward(world, u, x, y, dt, def.speed);
    if (dist(x - u.x, y - u.y) < ARRIVE_RADIUS) u.order = { kind: 'returnToBase' };
    return;
  }

  // returnToBase
  const choice = chooseAirfield(world, internal, u);
  if (!choice) {
    // fără aerodrom: rotește în jurul bazei, nu se poate reîncărca
    st.airfieldId = null;
    const a = homeAnchor(world, u);
    if (st.loiter === 0) st.loiter = fatan2(u.y - a.y, u.x - a.x) || 0.01;
    st.loiter += (def.speed / LOITER_RADIUS) * dt * 0.8;
    approachAlt(u, AIR_ALTITUDE, dt);
    flyToward(world, u, a.x + fcos(st.loiter) * LOITER_RADIUS, a.y + fsin(st.loiter) * LOITER_RADIUS, dt, def.speed);
    return;
  }
  st.airfieldId = choice.b.id;
  st.spot = choice.spot;
  const p = parkingSpot(choice.b, choice.spot);
  const d = dist(p.x - u.x, p.y - u.y);
  if (d < LAND_SNAP && u.alt <= 0.5) {
    u.x = p.x; u.y = p.y; u.alt = 0; u.moving = false;
    st.parked = true;
    st.rearm = u.ammo < BOMBER_PAYLOAD ? BOMBER_RELOAD_TIME : 0;
    u.order = { kind: 'idle' };
    return;
  }
  approachAlt(u, Math.min(AIR_ALTITUDE, Math.max(0, (d - LAND_SNAP) * 0.6)), dt);
  flyToward(world, u, p.x, p.y, dt, Math.max(1.6, 0.8 + 0.9 * d));
}

export function updateAllBombers(world: World, internal: Internal, dt: number): void {
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (u && isAir(u)) updateBomber(world, internal, u, dt);
  }
}

/** Comenzi pentru avioane: move / bomb / stop. */
export function commandAir(
  world: World, internal: Internal, ids: readonly EntityId[],
  kind: 'move' | 'bomb' | 'stop', x: number, y: number,
): void {
  const px = Math.max(0.5, Math.min(world.map.w - 0.5, x));
  const py = Math.max(0.5, Math.min(world.map.h - 0.5, y));
  for (const id of ids) {
    const u = world.units.get(id);
    if (!u || !isAir(u)) continue;
    const st = getBomberState(internal, id);
    if (kind === 'bomb') {
      if (u.ammo <= 0) {
        if (!st.parked) u.order = { kind: 'returnToBase' };
        continue;
      }
      st.dropping = false;
      u.order = { kind: 'bombRun', x: px, y: py };
    } else if (kind === 'move') {
      st.dropping = false;
      u.order = { kind: 'move', x: px, y: py };
    } else {
      st.dropping = false;
      u.order = st.parked ? { kind: 'idle' } : { kind: 'returnToBase' };
    }
  }
}
