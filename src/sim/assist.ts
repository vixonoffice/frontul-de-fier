// Asistentul jucătorului (doar jucători umani): trei moduri independente, economie / apărare / atac.
// Rulează în step(), determinist (fără rng), și acționează EXCLUSIV prin comenzi normale (aceleași costuri și reguli
// ca pentru jucător): nu are bani sau viteză în plus. Fiecare mod își ia decizia o dată pe secundă, eșalonat.
import type { AssistMode, Building, BuildingType, Command, EntityId, Player, Team, Unit, UnitType, Vec, World } from './types';
import { BUILDINGS } from '../data/buildings';
import { MAX_QUEUE, UNITS } from '../data/units';
import type { AssistMem, Internal } from './internal';
import { getAssistMem } from './internal';
import { isVisible } from './fog';
import { center, distCC, sortedBuildingIds, sortedUnitIds } from './entities';
import { findPlacement } from './placement';
import { isFlying } from './air';

const PLAYER_COOLDOWN_TICKS = 200;   // ~10 s: unitățile comandate de jucător nu sunt atinse
const EVENT_THROTTLE_TICKS = 20;     // cel mult un eveniment 'assist' pe secundă pe mod
const DEFEND_RADIUS = 12;            // inamic la mai puțin de atât de o clădire proprie = alarmă
const ARMY_NEAR_BASE = 18;           // „strâns la bază”
const ATTACK_START = 8;              // pragul primului atac
const ATTACK_GROWTH = 2;             // cu cât crește pragul după fiecare atac
const ATTACK_CAP = 30;
const MAX_REFINERIES = 4;
const COMBAT: ReadonlySet<UnitType> = new Set<UnitType>(['tank', 'rocket', 'soldier', 'bazooka']);
const QUEUE_DEPTH = 3;               // atacul ține cozile umplute până la atât (plată pe rând)

// ---------- utilitare ----------

function ownBuildings(world: World, team: Team): Building[] {
  const out: Building[] = [];
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (b && b.team === team) out.push(b);
  }
  return out;
}

function countType(bs: Building[], type: BuildingType): number {
  let n = 0;
  for (const b of bs) if (b.type === type) n++;
  return n;
}

function baseCenter(bs: Building[], world: World): Vec {
  const hq = bs.find((b) => b.type === 'hq') ?? bs[0];
  return hq ? center(hq) : { x: world.map.w / 2, y: world.map.h / 2 };
}

function recentPlayer(internal: Internal, id: EntityId, tick: number): boolean {
  const t = internal.lastPlayerCmd.get(id);
  return t !== undefined && tick - t < PLAYER_COOLDOWN_TICKS;
}

function emit(world: World, mem: AssistMem, team: Team, mode: AssistMode, action: 'build' | 'train' | 'attack' | 'defend',
  what: UnitType | BuildingType | null, x: number, y: number): void {
  if (world.tick - mem.lastEvent[mode] < EVENT_THROTTLE_TICKS) return;
  mem.lastEvent[mode] = world.tick;
  world.events.push({ type: 'assist', team, mode, action, what, x, y });
}

function updateKnown(world: World, mem: AssistMem, team: Team): void {
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (!b || b.team === team) continue;
    const c = center(b);
    if (isVisible(world, team, c.x, c.y)) {
      mem.known.set(b.id, { x: c.x, y: c.y });
      if (b.type === 'airfield') mem.airSeen = true;
    }
  }
  for (const id of [...mem.known.keys()]) if (!world.buildings.has(id)) mem.known.delete(id);
  if (!mem.airSeen) {
    for (const u of world.units.values()) {
      if (u.team !== team && UNITS[u.type].domain === 'air' && isFlying(u) && isVisible(world, team, u.x, u.y)) { mem.airSeen = true; break; }
    }
  }
}

/** Direcția (unitară) dinspre bază spre inamic: cea mai apropiată clădire cunoscută, altfel startul unui adversar. */
function enemyDir(world: World, mem: AssistMem, team: Team, from: Vec): Vec {
  let tgt: Vec | null = null;
  let bestD = Infinity;
  for (const pos of mem.known.values()) {
    const d = distCC(from, pos);
    if (d < bestD) { bestD = d; tgt = pos; }
  }
  if (!tgt) {
    for (const p of world.players) {
      if (p.team === team || p.defeated) continue;
      const s = world.map.starts[p.team];
      if (s) { tgt = s; break; }
    }
  }
  if (!tgt) return { x: 0, y: 1 };
  const d = distCC(from, tgt) || 1;
  return { x: (tgt.x - from.x) / d, y: (tgt.y - from.y) / d };
}

