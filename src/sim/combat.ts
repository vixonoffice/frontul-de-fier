// Achiziție de țintă, rotație turelă, tragere, proiectile, daună, distrugere.
import type { Building, Entity, EntityId, Projectile, Team, Unit, Vec, WeaponFx, World } from './types';
import { TICK_RATE } from './types';
import { armorOf, center, collisionRadius, distCC, edgeDist, findEntity, sortedBuildingIds, sortedUnitIds, weaponOf } from './entities';
import { angleDiff, fatan2, turnToward } from './fmath';
import type { Internal } from './internal';
import { getNav } from './internal';
import { isVisible } from './fog';
import type { WeaponDef } from '../data/units';
import { UNITS, VETERANCY, LOW_POWER_FACTOR } from '../data/units';
import { findPath, isFree } from './path';
import { planPath } from './movement';
import { isFlying } from './air';

const UNDER_ATTACK_THROTTLE_TICKS = 10 * TICK_RATE;
const ALIGN_THRESHOLD = 0.08; // radiani

function isEnemy(world: World, team: Team, e: Entity): boolean {
  return e.team !== team && !world.players[e.team].defeated;
}

/** Poate arma să lovească ținta (aer/sol)? Avioanele în zbor doar cu canHitAir; restul doar cu canHitGround. */
export function canWeaponTarget(weapon: WeaponDef, t: Entity): boolean {
  if (t.kind === 'unit' && isFlying(t)) return weapon.canHitAir;
  return weapon.canHitGround;
}

/**
 * Caută cea mai bună țintă vizibilă, în raza dată. Unitățile au prioritate față de clădiri.
 * Dacă e dată `weapon`, țintele pe care nu le poate lovi sunt ignorate, iar scorul = distanță / multiplicator
 * `vs` (arma preferă ce lovește bine: antitancul vehicule, pușca infanterie).
 * `unitIds`/`buildingIds` (sortate) pot fi precalculate o singură dată per tick de apelant, ca să
 * evităm sortarea O(n log n) repetată pentru fiecare unitate care își caută o țintă (O(n) apeluri/tick).
 */
export function findTarget(
  world: World, team: Team, from: Vec, range: number, excludeId?: EntityId,
  unitIds?: readonly EntityId[], buildingIds?: readonly EntityId[], weapon?: WeaponDef,
): Entity | null {
  let best: Entity | null = null;
  let bestScore = Infinity;
  const minR = weapon?.minRange ?? 0;
  const findUnit = (): Entity | null => {
    let bu: Entity | null = null, bs = Infinity;
    for (const id of unitIds ?? sortedUnitIds(world)) {
      if (id === excludeId) continue;
      const u = world.units.get(id);
      if (!u || !isEnemy(world, team, u)) continue;
      let mult = 1;
      if (weapon) {
        if (!canWeaponTarget(weapon, u)) continue;
        mult = weapon.vs[armorOf(u)];
        if (mult <= 0) continue;
      }
      const d = distCC(from, { x: u.x, y: u.y });
      if (d > range || d < minR) continue;
      if (!isVisible(world, team, u.x, u.y)) continue;
      const score = d / mult;
      if (score < bs) { bs = score; bu = u; }
    }
    return bu;
  };
  const findBuilding = (): Entity | null => {
    let bb: Entity | null = null, bs = Infinity;
    for (const id of buildingIds ?? sortedBuildingIds(world)) {
      const b = world.buildings.get(id);
      if (!b || !isEnemy(world, team, b) || b.type === 'wall') continue; // zidurile nu sunt ținte automate
      let mult = 1;
      if (weapon) {
        if (!weapon.canHitGround) continue;
        mult = weapon.vs[armorOf(b)];
        if (mult <= 0) continue;
      }
      const d = edgeDist(from, b);
      if (d > range || d < minR) continue;
      const c = center(b);
      if (!isVisible(world, team, c.x, c.y)) continue;
      // artileria preferă turelele
      const tur = weapon?.kind === 'artillery' && (b.type === 'turret' || b.type === 'rocketTurret' || b.type === 'tesla') ? 0.4 : 1;
      const score = (d / mult) * tur;
      if (score < bs) { bs = score; bb = b; }
    }
    return bb;
  };
  void bestScore;
  if (weapon?.kind === 'artillery') {
    // artileria: clădiri și turele întâi, apoi unități
    best = findBuilding();
    return best ?? findUnit();
  }
  best = findUnit();
  if (best) return best;
  return findBuilding();
}

