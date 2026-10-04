// Recoltare (mașină de stări pe recoltor) și producție (clădiri + coadă de unități).
import type { Building, BuildingType, Player, ProducerType, Team, Unit, UnitType, Vec, World } from './types';
import { TERRAIN_GROUND } from './types';
import { UNITS, STARTING_CREDITS, MAX_QUEUE, BOMBER_PAYLOAD, BOMBERS_PER_AIRFIELD } from '../data/units';
import { BUILDINGS, MAX_BUILD_DISTANCE, SELL_REFUND } from '../data/buildings';
import type { Internal } from './internal';
import { getHarvestState } from './internal';
import { findPath, nearestFree } from './path';
import { sortedUnitIds, teamBuildingsOfType, distCC } from './entities';
import { bomberSpawnSpot, isAir, parkBomberAt } from './air';
import { HARVEST_CALM_TICKS } from './movement';
import { getNav } from './internal';

function idx(w: number, x: number, y: number): number { return y * w + x; }

// --- căutarea unui tile cu minereu, prin BFS pe teren traversabil, ignorând rezervările altor recoltoare ---
const DIRS8: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const MAX_ORE_SEARCH = 4000;

function findOreTile(world: World, internal: Internal, blocked: Uint8Array, startX: number, startY: number): number {
  const { w, h, ore } = world.map;
  const seen = new Uint8Array(w * h);
  const q: number[] = [idx(w, startX, startY)];
  seen[q[0]] = 1;
  let head = 0;
  while (head < q.length && head < MAX_ORE_SEARCH) {
    const c = q[head++];
    const reserved = internal.oreReserved.get(c) ?? 0;
    if (ore[c] > 0 && reserved < 1) return c;
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = idx(w, nx, ny);
      if (seen[n]) continue;
      seen[n] = 1;
      // putem căuta prin orice teren solid (nu apă/stâncă), chiar dacă e temporar ocupat
      if (blocked[n] && ore[n] === 0) continue;
      q.push(n);
    }
  }
  return -1;
}