/** Ținta unui atac: cea mai apropiată clădire inamică cunoscută, altfel startul adversarului. */
function attackTargetPos(world: World, mem: AssistMem, team: Team, from: Vec): Vec | null {
  let best: Vec | null = null;
  let bestD = Infinity;
  for (const pos of mem.known.values()) {
    const d = distCC(from, pos);
    if (d < bestD) { bestD = d; best = pos; }
  }
  if (best) return best;
  for (const p of world.players) {
    if (p.team === team || p.defeated) continue;
    const s = world.map.starts[p.team];
    if (s) return { x: s.x, y: s.y };
  }
  return null;
}

function queuedCount(q: Player['production']['units'], type: UnitType): number {
  let n = 0;
  for (const s of q) if (s.type === type) n++;
  return n;
}

function aliveCount(world: World, team: Team, type: UnitType): number {
  let n = 0;
  for (const u of world.units.values()) if (u.team === team && u.type === type) n++;
  return n;
}

/** Garda de acasă: primele 2 tancuri și primii 3 infanteriști (după id). */
export function homeGuardIds(world: World, team: Team): Set<EntityId> {
  const guard = new Set<EntityId>();
  let tanks = 0, inf = 0;
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u || u.team !== team) continue;
    if (u.type === 'tank' && tanks < 2) { guard.add(id); tanks++; }
    else if ((u.type === 'soldier' || u.type === 'bazooka') && inf < 3) { guard.add(id); inf++; }
  }
  return guard;
}

// ---------- economie ----------

/** Cel mai apropiat de bază tile cu minereu aflat departe de rafinăriile existente. */
function farOre(world: World, bs: Building[], base: Vec): Vec | null {
  const { w, ore } = world.map;
  const refs = bs.filter((b) => b.type === 'refinery').map(center);
  let best: Vec | null = null;
  let bestD = Infinity;
  for (let i = 0; i < ore.length; i++) {
    if (ore[i] <= 0) continue;
    const x = (i % w) + 0.5, y = ((i / w) | 0) + 0.5;
    const d = distCC(base, { x, y });
    if (d > 24 || d >= bestD) continue;
    let far = true;
    for (const r of refs) if (distCC(r, { x, y }) <= 9) { far = false; break; }
    if (far) { bestD = d; best = { x, y }; }
  }
  return best;
}

function runEconomy(world: World, internal: Internal, p: Player, mem: AssistMem, out: Command[]): void {
  const team = p.team;
  const bs = ownBuildings(world, team);
  const base = baseCenter(bs, world);
  const refs = countType(bs, 'refinery');
  const hasFactory = countType(bs, 'factory') > 0;
  const harvAlive = aliveCount(world, team, 'harvester');
  const harvQueued = queuedCount(p.production.units, 'harvester');

  // 2 recoltoare per rafinărie
  mem.econWant = null;
  if (hasFactory && refs > 0 && harvAlive + harvQueued < 2 * refs) {
    if (p.credits >= UNITS.harvester.cost) {
      out.push({ t: 'train', team, unit: 'harvester', count: 1 });
      emit(world, mem, team, 'economy', 'train', 'harvester', base.x, base.y);
    } else {
      mem.econWant = { type: 'harvester', cost: UNITS.harvester.cost };
    }
  }

  // recoltoare inactive înapoi la treabă (nu atinge ce mută jucătorul)
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u || u.team !== team || u.type !== 'harvester' || u.order.kind !== 'idle') continue;
    if (recentPlayer(internal, id, world.tick)) continue;
    out.push({ t: 'harvest', team, ids: [id], x: u.x, y: u.y });
  }

  // clădire gata -> o plasează singur (doar dacă a pornit-o asistentul)
  const slot = p.production.building;
  if (!slot) mem.startedBuild = false;
  if (slot && slot.ready && mem.startedBuild) {
    placeReady(world, p, mem, bs, base, out, 'economy');
    return;
  }
  if (slot) return;

  // ce urmează în dezvoltarea bazei
  let want: BuildingType | null = null;
  let anchor = base;
  if (refs === 0) want = 'refinery';
  else if (!hasFactory) want = 'factory';
  else if (countType(bs, 'barracks') === 0) want = 'barracks';
  else if (refs < 2) want = 'refinery';
  else if (refs < MAX_REFINERIES && harvAlive >= 2 * refs && farOre(world, bs, base)) want = 'refinery';
  else if (countType(bs, 'airfield') === 0 && p.credits >= BUILDINGS.airfield.cost * 1.5) want = 'airfield';
  if (want === 'refinery') {
    const ore = farOre(world, bs, base);
    if (ore) anchor = ore;
  }
  if (!want) return;
  const def = BUILDINGS[want];
  if (def.requires && countType(bs, def.requires) === 0) return;
  if (p.credits >= def.cost) {
    out.push({ t: 'buildStart', team, building: want });
    mem.startedBuild = true;
    const c = findPlacement(world, team, want, anchor);
    emit(world, mem, team, 'economy', 'build', want, c ? c.tx : base.x, c ? c.ty : base.y);
  } else if (!mem.econWant) {
    mem.econWant = { type: want, cost: def.cost };
  }
}