export function weaponFx(w: WeaponDef): WeaponFx {
  return w.kind === 'rocket' ? 'rocket' : w.kind === 'rifle' ? 'bullet' : w.kind === 'bomb' ? 'bomb' : w.kind === 'tesla' ? 'tesla' : w.kind === 'artillery' ? 'artillery' : 'shell';
}

function emitFire(world: World, source: Entity, aim: number, weapon: WeaponFx): void {
  const c = center(source);
  world.events.push({ type: 'fire', sourceId: source.id, x: c.x, y: c.y, angle: aim, weapon });
}

function spawnProjectile(world: World, internal: Internal, source: Entity, target: Entity, weapon: WeaponDef): void {
  const from = center(source);
  const to = center(target);
  const proj: Projectile = {
    id: world.nextId++,
    kind: weaponFx(weapon),
    team: source.team,
    x: from.x, y: from.y,
    fromX: from.x, fromY: from.y,
    targetId: weapon.kind === 'artillery' ? 0 : target.id, // obuzul de artilerie nu urmărește ținta
    tx: to.x, ty: to.y,
  };
  internal.projectileWeapon.set(proj.id, weapon);
  internal.projectileSource.set(proj.id, source.id);
  world.projectiles.push(proj);
}

function fire(world: World, internal: Internal, source: Entity, target: Entity, weapon: WeaponDef): void {
  const c = center(source);
  const t = center(target);
  const aim = fatan2(t.y - c.y, t.x - c.x);
  emitFire(world, source, aim, weaponFx(weapon));
  if (weapon.instant) {
    // Tesla: lovește pe loc, în același tick
    world.events.push({ type: 'hit', x: t.x, y: t.y, weapon: weaponFx(weapon) });
    const p: Projectile = { id: -1, kind: weaponFx(weapon), team: source.team, x: t.x, y: t.y, fromX: c.x, fromY: c.y, targetId: target.id, tx: t.x, ty: t.y };
    if (weapon.splash > 0) applySplash(world, internal, p, weapon, source.id);
    else applyDamage(world, internal, target, weapon.damage, weapon, source.id);
    return;
  }
  spawnProjectile(world, internal, source, target, weapon);
}

function noteUnderAttack(world: World, internal: Internal, team: Team, pos: Vec): void {
  const last = internal.lastUnderAttackTick.get(team) ?? -Infinity;
  if (world.tick - last >= UNDER_ATTACK_THROTTLE_TICKS) {
    internal.lastUnderAttackTick.set(team, world.tick);
    world.events.push({ type: 'underAttack', team, x: pos.x, y: pos.y });
  }
}

export function applyDamage(world: World, internal: Internal, target: Entity, rawDamage: number, weapon: WeaponDef, sourceId?: EntityId): void {
  const mult = weapon.vs[armorOf(target)];
  const src = sourceId !== undefined ? world.units.get(sourceId) : undefined;
  const dmg = rawDamage * mult * (src ? VETERANCY.damageMult[src.rank] : 1);
  target.hp -= dmg;
  if (target.kind === 'unit') internal.lastDamageTick.set(target.id, world.tick);
  // lovitură în clădire sau recoltor: declanșează gardienii
  if (target.kind === 'building' || UNITS[target.type].cargoCap > 0) {
    const hc = center(target);
    internal.lastHit.set(target.team, { x: hc.x, y: hc.y, tick: world.tick });
    let log = internal.hitLog.get(target.team);
    if (!log) { log = []; internal.hitLog.set(target.team, log); }
    if (target.kind === 'building' && target.type !== 'wall') { log.push({ x: hc.x, y: hc.y }); if (log.length > 16) log.shift(); }
  }
  const c = center(target);
  if (!world.players[target.team].defeated) noteUnderAttack(world, internal, target.team, c);
  if (target.hp <= 0) {
    destroyEntity(world, internal, target);
    if (sourceId !== undefined) creditKill(world, internal, sourceId);
  }
}