function nearestRefinery(world: World, team: Team, from: Vec): Building | null {
  let best: Building | null = null, bestD = Infinity;
  for (const r of teamBuildingsOfType(world, team, 'refinery')) {
    const c = { x: r.tx + r.w / 2, y: r.ty + r.h / 2 };
    const d = distCC(from, c);
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

function dockTile(r: Building): Vec {
  return { x: r.tx + r.w / 2, y: r.ty + r.h + 0.5 };
}

function releaseReservation(internal: Internal, tile: number): void {
  if (tile < 0) return;
  const cur = internal.oreReserved.get(tile) ?? 0;
  if (cur <= 1) internal.oreReserved.delete(tile);
  else internal.oreReserved.set(tile, cur - 1);
}

const HARVEST_IDLE_RESUME = 3; // secunde de inactivitate (fără daună) după care recoltorul reia singur

/** Comanda `harvest`: recoltorul merge la minereul cel mai apropiat de (x,y) și continuă bucla normală de acolo. */
export function commandHarvest(world: World, internal: Internal, blocked: Uint8Array, unit: Unit, x: number, y: number): void {
  const { w, h } = world.map;
  const hs = getHarvestState(internal, unit.id);
  releaseReservation(internal, hs.oreTile);
  hs.oreTile = -1;
  hs.refineryId = null;
  hs.idle = 0;
  const nav = getNav(internal, unit.id);
  nav.flow = null;
  nav.engagedTarget = null;
  unit.path = [];
  const sx = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const sy = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const tile = findOreTile(world, internal, blocked, sx, sy);
  if (tile < 0) { unit.order = { kind: 'harvest', phase: 'seek' }; return; }
  hs.oreTile = tile;
  internal.oreReserved.set(tile, (internal.oreReserved.get(tile) ?? 0) + 1);
  const p = findPath(blocked, w, h, Math.max(0, Math.min(w - 1, Math.floor(unit.x))), Math.max(0, Math.min(h - 1, Math.floor(unit.y))), tile % w, (tile / w) | 0);
  unit.path = p ?? [];
  unit.order = { kind: 'harvest', phase: 'toOre' };
}

export function updateHarvester(world: World, internal: Internal, blocked: Uint8Array, unit: Unit, dt: number): void {
  const def = UNITS.harvester;
  const hs = getHarvestState(internal, unit.id);
  if (unit.order.kind === 'idle') {
    // watchdog: un recoltor inactiv și nebătut reia singur recoltarea (nu rămâne blocat definitiv)
    const calm = world.tick - (internal.lastDamageTick.get(unit.id) ?? -1e9) >= HARVEST_CALM_TICKS;
    hs.idle = calm ? hs.idle + dt : 0;
    if (hs.idle >= HARVEST_IDLE_RESUME) { hs.idle = 0; unit.order = { kind: 'harvest', phase: 'seek' }; }
    return;
  }
  if (unit.order.kind !== 'harvest') return;
  hs.idle = 0;
  const { w, h, ore } = world.map;

  switch (unit.order.phase) {
    case 'seek': {
      if (unit.carry >= def.cargoCap) { unit.order = { kind: 'harvest', phase: 'toRefinery' }; break; }
      const startX = Math.max(0, Math.min(w - 1, Math.floor(unit.x)));
      const startY = Math.max(0, Math.min(h - 1, Math.floor(unit.y)));
      const tile = findOreTile(world, internal, blocked, startX, startY);
      if (tile < 0) {
        if (unit.carry > 0) unit.order = { kind: 'harvest', phase: 'toRefinery' };
        // altfel rămâne 'seek': va reîncerca tick-ul următor (nu există minereu accesibil)
        break;
      }
      hs.oreTile = tile;
      internal.oreReserved.set(tile, (internal.oreReserved.get(tile) ?? 0) + 1);
      const tx = tile % w, ty = (tile / w) | 0;
      const p = findPath(blocked, w, h, startX, startY, tx, ty);
      unit.path = p ?? [];
      unit.order = { kind: 'harvest', phase: 'toOre' };
      break;
    }
    case 'toOre': {
      if (unit.path.length > 0 || unit.moving) break;
      const tx = hs.oreTile % w, ty = (hs.oreTile / w) | 0;
      const d = distCC({ x: unit.x, y: unit.y }, { x: tx + 0.5, y: ty + 0.5 });
      if (d > 1.6) { releaseReservation(internal, hs.oreTile); hs.oreTile = -1; unit.order = { kind: 'harvest', phase: 'seek' }; break; }
      hs.timer = def.mineTime;
      unit.order = { kind: 'harvest', phase: 'mining' };
      break;
    }
    case 'mining': {
      hs.timer -= dt;
      if (hs.timer > 0) break;
      hs.timer = def.mineTime;
      const tile = hs.oreTile;
      if (tile < 0) { unit.order = { kind: 'harvest', phase: 'seek' }; break; }
      const take = Math.min(def.mineAmount, ore[tile], def.cargoCap - unit.carry);
      ore[tile] -= take;
      unit.carry += take;
      if (unit.carry >= def.cargoCap || ore[tile] <= 0) {
        releaseReservation(internal, tile);
        hs.oreTile = -1;
        unit.order = { kind: 'harvest', phase: unit.carry >= def.cargoCap ? 'toRefinery' : 'seek' };
      }
      break;
    }
    case 'toRefinery': {
      const r = nearestRefinery(world, unit.team, { x: unit.x, y: unit.y });
      if (!r) { unit.order = { kind: 'harvest', phase: 'waiting' }; hs.timer = 2; break; }
      if (hs.refineryId !== r.id || (unit.path.length === 0 && !unit.moving)) {
        const dock = dockTile(r);
        const dAlready = distCC({ x: unit.x, y: unit.y }, dock);
        if (dAlready <= 1.6 && hs.refineryId === r.id) {
          hs.timer = def.unloadTime;
          unit.order = { kind: 'harvest', phase: 'unloading' };
          break;
        }
        if (unit.path.length === 0) {
          hs.refineryId = r.id;
          const free = nearestFree(blocked, w, h, Math.floor(dock.x), Math.floor(dock.y), 5) ?? { x: Math.floor(dock.x), y: Math.floor(dock.y) };
          const p = findPath(blocked, w, h, Math.floor(unit.x), Math.floor(unit.y), free.x, free.y);
          unit.path = p ?? [];
          if (unit.path.length === 0) {
            // deja ajuns sau blocat chiar lângă doc
            hs.timer = def.unloadTime;
            unit.order = { kind: 'harvest', phase: 'unloading' };
          }
        }
      }
      break;
    }
    case 'unloading': {
      hs.timer -= dt;
      if (hs.timer > 0) break;
      hs.timer = def.unloadTime;
      const amount = Math.min(def.unloadAmount, unit.carry);
      unit.carry -= amount;
      world.players[unit.team].credits += amount;
      world.events.push({ type: 'unload', team: unit.team, x: unit.x, y: unit.y, amount });
      if (unit.carry <= 0) { hs.refineryId = null; unit.order = { kind: 'harvest', phase: 'seek' }; }
      break;
    }
    case 'waiting': {
      hs.timer -= dt;
      if (hs.timer > 0) break;
      hs.timer = 2;
      if (nearestRefinery(world, unit.team, { x: unit.x, y: unit.y })) unit.order = { kind: 'harvest', phase: 'toRefinery' };
      break;
    }
  }
}

// ================= producție =================

export function canPlaceBuilding(world: World, team: Team, type: BuildingType, tx: number, ty: number): boolean {
  const def = BUILDINGS[type];
  const { w, h, terrain, ore } = world.map;
  for (let y = 0; y < def.h; y++) {
    for (let x = 0; x < def.w; x++) {
      const X = tx + x, Y = ty + y;
      if (X < 0 || Y < 0 || X >= w || Y >= h) return false;
      const i = idx(w, X, Y);
      if (terrain[i] !== TERRAIN_GROUND) return false;
      if (ore[i] > 0) return false;
      for (const b of world.buildings.values()) {
        if (X >= b.tx && X < b.tx + b.w && Y >= b.ty && Y < b.ty + b.h) return false;
      }
      for (const u of world.units.values()) {
        if (isAir(u)) continue; // avioanele zboară peste
        if (Math.floor(u.x) === X && Math.floor(u.y) === Y) return false;
      }
    }
  }
  const cx = tx + def.w / 2, cy = ty + def.h / 2;
  for (const b of world.buildings.values()) {
    if (b.team !== team) continue;
    const bc = { x: b.tx + b.w / 2, y: b.ty + b.h / 2 };
    if (distCC(bc, { x: cx, y: cy }) < MAX_BUILD_DISTANCE) return true;
  }
  return false;
}

function nudgeOwnUnitsOffFootprint(world: World, blocked: Uint8Array, b: Building): void {
  const ids = sortedUnitIds(world);
  for (const id of ids) {
    const u = world.units.get(id);
    if (!u || u.team !== b.team || isAir(u)) continue;
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    if (ux >= b.tx && ux < b.tx + b.w && uy >= b.ty && uy < b.ty + b.h) {
      const free = nearestFree(blocked, world.map.w, world.map.h, ux, uy, 6);
      if (free) { u.x = free.x + 0.5; u.y = free.y + 0.5; }
    }
  }
}

export function spawnBuilding(world: World, internal: Internal, blocked: Uint8Array, team: Team, type: BuildingType, tx: number, ty: number): Building {
  const def = BUILDINGS[type];
  const b: Building = {
    id: world.nextId++, kind: 'building', type, team, tx, ty, w: def.w, h: def.h,
    hp: def.hp, maxHp: def.hp, turretAngle: -Math.PI / 2, cooldown: 0, lastFireTick: -1, builtTick: world.tick,
  };
  world.buildings.set(b.id, b);
  world.events.push({ type: 'buildingPlaced', team, id: b.id, building: type });
  nudgeOwnUnitsOffFootprint(world, blocked, b);
  if (type === 'refinery') {
    const dock = dockTile(b);
    const free = nearestFree(blocked, world.map.w, world.map.h, Math.floor(dock.x), Math.floor(dock.y), 5) ?? { x: Math.floor(dock.x), y: Math.floor(dock.y) };
    spawnUnit(world, internal, team, 'harvester', free.x + 0.5, free.y + 0.5, null);
  }
  return b;
}

export function spawnUnit(world: World, _internal: Internal, team: Team, type: UnitType, x: number, y: number, rally: Vec | null): Unit {
  const u: Unit = {
    id: world.nextId++, kind: 'unit', type, team, x, y,
    angle: 0, turretAngle: 0, hp: UNITS[type].hp, maxHp: UNITS[type].hp,
    order: type === 'harvester' ? { kind: 'harvest', phase: 'seek' } : { kind: 'idle' },
    path: [], carry: 0, cooldown: 0, lastFireTick: -1, moving: false, alt: 0, ammo: type === 'bomber' ? BOMBER_PAYLOAD : 0,
  };
  world.units.set(u.id, u);
  if (type !== 'harvester' && rally && UNITS[type].domain === 'ground') {
    u.order = { kind: 'move', x: rally.x, y: rally.y };
  }
  return u;
}

export function handleBuildStart(world: World, team: Team, type: BuildingType): void {
  const p = world.players[team];
  const def = BUILDINGS[type];
  if (!def.buildable || p.production.building || p.credits < def.cost) return;
  if (def.requires && !hasBuilding(world, team, def.requires)) return;
  p.credits -= def.cost;
  p.production.building = { type, progress: 0, ready: false, paid: true };
}

export function handleBuildCancel(world: World, team: Team): void {
  const p = world.players[team];
  if (!p.production.building) return;
  const def = BUILDINGS[p.production.building.type];
  p.credits += def.cost;
  p.production.building = null;
}

export function handleBuildPlace(world: World, internal: Internal, blocked: Uint8Array, team: Team, tx: number, ty: number): void {
  const p = world.players[team];
  const slot = p.production.building;
  if (!slot || !slot.ready) return;
  if (!canPlaceBuilding(world, team, slot.type, tx, ty)) return;
  spawnBuilding(world, internal, blocked, team, slot.type, tx, ty);
  p.production.building = null;
}

/** Vinde o clădire proprie: dispare imediat, iar jucătorul primește o parte din cost, proporțional cu viața rămasă. */
export function handleSell(world: World, team: Team, id: number): void {
  const b = world.buildings.get(id);
  if (!b || b.team !== team || b.type === 'hq') return;
  const refund = Math.floor(BUILDINGS[b.type].cost * SELL_REFUND * Math.max(0, Math.min(1, b.hp / b.maxHp)));
  world.players[team].credits += refund;
  world.buildings.delete(id);
  world.events.push({ type: 'sold', team, id, building: b.type, x: b.tx + b.w / 2, y: b.ty + b.h / 2, refund });
}

function hasBuilding(world: World, team: Team, type: BuildingType): boolean {
  for (const b of world.buildings.values()) if (b.team === team && b.type === type) return true;
  return false;
}

type Queue = Player['production']['units'];

/** Coada de producție corespunzătoare clădirii care produce unitatea. */
function queueFor(p: Player, producer: ProducerType): Queue {
  return producer === 'factory' ? p.production.units : producer === 'barracks' ? p.production.infantry : p.production.air;
}

/** Bombardiere permise: BOMBERS_PER_AIRFIELD per aerodrom propriu (vii + în coadă). */
export function bomberCapReached(world: World, team: Team): boolean {
  let airfields = 0;
  for (const b of world.buildings.values()) if (b.team === team && b.type === 'airfield') airfields++;
  let n = world.players[team].production.air.length;
  for (const u of world.units.values()) if (u.team === team && u.type === 'bomber') n++;
  return n >= airfields * BOMBERS_PER_AIRFIELD;
}

/**
 * Pune în coadă `count` unități (implicit 1) FĂRĂ să le plătească: fiecare se plătește abia când îi vine rândul
 * (vezi updateProduction). Respectă clădirea producătoare, MAX_QUEUE și limita de bombardiere.
 */
export function handleTrain(world: World, team: Team, type: UnitType, count = 1): void {
  const p = world.players[team];
  const def = UNITS[type];
  const queue = queueFor(p, def.producedAt);
  if (!hasBuilding(world, team, def.producedAt)) return;
  let n = Math.max(0, Math.min(Math.floor(count), MAX_QUEUE - queue.length));
  if (type === 'bomber') {
    let airfields = 0;
    for (const b of world.buildings.values()) if (b.team === team && b.type === 'airfield') airfields++;
    let have = queue.length;
    for (const u of world.units.values()) if (u.team === team && u.type === 'bomber') have++;
    n = Math.min(n, Math.max(0, airfields * BOMBERS_PER_AIRFIELD - have));
  }
  for (let i = 0; i < n; i++) queue.push({ type, progress: 0, ready: false, paid: false });
}

/** Scoate ultimul slot de acest tip (sau toate, cu `all`); rambursează integral doar sloturile deja plătite. */
export function handleTrainCancel(world: World, team: Team, type: UnitType, all = false): void {
  const p = world.players[team];
  const queue = queueFor(p, UNITS[type].producedAt);
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].type !== type) continue;
    if (queue[i].paid) p.credits += UNITS[type].cost;
    queue.splice(i, 1);
    if (!all) return;
  }
}