/** Plasează clădirea gata, cu ancora potrivită tipului. */
function placeReady(world: World, p: Player, mem: AssistMem, bs: Building[], base: Vec, out: Command[], mode: AssistMode): void {
  const slot = p.production.building!;
  const type = slot.type;
  let anchor = base;
  let avoid: Vec[] | undefined;
  if (type === 'refinery') {
    const ore = farOre(world, bs, base);
    if (ore) anchor = ore;
  } else if (type === 'turret' || type === 'rocketTurret') {
    const a = turretAnchor(world, mem, p.team, bs, base, type);
    anchor = a;
    avoid = bs.filter((b) => b.type === 'turret' || b.type === 'rocketTurret').map(center);
  }
  const spot = findPlacement(world, p.team, type, anchor, { avoid });
  if (!spot) return;
  out.push({ t: 'buildPlace', team: p.team, tx: spot.tx, ty: spot.ty });
  emit(world, mem, p.team, mode, 'build', type, spot.tx, spot.ty);
}

// ---------- apărare ----------

function turretAnchor(world: World, mem: AssistMem, team: Team, bs: Building[], base: Vec, type: BuildingType): Vec {
  const dir = enemyDir(world, mem, team, base);
  const refs = bs.filter((b) => b.type === 'refinery');
  const idx = countType(bs, type);
  if (idx % 2 === 1 && refs.length > 0) {
    // turelele impare: lângă o rafinărie, pe partea dinspre inamic
    const r = center(refs[(idx >> 1) % refs.length]);
    return { x: r.x + dir.x * 3, y: r.y + dir.y * 3 };
  }
  const ring = type === 'rocketTurret' ? 3 : 6 + ((idx >> 1) % 2) * 2;
  return { x: base.x + dir.x * ring, y: base.y + dir.y * ring };
}