/** Creditează o distrugere unității care a tras lovitura (grade: vezi etapa B). */
export function creditKill(world: World, internal: Internal, killerId: EntityId): void {
  const k = world.units.get(killerId);
  if (!k) return;
  k.kills += 1;
  void internal;
  // grad: la pragurile din VETERANCY.killsFor; viața maximă crește proporțional cu viața curentă
  let rank = 0;
  for (const t of VETERANCY.killsFor) if (k.kills >= t) rank++;
  if (rank > k.rank) {
    const r = Math.min(2, rank) as 1 | 2;
    const ratio = VETERANCY.hpMult[r] / VETERANCY.hpMult[k.rank];
    k.rank = r;
    k.maxHp *= ratio;
    k.hp *= ratio;
    world.events.push({ type: 'promoted', id: k.id, team: k.team, rank: r, x: k.x, y: k.y });
  }
}

export function destroyEntity(world: World, internal: Internal, target: Entity): void {
  const c = center(target);
  const size = target.kind === 'unit' ? collisionRadius(target) * 2 : Math.max(target.w, target.h);
  world.events.push({ type: 'destroyed', id: target.id, kind: target.kind, team: target.team, x: c.x, y: c.y, size });
  if (target.kind === 'unit') {
    world.units.delete(target.id);
    internal.nav.delete(target.id);
    internal.harvest.delete(target.id);
    internal.bomber.delete(target.id);
    internal.lastDamageTick.delete(target.id);
    internal.guardPost.delete(target.id);
    internal.guardState.delete(target.id);
    internal.playerRole.delete(target.id);
  } else {
    world.buildings.delete(target.id);
  }
}

function weaponAndRangeOf(e: Entity): { weapon: WeaponDef; range: number } | null {
  const w = weaponOf(e);
  if (!w) return null;
  return { weapon: w, range: w.range };
}

function aimTurret(e: Unit | Building, aimPoint: Vec, turnRate: number, dt: number): number {
  const c = center(e);
  const want = fatan2(aimPoint.y - c.y, aimPoint.x - c.x);
  const next = turnToward(e.turretAngle, want, turnRate * dt);
  e.turretAngle = next;
  return angleDiff(next, want);
}

function tryFireAt(world: World, internal: Internal, e: Unit | Building, target: Entity, weapon: WeaponDef, dt: number): void {
  // lipsa de curent încetinește turelele (reîncărcare mai lentă)
  e.cooldown -= e.kind === 'building' && internal.lowPower.get(e.team) ? dt * LOW_POWER_FACTOR : dt;
  const turnRate = e.kind === 'unit' ? (UNITS[e.type].turretTurnRate || UNITS[e.type].turnRate) : 4;
  const aligned = Math.abs(aimTurret(e, center(target), turnRate, dt)) < ALIGN_THRESHOLD;
  if (e.cooldown <= 0 && aligned) {
    e.cooldown = weapon.reload;
    e.lastFireTick = world.tick;
    fire(world, internal, e, target, weapon);
  }
}

const IDLE_ENGAGE_MARGIN = 1.5;
const HOLD_LEASH_MARGIN = 3;
const REPATH_INTERVAL = 0.9;