export function handleRally(world: World, team: Team, x: number, y: number): void {
  world.players[team].production.rally = { x, y };
}

export function updateProduction(world: World, internal: Internal, blocked: Uint8Array, dt: number): void {
  for (const p of world.players) {
    if (p.defeated) continue;
    const slot = p.production.building;
    if (slot && !slot.ready) {
      slot.progress += dt / BUILDINGS[slot.type].buildTime;
      if (slot.progress >= 1) {
        slot.progress = 1;
        slot.ready = true;
        world.events.push({ type: 'buildingReady', team: p.team, building: slot.type });
      }
    }
    // trei cozi paralele: fabrică (vehicule), cazarmă (infanterie), aerodrom (avioane)
    const producers: ProducerType[] = ['factory', 'barracks', 'airfield'];
    for (const kind of producers) {
      const queue = queueFor(p, kind);
      if (queue.length === 0) continue;
      let prod: Building | null = null;
      for (const b of world.buildings.values()) if (b.team === p.team && b.type === kind) { prod = b; break; }
      if (!prod) continue;
      const head = queue[0];
      if (!head.paid) {
        // plata se face când unitatea ajunge prima în coadă; fără bani, așteaptă la progres 0
        const cost = UNITS[head.type].cost;
        if (p.credits < cost) continue;
        p.credits -= cost;
        head.paid = true;
      }
      head.progress += dt / UNITS[head.type].buildTime;
      if (head.progress < 1) continue;
      if (kind === 'airfield') {
        const spot = bomberSpawnSpot(world, internal, p.team);
        if (!spot) { head.progress = 1; continue; } // aerodrom plin: așteaptă un loc
        queue.shift();
        const u = spawnUnit(world, internal, p.team, head.type, 0, 0, null);
        parkBomberAt(internal, u, spot.b, spot.spot);
        world.events.push({ type: 'unitReady', team: p.team, id: u.id, unit: head.type });
        continue;
      }
      queue.shift();
      const exitDock = { x: prod.tx + prod.w / 2, y: prod.ty + prod.h + 0.5 };
      const free = nearestFree(blocked, world.map.w, world.map.h, Math.floor(exitDock.x), Math.floor(exitDock.y), 5) ?? { x: Math.floor(exitDock.x), y: Math.floor(exitDock.y) };
      const rally = p.production.rally ?? { x: exitDock.x, y: exitDock.y + 2.5 };
      const u = spawnUnit(world, internal, p.team, head.type, free.x + 0.5, free.y + 0.5, head.type === 'harvester' ? null : rally);
      world.events.push({ type: 'unitReady', team: p.team, id: u.id, unit: head.type });
    }
  }
}

export function initStartingEconomy(): number {
  return STARTING_CREDITS;
}

export const _test = { findOreTile, nearestRefinery, dockTile };