function runDefense(world: World, internal: Internal, p: Player, mem: AssistMem, out: Command[]): void {
  const team = p.team;
  const bs = ownBuildings(world, team);
  const base = baseCenter(bs, world);
  const dir = enemyDir(world, mem, team, base);
  const home = { x: base.x + dir.x * 5, y: base.y + dir.y * 5 };

  // amenințări: inamici văzuți aproape de orice clădire proprie
  let threat: Vec | null = null;
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u || u.team === team || world.players[u.team].defeated) continue;
    if (!isVisible(world, team, u.x, u.y)) continue;
    for (const b of bs) {
      if (distCC(center(b), { x: u.x, y: u.y }) < DEFEND_RADIUS) { threat = { x: u.x, y: u.y }; break; }
    }
    if (threat) break;
  }

  // clădire gata -> plasare (doar dacă a pornit-o asistentul)
  const slot = p.production.building;
  if (!slot) mem.startedBuild = false;
  if (slot && slot.ready && mem.startedBuild && !p.assist.economy) {
    placeReady(world, p, mem, bs, base, out, 'defense');
  }

  // turele proporționale cu ce deține jucătorul
  let nonTurret = 0;
  for (const b of bs) if (b.type !== 'turret' && b.type !== 'rocketTurret') nonTurret++;
  const gunHave = countType(bs, 'turret');
  const aaHave = countType(bs, 'rocketTurret');
  const gunTarget = Math.min(6, Math.floor(nonTurret / 2));
  let aaTarget = Math.min(3, Math.floor(nonTurret / 4));
  if (mem.airSeen) aaTarget = Math.max(aaTarget, 2);
  const hasFactory = countType(bs, 'factory') > 0;
  const econBusy = p.assist.economy && mem.econWant !== null && threat === null;
  if (!slot && !econBusy) {
    let want: BuildingType | null = null;
    if (mem.airSeen && hasFactory && aaHave < aaTarget) want = 'rocketTurret';
    else if (gunHave < gunTarget) want = 'turret';
    else if (hasFactory && aaHave < aaTarget) want = 'rocketTurret';
    if (want && p.credits >= BUILDINGS[want].cost) {
      out.push({ t: 'buildStart', team, building: want });
      mem.startedBuild = true;
      emit(world, mem, team, 'defense', 'build', want, base.x, base.y);
    }
  }

  // garda de acasă: 2 tancuri + 3 infanteriști
  const reserve = p.assist.economy && mem.econWant ? mem.econWant.cost : 0;
  const guard = homeGuardIds(world, team);
  let gTanks = 0, gInf = 0;
  for (const id of guard) {
    const u = world.units.get(id)!;
    if (u.type === 'tank') gTanks++; else gInf++;
  }
  if (hasFactory && gTanks + queuedCount(p.production.units, 'tank') < 2 && p.credits - reserve >= UNITS.tank.cost) {
    out.push({ t: 'train', team, unit: 'tank', count: 1 });
    emit(world, mem, team, 'defense', 'train', 'tank', base.x, base.y);
  }
  if (countType(bs, 'barracks') > 0) {
    const pend = queuedCount(p.production.infantry, 'soldier') + queuedCount(p.production.infantry, 'bazooka');
    if (gInf + pend < 3 && p.credits - reserve >= UNITS.soldier.cost) {
      out.push({ t: 'train', team, unit: gInf % 2 === 0 ? 'soldier' : 'bazooka', count: 1 });
      emit(world, mem, team, 'defense', 'train', 'soldier', base.x, base.y);
    }
  }

  // garda staționează lângă bază, spre inamic
  const guardIdle: EntityId[] = [];
  for (const id of guard) {
    const u = world.units.get(id)!;
    if (u.order.kind === 'idle' && !recentPlayer(internal, id, world.tick) && !mem.defending.has(id) && distCC(base, { x: u.x, y: u.y }) > 10) guardIdle.push(id);
  }
  if (guardIdle.length && !threat) out.push({ t: 'move', team, ids: guardIdle, x: home.x, y: home.y });

  if (threat) {
    // alarmă: toate unitățile de luptă libere atacă (attack-move) locul amenințării
    const ids: EntityId[] = [];
    for (const id of sortedUnitIds(world)) {
      const u = world.units.get(id);
      if (!u || u.team !== team || !COMBAT.has(u.type) || u.order.kind !== 'idle') continue;
      if (recentPlayer(internal, id, world.tick)) continue;
      if (distCC(base, { x: u.x, y: u.y }) > 35) continue;
      ids.push(id);
      mem.defending.set(id, { hx: home.x, hy: home.y });
    }
    if (ids.length) {
      out.push({ t: 'attackMove', team, ids, x: threat.x, y: threat.y });
      emit(world, mem, team, 'defense', 'defend', null, threat.x, threat.y);
    }
  } else if (mem.defending.size > 0) {
    // pericolul a trecut: cei trimiși la apărare se întorc
    const back: EntityId[] = [];
    for (const [id, h] of [...mem.defending.entries()].sort((a, b) => a[0] - b[0])) {
      const u = world.units.get(id);
      if (!u) { mem.defending.delete(id); continue; }
      if (u.order.kind !== 'idle') continue;
      if (!recentPlayer(internal, id, world.tick) && distCC({ x: h.hx, y: h.hy }, { x: u.x, y: u.y }) > 3) back.push(id);
      mem.defending.delete(id);
    }
    if (back.length) out.push({ t: 'move', team, ids: back, x: home.x, y: home.y });
  }
}

// ---------- atac ----------

function pickTypeByDeficit(world: World, team: Team, q: Player['production']['units'], mix: Array<[UnitType, number]>): UnitType {
  let best = mix[0][0];
  let bestRatio = Infinity;
  for (const [type, weight] of mix) {
    const have = aliveCount(world, team, type) + queuedCount(q, type);
    const ratio = have / weight;
    if (ratio < bestRatio) { bestRatio = ratio; best = type; }
  }
  return best;
}