export function updateUnitCombat(
  world: World, internal: Internal, blocked: Uint8Array, unit: Unit, dt: number,
  unitIds?: readonly EntityId[], buildingIds?: readonly EntityId[],
): void {
  const def = UNITS[unit.type];
  if (!def.weapon || def.domain === 'air') return; // recoltorul nu luptă; avioanele au logica în air.ts
  const wr = weaponAndRangeOf(unit);
  if (!wr) return;
  const { weapon, range } = wr;
  const nav = getNav(internal, unit.id);

  if (def.cargoCap > 0) {
    // recoltor blindat: trage în inamicii din rază în timp ce lucrează, fără să urmărească pe nimeni
    const t = findTarget(world, unit.team, { x: unit.x, y: unit.y }, range, unit.id, unitIds, buildingIds, weapon);
    if (t) tryFireAt(world, internal, unit, t, weapon, dt);
    else unit.cooldown = Math.max(0, unit.cooldown - dt);
    return;
  }

  if (nav.engagedTarget !== null) {
    const t = findEntity(world, nav.engagedTarget);
    if (!t || !isVisible(world, unit.team, center(t).x, center(t).y) || !canWeaponTarget(weapon, t)) {
      nav.engagedTarget = null;
    }
  }

  if (unit.order.kind === 'attack') {
    if (nav.engagedTarget !== unit.order.targetId) nav.engagedTarget = unit.order.targetId;
    const t = findEntity(world, unit.order.targetId);
    if (!t || !canWeaponTarget(weapon, t)) {
      unit.order = { kind: 'idle' };
      nav.engagedTarget = null;
    } else {
      const r = edgeDist({ x: unit.x, y: unit.y }, t);
      if (r <= range) {
        unit.path = [];
      } else {
        nav.repathCooldown -= dt;
        if (nav.repathCooldown <= 0 && unit.path.length === 0) {
          nav.repathCooldown = REPATH_INTERVAL;
          const tc = center(t);
          const p = findPath(blocked, world.map.w, world.map.h, Math.floor(unit.x), Math.floor(unit.y), Math.floor(tc.x), Math.floor(tc.y));
          if (p) unit.path = p;
        }
      }
    }
  } else if (unit.order.kind === 'attackMove') {
    if (nav.engagedTarget === null) {
      const t = findTarget(world, unit.team, { x: unit.x, y: unit.y }, weapon.minRange ? range : def.sight, unit.id, unitIds, buildingIds, weapon);
      if (t) nav.engagedTarget = t.id;
    }
    if (nav.engagedTarget !== null) {
      const t = findEntity(world, nav.engagedTarget);
      if (t) {
        const r = edgeDist({ x: unit.x, y: unit.y }, t);
        if (r <= range) unit.path = [];
        else {
          nav.repathCooldown -= dt;
          if (nav.repathCooldown <= 0 && unit.path.length === 0) {
            nav.repathCooldown = REPATH_INTERVAL;
            const tc = center(t);
            const p = findPath(blocked, world.map.w, world.map.h, Math.floor(unit.x), Math.floor(unit.y), Math.floor(tc.x), Math.floor(tc.y));
            if (p) unit.path = p;
          }
        }
      }
    } else if (unit.path.length === 0) {
      const dx = unit.order.x - unit.x, dy = unit.order.y - unit.y;
      if (dx * dx + dy * dy < 1) unit.order = { kind: 'idle' };
      else if (internal.hasWalls && !unit.moving) {
        // oprit departe de destinație, fără traseu: reface traseul sau sparge zidurile care îi taie drumul
        nav.repathCooldown -= dt;
        if (nav.repathCooldown <= 0) {
          nav.repathCooldown = REPATH_INTERVAL;
          stuckAttackMove(world, internal, blocked, unit, unit.order.x, unit.order.y);
        }
      }
    }
  } else if (unit.order.kind === 'idle' || unit.order.kind === 'move') {
    if (nav.engagedTarget === null) {
      const t = findTarget(world, unit.team, { x: unit.x, y: unit.y }, range + IDLE_ENGAGE_MARGIN, unit.id, unitIds, buildingIds, weapon);
      if (t && unit.order.kind === 'idle') {
        nav.engagedTarget = t.id;
        nav.holdOriginX = unit.x;
        nav.holdOriginY = unit.y;
      }
    } else {
      const t = findEntity(world, nav.engagedTarget);
      if (!t) {
        nav.engagedTarget = null;
      } else {
        const r = edgeDist({ x: unit.x, y: unit.y }, t);
        if (r > range + HOLD_LEASH_MARGIN) {
          nav.engagedTarget = null;
        } else if (r <= range) {
          if (unit.order.kind === 'idle') unit.path = [];
        } else if (unit.order.kind === 'idle') {
          nav.repathCooldown -= dt;
          if (nav.repathCooldown <= 0 && unit.path.length === 0) {
            nav.repathCooldown = REPATH_INTERVAL;
            const tc = center(t);
            const p = findPath(blocked, world.map.w, world.map.h, Math.floor(unit.x), Math.floor(unit.y), Math.floor(tc.x), Math.floor(tc.y));
            if (p) unit.path = p;
          }
        }
      }
    }
  }

  // aliniere + tragere pe ținta curentă (explicită sau angajată automat)
  let aimTarget: Entity | null = null;
  if (unit.order.kind === 'attack') aimTarget = findEntity(world, unit.order.targetId) ?? null;
  else if (nav.engagedTarget !== null) aimTarget = findEntity(world, nav.engagedTarget) ?? null;

  if (aimTarget && weapon.minRange !== undefined) {
    const r0 = edgeDist({ x: unit.x, y: unit.y }, aimTarget);
    if (r0 < weapon.minRange) {
      // prea aproape (artilerie): cu ordin explicit se retrage ca să deschidă distanța, altfel doar nu trage
      if (unit.order.kind === 'attack') {
        const tc = center(aimTarget);
        const dx = unit.x - tc.x, dy = unit.y - tc.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const want = weapon.minRange + 1.2 + collisionRadius(aimTarget);
        const nx = Math.max(1, Math.min(world.map.w - 2, tc.x + (dx / d) * want));
        const ny = Math.max(1, Math.min(world.map.h - 2, tc.y + (dy / d) * want));
        if (isFree(blocked, world.map.w, world.map.h, Math.floor(nx), Math.floor(ny))) unit.path = [{ x: nx, y: ny }];
      }
      aimTarget = null;
    }
  }

  if (aimTarget) {
    const r = edgeDist({ x: unit.x, y: unit.y }, aimTarget);
    if (r <= range) tryFireAt(world, internal, unit, aimTarget, weapon, dt);
    else {
      // menține turela orientată spre direcția de mișcare dacă nu e nimic de țintit
      aimTurret(unit, center(aimTarget), def.turretTurnRate || def.turnRate, dt);
    }
  } else {
    unit.cooldown = Math.max(0, unit.cooldown - dt);
  }
}

