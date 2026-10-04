// Recoltare (mașină de stări pe recoltor) și producție (clădiri + coadă de unități).
import type { Building, BuildingType, Player, ProducerType, Team, Unit, UnitType, Vec, World } from './types';
import { TERRAIN_GROUND } from './types';
import { UNITS, STARTING_CREDITS, MAX_QUEUE, BOMBER_PAYLOAD, BOMBERS_PER_AIRFIELD } from '../data/units';
import { BUILDINGS, MAX_BUILD_DISTANCE, SELL_REFUND } from '../data/buildings';
import type { Internal } from './internal';
import { getHarvestState } from './internal';
import type { HarvestState } from './internal';
import { isFree, nearestFree } from './path';
import { sortedUnitIds, teamBuildingsOfType, distCC } from './entities';
import { bomberSpawnSpot, isAir, parkBomberAt } from './air';
import { HARVEST_CALM_TICKS, planPath, rallyUnit } from './movement';
import { getNav } from './internal';

function idx(w: number, x: number, y: number): number { return y * w + x; }

// --- căutarea unui tile cu minereu, prin BFS pe teren traversabil, ignorând rezervările altor recoltoare ---
const DIRS8: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const MAX_ORE_SEARCH = 4000;

function findOreTile(world: World, internal: Internal, blocked: Uint8Array, startX: number, startY: number, exclude = -1): number {
  const { w, h, ore } = world.map;
  const seen = new Uint8Array(w * h);
  const q: number[] = [idx(w, startX, startY)];
  seen[q[0]] = 1;
  let head = 0;
  while (head < q.length && head < MAX_ORE_SEARCH) {
    const c = q[head++];
    const reserved = internal.oreReserved.get(c) ?? 0;
    if (ore[c] > 0 && reserved < 1 && c !== exclude) return c;
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
  leaveQueues(internal, unit.id);
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
  unit.path = planPath(blocked, w, h, unit, { x: (tile % w) + 0.5, y: ((tile / w) | 0) + 0.5 });
  unit.order = { kind: 'harvest', phase: 'toOre' };
}

// ----- rafinării: un singur dock, coadă vizibilă pe tile-uri libere lângă drumul de apropiere -----

const QUEUE_WAIT = 1.2;        // secunde estimate per recoltor aflat înaintea ta (descărcare + manevră)
const STUCK_SECONDS = 3;       // fără progres atât timp cât are traseu => reface traseul / schimbă ținta
const BAN_SECONDS = 15;        // rafinăria de care s-a blocat e evitată un timp

/** Centrul tile-ului de dock al rafinăriei: tile-ul de sub mijlocul ei (sau cel mai apropiat liber). */
export function dockCenter(world: World, blocked: Uint8Array, r: Building): Vec {
  const { w, h } = world.map;
  const cx = Math.floor(r.tx + r.w / 2), cy = r.ty + r.h;
  const f = isFree(blocked, w, h, cx, cy) ? { x: cx, y: cy } : (nearestFree(blocked, w, h, cx, cy, 4) ?? { x: cx, y: cy });
  return { x: f.x + 0.5, y: f.y + 0.5 };
}

/** Locul de așteptare nr. `i`: pe rândul docului (lateral), apoi pe rândurile următoare, mereu în afara drumului de ieșire. */
function queueSlot(world: World, blocked: Uint8Array, r: Building, i: number): Vec {
  const { w, h } = world.map;
  const d = dockCenter(world, blocked, r);
  const dx0 = Math.floor(d.x), dy0 = Math.floor(d.y);
  const slots: Vec[] = [];
  for (let row = 0; row < 3 && slots.length <= i; row++) {
    for (let k = row === 0 ? 1 : 2; k <= 6; k++) {
      for (const sgn of [-1, 1]) {
        const x = dx0 + sgn * k, y = dy0 + row;
        if (isFree(blocked, w, h, x, y)) slots.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  return slots[i] ?? slots[slots.length - 1] ?? d;
}

/** Eliberează docul/coada de recoltoare dispărute sau care au plecat; chemat o dată pe tick. */
export function updateDocks(world: World, internal: Internal, blocked: Uint8Array): void {
  for (const [rid, dock] of internal.docks) {
    const r = world.buildings.get(rid);
    if (!r) { internal.docks.delete(rid); continue; }
    const dc = dockCenter(world, blocked, r);
    const valid = (id: number): boolean => {
      const u = world.units.get(id);
      if (!u || u.order.kind !== 'harvest') return false;
      const hs = internal.harvest.get(id);
      return !!hs && hs.refineryId === rid && (u.order.phase === 'toRefinery' || u.order.phase === 'unloading');
    };
    dock.queue = dock.queue.filter(valid);
    if (dock.occupant !== null) {
      const u = world.units.get(dock.occupant);
      // dreptul de trecere: docul rămâne al celui care pleacă până se îndepărtează de el
      if (!u || (!valid(dock.occupant) && distCC(u, dc) > 1.1)) dock.occupant = null;
    }
  }
}

function getDock(internal: Internal, rid: number): { occupant: number | null; queue: number[] } {
  let d = internal.docks.get(rid);
  if (!d) { d = { occupant: null, queue: [] }; internal.docks.set(rid, d); }
  return d;
}

function leaveQueues(internal: Internal, id: number): void {
  for (const d of internal.docks.values()) {
    const i = d.queue.indexOf(id);
    if (i >= 0) d.queue.splice(i, 1);
  }
}

/** Alege rafinăria cu timpul total estimat cel mai mic (drum + coadă x timp de descărcare). */
function chooseRefinery(world: World, internal: Internal, blocked: Uint8Array, unit: Unit, banned: number): Building | null {
  const speed = UNITS[unit.type].speed;
  let best: Building | null = null, bestT = Infinity;
  for (const r of teamBuildingsOfType(world, unit.team, 'refinery')) {
    if (r.id === banned) continue;
    const dock = internal.docks.get(r.id);
    const ahead = dock ? dock.queue.filter((id) => id !== unit.id).length + (dock.occupant !== null && dock.occupant !== unit.id ? 1 : 0) : 0;
    const t = distCC(unit, dockCenter(world, blocked, r)) / speed + ahead * QUEUE_WAIT;
    if (t < bestT - 1e-9 || (Math.abs(t - bestT) <= 1e-9 && best && r.id < best.id)) { bestT = t; best = r; }
  }
  if (!best && banned >= 0) return chooseRefinery(world, internal, blocked, unit, -1);
  return best;
}

/** Trece în faza de mers la rafinărie; rafinăria se alege din nou (se reevaluează după fiecare încărcare). */
function goRefinery(internal: Internal, unit: Unit, hs: HarvestState): void {
  leaveQueues(internal, unit.id);
  hs.refineryId = null;
  hs.slot = -1;
  unit.path = [];
  unit.order = { kind: 'harvest', phase: 'toRefinery' };
}

function setPath(world: World, blocked: Uint8Array, unit: Unit, dest: Vec, avoidTile: Vec | null): void {
  const { w, h } = world.map;
  let grid = blocked;
  if (avoidTile) {
    // docul e interzis celor care nu sunt la rând: ocolesc tile-ul
    grid = blocked.slice();
    const i = Math.floor(avoidTile.y) * w + Math.floor(avoidTile.x);
    if (Math.floor(unit.x) + Math.floor(unit.y) * w !== i && Math.floor(dest.x) + Math.floor(dest.y) * w !== i) grid[i] = 1;
  }
  unit.path = planPath(grid, w, h, unit, dest);
}

export function updateHarvester(world: World, internal: Internal, blocked: Uint8Array, unit: Unit, dt: number): void {
  const def = UNITS[unit.type];
  const hs = getHarvestState(internal, unit.id);
  if (hs.banT > 0) hs.banT -= dt;
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

  // detectarea blocajelor: are traseu dar nu înaintează => refă traseul / alege altceva
  if (unit.path.length > 0) {
    if (Math.abs(unit.x - hs.lx) + Math.abs(unit.y - hs.ly) > 0.05) { hs.lx = unit.x; hs.ly = unit.y; hs.stuck = 0; }
    else hs.stuck += dt;
  } else { hs.lx = unit.x; hs.ly = unit.y; hs.stuck = 0; }
  if (hs.stuck >= STUCK_SECONDS) {
    hs.stuck = 0;
    unit.path = [];
    if (unit.order.phase === 'toOre') {
      releaseReservation(internal, hs.oreTile);
      hs.badTile = hs.oreTile;
      hs.oreTile = -1;
      unit.order = { kind: 'harvest', phase: 'seek' };
    } else if (unit.order.phase === 'toRefinery') {
      hs.banRef = hs.refineryId ?? -1;
      hs.banT = BAN_SECONDS;
      goRefinery(internal, unit, hs);
    }
  }

  switch (unit.order.phase) {
    case 'seek': {
      if (unit.carry >= def.cargoCap) { goRefinery(internal, unit, hs); break; }
      // minereul se caută lângă rafinăria spre care se va întoarce (altfel de unde se află)
      let startX = Math.floor(unit.x), startY = Math.floor(unit.y);
      const lr = hs.lastRef >= 0 ? world.buildings.get(hs.lastRef) : undefined;
      if (lr && lr.team === unit.team) {
        const dc = dockCenter(world, blocked, lr);
        startX = Math.floor(dc.x); startY = Math.floor(dc.y);
      }
      startX = Math.max(0, Math.min(w - 1, startX));
      startY = Math.max(0, Math.min(h - 1, startY));
      const tile = findOreTile(world, internal, blocked, startX, startY, hs.badTile);
      if (tile < 0) {
        if (unit.carry > 0) goRefinery(internal, unit, hs);
        // altfel rămâne 'seek': va reîncerca tick-ul următor (nu există minereu accesibil)
        break;
      }
      hs.badTile = -1;
      hs.oreTile = tile;
      internal.oreReserved.set(tile, (internal.oreReserved.get(tile) ?? 0) + 1);
      setPath(world, blocked, unit, { x: (tile % w) + 0.5, y: ((tile / w) | 0) + 0.5 }, null);
      unit.order = { kind: 'harvest', phase: 'toOre' };
      break;
    }
    case 'toOre': {
      if (unit.path.length > 0 || unit.moving) break;
      const tx = hs.oreTile % w, ty = (hs.oreTile / w) | 0;
      const d = distCC({ x: unit.x, y: unit.y }, { x: tx + 0.5, y: ty + 0.5 });
      if (hs.oreTile < 0 || d > 1.6) { releaseReservation(internal, hs.oreTile); hs.oreTile = -1; unit.order = { kind: 'harvest', phase: 'seek' }; break; }
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
        if (unit.carry >= def.cargoCap) goRefinery(internal, unit, hs);
        else unit.order = { kind: 'harvest', phase: 'seek' };
      }
      break;
    }
    case 'toRefinery': {
      let r = hs.refineryId !== null ? world.buildings.get(hs.refineryId) : undefined;
      if (!r || r.team !== unit.team) {
        leaveQueues(internal, unit.id);
        r = chooseRefinery(world, internal, blocked, unit, hs.banT > 0 ? hs.banRef : -1) ?? undefined;
        if (!r) { hs.refineryId = null; unit.order = { kind: 'harvest', phase: 'waiting' }; hs.timer = 2; break; }
        hs.refineryId = r.id;
        hs.lastRef = r.id;
        hs.slot = -1;
        unit.path = [];
      }
      const dock = getDock(internal, r.id);
      const dc = dockCenter(world, blocked, r);
      if (dock.occupant === unit.id) {
        const d = distCC(unit, dc);
        if (d <= 0.45 || (d < 1.3 && unit.path.length === 0 && !unit.moving)) {
          hs.timer = def.unloadTime;
          unit.path = [];
          unit.order = { kind: 'harvest', phase: 'unloading' };
        } else if (unit.path.length === 0 && !unit.moving) {
          setPath(world, blocked, unit, dc, null);
          if (unit.path.length === 0) { hs.timer = def.unloadTime; unit.order = { kind: 'harvest', phase: 'unloading' }; }
        }
        break;
      }
      if (!dock.queue.includes(unit.id)) dock.queue.push(unit.id);
      if (dock.occupant === null && dock.queue[0] === unit.id) {
        dock.queue.shift();
        dock.occupant = unit.id;
        hs.slot = -1;
        setPath(world, blocked, unit, dc, null);
        break;
      }
      const slotIdx = dock.queue.indexOf(unit.id);
      if (slotIdx !== hs.slot) {
        hs.slot = slotIdx;
        const sp = queueSlot(world, blocked, r, slotIdx);
        if (distCC(unit, sp) > 0.3) setPath(world, blocked, unit, sp, dc);
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
      if (unit.carry <= 0) { hs.slot = -1; unit.order = { kind: 'harvest', phase: 'seek' }; /* refineryId rămâne până pleacă de pe dock */ }
      break;
    }
    case 'waiting': {
      hs.timer -= dt;
      if (hs.timer > 0) break;
      hs.timer = 2;
      if (nearestRefinery(world, unit.team, { x: unit.x, y: unit.y })) goRefinery(internal, unit, hs);
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
    hp: def.hp, maxHp: def.hp, turretAngle: -Math.PI / 2, cooldown: 0, lastFireTick: -1, builtTick: world.tick, repairing: false,
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
    order: UNITS[type].cargoCap > 0 ? { kind: 'harvest', phase: 'seek' } : { kind: 'idle' },
    path: [], carry: 0, cooldown: 0, lastFireTick: -1, moving: false, alt: 0, ammo: type === 'bomber' ? BOMBER_PAYLOAD : 0, role: 'attack', kills: 0, rank: 0,
  };
  world.units.set(u.id, u);
  if (UNITS[type].cargoCap === 0 && rally && UNITS[type].domain === 'ground') {
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
      const rally = p.production.rally ?? { x: exitDock.x, y: exitDock.y + 4 };
      const u = spawnUnit(world, internal, p.team, head.type, free.x + 0.5, free.y + 0.5, null);
      // unitățile noi ocupă sloturi libere pe o grilă în jurul punctului de adunare
      if (UNITS[head.type].cargoCap === 0) rallyUnit(world, internal, blocked, u, rally);
      world.events.push({ type: 'unitReady', team: p.team, id: u.id, unit: head.type });
    }
  }
}

export function initStartingEconomy(): number {
  return STARTING_CREDITS;
}

export const _test = { findOreTile, nearestRefinery, dockTile };