function runAttack(world: World, internal: Internal, p: Player, mem: AssistMem, out: Command[]): void {
  const team = p.team;
  const bs = ownBuildings(world, team);
  const base = baseCenter(bs, world);
  const reserve = p.assist.economy && mem.econWant ? mem.econWant.cost : 0;
  let budget = p.credits - reserve;

  // cozi ținute pline (plata se face pe rând, deci nu blochează banii dinainte)
  const queues: Array<{ has: boolean; q: Player['production']['units']; mix: Array<[UnitType, number]> }> = [
    { has: countType(bs, 'factory') > 0, q: p.production.units, mix: [['tank', 5], ['rocket', 2]] },
    { has: countType(bs, 'barracks') > 0, q: p.production.infantry, mix: [['soldier', 3], ['bazooka', 2]] },
  ];
  for (const { has, q, mix } of queues) {
    if (!has || q.length >= QUEUE_DEPTH || q.length >= MAX_QUEUE) continue;
    const type = pickTypeByDeficit(world, team, q, mix);
    if (budget < UNITS[type].cost) continue;
    budget -= UNITS[type].cost;
    out.push({ t: 'train', team, unit: type, count: 1 });
    emit(world, mem, team, 'attack', 'train', type, base.x, base.y);
  }
  if (countType(bs, 'airfield') > 0 && p.production.air.length < 1 && budget >= UNITS.bomber.cost + 500) {
    budget -= UNITS.bomber.cost;
    out.push({ t: 'train', team, unit: 'bomber', count: 1 });
    emit(world, mem, team, 'attack', 'train', 'bomber', base.x, base.y);
  }

  // armata: unități de luptă libere, neînrolate în garda de acasă
  const guard = p.assist.defense ? homeGuardIds(world, team) : new Set<EntityId>();
  const gathered: EntityId[] = [];
  const stray: EntityId[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id) as Unit;
    if (u.team !== team || !COMBAT.has(u.type) || u.order.kind !== 'idle') continue;
    if (guard.has(id) || mem.defending.has(id) || recentPlayer(internal, id, world.tick)) continue;
    if (distCC(base, { x: u.x, y: u.y }) <= ARMY_NEAR_BASE) gathered.push(id); else stray.push(id);
  }
  const target = attackTargetPos(world, mem, team, base);
  const threshold = Math.min(ATTACK_CAP, ATTACK_START + ATTACK_GROWTH * mem.waves);
  if (target && gathered.length >= threshold) {
    out.push({ t: 'attackMove', team, ids: gathered.concat(stray), x: target.x, y: target.y });
    mem.waves++;
    mem.attackTarget = target;
    emit(world, mem, team, 'attack', 'attack', null, target.x, target.y);
  } else if (target && mem.waves > 0 && stray.length > 0) {
    // unități rămase inactive departe de bază: li se reface ordinul
    out.push({ t: 'attackMove', team, ids: stray, x: target.x, y: target.y });
    emit(world, mem, team, 'attack', 'attack', null, target.x, target.y);
  }

  // bombardiere: întâi turelele, apoi clădirile de producție, apoi orice
  const ready: EntityId[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id) as Unit;
    if (u.team === team && u.type === 'bomber' && u.order.kind === 'idle' && u.alt === 0 && u.ammo >= 2 && !recentPlayer(internal, id, world.tick)) ready.push(id);
  }
  if (ready.length > 0 && mem.known.size > 0) {
    let best: Vec | null = null;
    let bestScore = Infinity;
    for (const [id, pos] of mem.known) {
      const b = world.buildings.get(id);
      if (!b) continue;
      const prio = b.type === 'turret' || b.type === 'rocketTurret' ? 0
        : b.type === 'factory' || b.type === 'barracks' || b.type === 'airfield' ? 1 : 2;
      const score = prio * 1000 + distCC(base, pos);
      if (score < bestScore) { bestScore = score; best = pos; }
    }
    if (best) {
      out.push({ t: 'bomb', team, ids: ready, x: best.x, y: best.y });
      emit(world, mem, team, 'attack', 'attack', 'bomber', best.x, best.y);
    }
  }
}

// ---------- punct de intrare ----------

/** Comenzile asistentului pentru acest tick (aplicate de step() ca niște comenzi obișnuite). */
export function runAssist(world: World, internal: Internal): Command[] {
  const out: Command[] = [];
  for (const p of world.players) {
    if (p.isAI || p.defeated) continue;
    const a = p.assist;
    if (!a.economy && !a.defense && !a.attack) continue;
    const mem = getAssistMem(internal, p.team);
    const phase = world.tick % 20;
    if (phase === 0 || phase === 7 || phase === 13) updateKnown(world, mem, p.team);
    if (a.economy && phase === 0) runEconomy(world, internal, p, mem, out);
    if (a.defense && phase === 7) runDefense(world, internal, p, mem, out);
    if (a.attack && phase === 13) runAttack(world, internal, p, mem, out);
    if (!a.economy) mem.econWant = null;
  }
  return out;
}