export function updateTurretBuilding(
  world: World, internal: Internal, building: Building, dt: number,
  unitIds?: readonly EntityId[], buildingIds?: readonly EntityId[],
): void {
  const w = weaponOf(building);
  if (!w) return;
  // Tesla nu trage deloc fără curent (celelalte turele doar încetinesc)
  if (w.instant && internal.lowPower.get(building.team)) { building.cooldown = Math.max(0, building.cooldown - dt); return; }
  const t = findTarget(world, building.team, center(building), w.range, undefined, unitIds, buildingIds, w);
  if (t) {
    tryFireAt(world, internal, building, t, w, dt);
  } else {
    building.cooldown = Math.max(0, building.cooldown - dt);
  }
}

export function updateProjectiles(world: World, internal: Internal, dt: number): void {
  const alive: Projectile[] = [];
  for (const p of world.projectiles) {
    const sourceWeapon = internal.projectileWeapon.get(p.id) ?? FALLBACK_WEAPON;
    if (p.kind === 'bomb') {
      // bombă: cade vertical spre punctul de sub avion; la impact daună de zonă doar inamicilor de la sol
      const z = (p.z ?? 0) - sourceWeapon.projectileSpeed * dt;
      if (z > 0) { p.z = z; alive.push(p); continue; }
      p.z = 0;
      world.events.push({ type: 'hit', x: p.tx, y: p.ty, weapon: 'bomb' });
      applySplash(world, internal, p, sourceWeapon);
      internal.projectileWeapon.delete(p.id);
      internal.projectileSource.delete(p.id);
      continue;
    }
    const target = findEntity(world, p.targetId);
    if (target && sourceWeapon.kind !== 'artillery') {
      const c = center(target);
      p.tx = c.x; p.ty = c.y;
    }
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const step = sourceWeapon.projectileSpeed * dt;
    if (d <= step + 0.05) {
      world.events.push({ type: 'hit', x: p.tx, y: p.ty, weapon: p.kind });
      if (sourceWeapon.splash > 0) {
        applySplash(world, internal, p, sourceWeapon);
      } else if (target && canWeaponTarget(sourceWeapon, target)) {
        applyDamage(world, internal, target, sourceWeapon.damage, sourceWeapon, internal.projectileSource.get(p.id));
      }
      internal.projectileWeapon.delete(p.id);
      internal.projectileSource.delete(p.id);
      continue;
    }
    p.x += (dx / d) * step;
    p.y += (dy / d) * step;
    alive.push(p);
  }
  world.projectiles.length = 0;
  world.projectiles.push(...alive);
}

function applySplash(world: World, internal: Internal, p: Projectile, weapon: WeaponDef, sourceId?: EntityId): void {
  const src = sourceId ?? internal.projectileSource.get(p.id);
  const victims: Entity[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (u && u.team !== p.team && canWeaponTarget(weapon, u)) victims.push(u);
  }
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (b && b.team !== p.team && weapon.canHitGround) victims.push(b);
  }
  for (const v of victims) {
    const d = edgeDist({ x: p.tx, y: p.ty }, v);
    if (d <= weapon.splash) {
      // bombă: daună plină aproape de centru, jumătate la margine; rest: plină doar pe ținta principală
      const isPrimary = p.kind === 'bomb' || p.kind === 'artillery' ? d <= weapon.splash * 0.5 : v.id === p.targetId;
      applyDamage(world, internal, v, isPrimary ? weapon.damage : weapon.damage * 0.5, weapon, src);
    }
  }
}

// fallback dacă, improbabil, proiectilul nu mai are arma înregistrată (nu ar trebui să se întâmple)
const FALLBACK_WEAPON: WeaponDef = { kind: 'cannon', damage: 0, reload: 1, range: 0, projectileSpeed: 16, splash: 0, vs: { lightVehicle: 1, heavyVehicle: 1, structure: 1, infantry: 1, aircraft: 1 }, canHitAir: false, canHitGround: true };


/**
 * Un attack-move oprit departe de destinație: întâi încearcă un traseu normal; dacă nu există, caută unul care ar trece
 * prin ziduri inamice și atacă primul zid din cale.
 */
function stuckAttackMove(world: World, internal: Internal, blocked: Uint8Array, unit: Unit, dx: number, dy: number): void {
  const { w, h } = world.map;
  const nav = getNav(internal, unit.id);
  const p = planPath(blocked, w, h, unit, { x: dx, y: dy });
  if (p.length > 0) { unit.path = p; nav.flow = null; return; }
  const walls = new Map<number, Building>();
  for (const b of world.buildings.values()) if (b.type === 'wall' && b.team !== unit.team) walls.set(b.ty * w + b.tx, b);
  if (walls.size === 0) return;
  const grid = blocked.slice();
  for (const k of walls.keys()) grid[k] = 0;
  const p2 = planPath(grid, w, h, unit, { x: dx, y: dy });
  if (p2.length === 0) return;
  // primul zid întâlnit pe traseul fără ziduri
  let px = unit.x, py = unit.y;
  for (const wp of p2) {
    const len = Math.sqrt((wp.x - px) ** 2 + (wp.y - py) ** 2);
    const n = Math.max(1, Math.ceil(len / 0.4));
    for (let i = 1; i <= n; i++) {
      const x = px + ((wp.x - px) * i) / n, y = py + ((wp.y - py) * i) / n;
      const wall = walls.get(Math.floor(y) * w + Math.floor(x));
      if (wall) { nav.flow = null; nav.engagedTarget = wall.id; return; }
    }
    px = wp.x; py = wp.y;
  }
}
