// Asistentul jucătorului (doar jucători umani): trei moduri independente, economie / apărare / atac.
// Conduce DOAR baza (ce se construiește și ce se produce); nu dă niciodată ordine de mișcare sau atac armatei:
// tactica și atacurile le face jucătorul. Apărarea produce gardieni (rol 'guard'), care acționează singuri (guard.ts).
// Rulează în step(), determinist (fără rng), și acționează EXCLUSIV prin comenzi normale (aceleași costuri și reguli
// ca pentru jucător): nu are bani sau viteză în plus. Fiecare mod decide o dată pe secundă, eșalonat.
import type { AssistMode, Building, BuildingType, Command, Player, Team, Unit, UnitType, Vec, World } from './types';
import { BUILDINGS } from '../data/buildings';
import { MAX_QUEUE, UNITS } from '../data/units';
import type { AssistMem, Internal } from './internal';
import { getAssistMem } from './internal';
import { isVisible } from './fog';
import { center, distCC, sortedBuildingIds, sortedUnitIds } from './entities';
import { findPlacement } from './placement';
import { isFlying } from './air';
import { guardsOf } from './guard';

const EVENT_THROTTLE_TICKS = 20;     // cel mult un eveniment 'assist' pe secundă pe mod
const GUARD_POOL_RADIUS = 25;        // unitățile libere din jurul bazei pot fi promovate gardieni
const TURN_MAX_TICKS = 600;          // un mod care așteaptă prea mult pierde prioritatea la bani
const MAX_REFINERIES = 4;
const QUEUE_DEPTH = 3;               // cozile se țin umplute până la atât (plata se face pe rând)

type Mode3 = 'economy' | 'defense' | 'attack';

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

function emit(world: World, mem: AssistMem, team: Team, mode: AssistMode, action: 'build' | 'train' | 'attack' | 'defend',
  what: UnitType | BuildingType | null, x: number, y: number): void {
  if (mode === 'allIn') return;
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

// ---------- buget: împărțire corectă între modurile active ----------

interface Ctx {
  world: World; internal: Internal; p: Player; mem: AssistMem; mode: Mode3;
  out: Command[]; budget: number; spent: boolean; blocked: boolean;
}

function activeModes(p: Player): Mode3[] {
  const r: Mode3[] = [];
  if (p.assist.economy) r.push('economy');
  if (p.assist.defense) r.push('defense');
  if (p.assist.attack) r.push('attack');
  return r;
}

function makeCtx(world: World, internal: Internal, p: Player, mem: AssistMem, mode: Mode3, out: Command[]): Ctx {
  const act = activeModes(p);
  const holder = act[mem.turn % act.length];
  // singur: toți banii; altfel doar cel cu rândul are toți banii, ceilalți ce rămâne după ce îi rezervă lui
  const budget = act.length <= 1 || mode === holder ? p.credits : p.credits - mem.wantCost[holder];
  mem.wantCost[mode] = 0;
  return { world, internal, p, mem, mode, out, budget, spent: false, blocked: false };
}

/** Încearcă să cheltuiască `cost`; dacă nu ajung banii, modul așteaptă (nu mai cumpără nimic în acest ciclu). */
function buy(ctx: Ctx, cost: number): boolean {
  if (ctx.blocked) return false;
  if (ctx.budget >= cost) { ctx.budget -= cost; ctx.spent = true; return true; }
  ctx.blocked = true;
  if (ctx.mem.wantCost[ctx.mode] === 0) ctx.mem.wantCost[ctx.mode] = cost;
  return false;
}

/** După ciclu: rotește prioritatea dacă modul cu rândul a cumpărat, n-are nimic de cumpărat sau așteaptă prea mult. */
function endCtx(ctx: Ctx): void {
  const act = activeModes(ctx.p);
  if (act.length <= 1) return;
  const holder = act[ctx.mem.turn % act.length];
  if (ctx.mode !== holder) return;
  const waited = ctx.world.tick - ctx.mem.turnSince > TURN_MAX_TICKS;
  if (ctx.spent || ctx.mem.wantCost[ctx.mode] === 0 || waited) {
    ctx.mem.turn = (ctx.mem.turn + 1) % act.length;
    ctx.mem.turnSince = ctx.world.tick;
  }
}

/** Pornește o clădire în slotul de construcție (dacă e liber, are cerințele și sunt bani). */
function startBuilding(ctx: Ctx, bs: Building[], type: BuildingType, base: Vec): boolean {
  const def = BUILDINGS[type];
  if (ctx.p.production.building) return false;
  if (def.requires && countType(bs, def.requires) === 0) return false;
  if (!buy(ctx, def.cost)) return false;
  ctx.out.push({ t: 'buildStart', team: ctx.p.team, building: type });
  ctx.mem.startedBuild = true;
  emit(ctx.world, ctx.mem, ctx.p.team, ctx.mode, 'build', type, base.x, base.y);
  return true;
}

/** Pune în coadă o unitate (plătită pe rând de producție). */
function queueUnit(ctx: Ctx, type: UnitType, base: Vec): boolean {
  if (!buy(ctx, UNITS[type].cost)) return false;
  ctx.out.push({ t: 'train', team: ctx.p.team, unit: type, count: 1 });
  emit(ctx.world, ctx.mem, ctx.p.team, ctx.mode, 'train', type, base.x, base.y);
  return true;
}

// ---------- plasare ----------

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

/** Clădirea gata (pornită de asistent) se plasează singură, cu ancora potrivită tipului. */
function placeIfReady(ctx: Ctx, bs: Building[], base: Vec): void {
  const p = ctx.p;
  const slot = p.production.building;
  if (!slot) { ctx.mem.startedBuild = false; return; }
  if (!slot.ready || !ctx.mem.startedBuild) return;
  const type = slot.type;
  let anchor = base;
  let avoid: Vec[] | undefined;
  if (type === 'refinery') {
    const ore = farOre(ctx.world, bs, base);
    if (ore) anchor = ore;
  } else if (type === 'turret' || type === 'rocketTurret') {
    anchor = turretAnchor(ctx.world, ctx.mem, p.team, bs, base, type);
    avoid = bs.filter((b) => b.type === 'turret' || b.type === 'rocketTurret').map(center);
  }
  const spot = findPlacement(ctx.world, p.team, type, anchor, { avoid });
  if (!spot) return;
  ctx.out.push({ t: 'buildPlace', team: p.team, tx: spot.tx, ty: spot.ty });
  emit(ctx.world, ctx.mem, p.team, ctx.mode, 'build', type, spot.tx, spot.ty);
}

// ---------- economie ----------

function runEconomy(ctx: Ctx): void {
  const { world, p, out } = ctx;
  const team = p.team;
  const bs = ownBuildings(world, team);
  const base = baseCenter(bs, world);
  placeIfReady(ctx, bs, base);
  const refs = countType(bs, 'refinery');
  const hasFactory = countType(bs, 'factory') > 0;
  const harvAlive = aliveCount(world, team, 'harvester');
  const harvQueued = queuedCount(p.production.units, 'harvester');

  // recoltoarele inactive se întorc la minat
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u || u.team !== team || u.type !== 'harvester' || u.order.kind !== 'idle') continue;
    out.push({ t: 'harvest', team, ids: [id], x: u.x, y: u.y });
  }

  // 2 recoltoare per rafinărie
  if (hasFactory && refs > 0 && harvAlive + harvQueued < 2 * refs) queueUnit(ctx, 'harvester', base);

  // ce urmează în dezvoltarea bazei
  let want: BuildingType | null = null;
  if (refs === 0) want = 'refinery';
  else if (!hasFactory) want = 'factory';
  else if (countType(bs, 'barracks') === 0) want = 'barracks';
  else if (refs < 2) want = 'refinery';
  else if (refs < MAX_REFINERIES && harvAlive >= 2 * refs && farOre(world, bs, base)) want = 'refinery';
  else if (countType(bs, 'airfield') === 0 && p.credits >= BUILDINGS.airfield.cost * 1.5) want = 'airfield';
  if (want) startBuilding(ctx, bs, want, base);
}

// ---------- apărare ----------

/** Postul gardianului cu numărul k: împrăștiat pe partea dinspre inamic, o parte lângă rafinării. */
function guardPostFor(world: World, mem: AssistMem, team: Team, bs: Building[], base: Vec, k: number): Vec {
  const dir = enemyDir(world, mem, team, base);
  const refs = bs.filter((b) => b.type === 'refinery');
  const lateral = ((k % 5) - 2) * 2;
  if (k % 3 === 2 && refs.length > 0) {
    const r = center(refs[((k / 3) | 0) % refs.length]);
    return { x: r.x + dir.x * 3 - dir.y * lateral * 0.5, y: r.y + dir.y * 3 + dir.x * lateral * 0.5 };
  }
  const ring = 5 + (k % 2);
  return { x: base.x + dir.x * ring - dir.y * lateral, y: base.y + dir.y * ring + dir.x * lateral };
}

function runDefense(ctx: Ctx): void {
  const { world, p, mem, out } = ctx;
  const team = p.team;
  const bs = ownBuildings(world, team);
  const base = baseCenter(bs, world);
  placeIfReady(ctx, bs, base);

  // turele proporționale cu ce deține jucătorul
  let nonTurret = 0;
  for (const b of bs) if (b.type !== 'turret' && b.type !== 'rocketTurret') nonTurret++;
  const gunHave = countType(bs, 'turret');
  const aaHave = countType(bs, 'rocketTurret');
  const gunTarget = Math.min(6, Math.floor(nonTurret / 2));
  let aaTarget = Math.min(3, Math.floor(nonTurret / 4));
  if (mem.airSeen) aaTarget = Math.max(aaTarget, 2);
  const hasFactory = countType(bs, 'factory') > 0;
  if (!p.production.building) {
    let want: BuildingType | null = null;
    if (mem.airSeen && hasFactory && aaHave < aaTarget) want = 'rocketTurret';
    else if (gunHave < gunTarget) want = 'turret';
    else if (hasFactory && aaHave < aaTarget) want = 'rocketTurret';
    if (want) startBuilding(ctx, bs, want, base);
  }

  // gardieni: 2 tancuri + 3 infanteriști, prin rolul 'guard' (nu schimbă rolurile setate de jucător)
  const guards = guardsOf(world, team);
  let gTanks = 0, gInf = 0;
  for (const id of guards) { if (world.units.get(id)!.type === 'tank') gTanks++; else gInf++; }
  const groups: Array<{ types: UnitType[]; target: number; have: number; queue: Player['production']['units']; ok: boolean; train: UnitType }> = [
    { types: ['tank'], target: 2, have: gTanks, queue: p.production.units, ok: hasFactory, train: 'tank' },
    { types: ['soldier', 'bazooka'], target: 3, have: gInf, queue: p.production.infantry, ok: countType(bs, 'barracks') > 0, train: 'soldier' },
  ];
  let k = guards.length;
  for (const g of groups) {
    let deficit = g.target - g.have;
    if (deficit <= 0) continue;
    // întâi promovează unități libere din jurul bazei
    for (const id of sortedUnitIds(world)) {
      if (deficit <= 0) break;
      const u = world.units.get(id) as Unit;
      if (u.team !== team || !g.types.includes(u.type) || u.role !== 'attack' || u.order.kind !== 'idle') continue;
      if (ctx.internal.playerRole.has(id) || ctx.internal.pendingPost.has(id)) continue;
      if (distCC(base, { x: u.x, y: u.y }) > GUARD_POOL_RADIUS) continue;
      const post = guardPostFor(world, mem, team, bs, base, k++);
      ctx.internal.pendingPost.set(id, post);
      out.push({ t: 'role', team, ids: [id], role: 'guard' });
      emit(world, mem, team, 'defense', 'defend', u.type, post.x, post.y);
      deficit--;
    }
    // apoi produce ce lipsește
    if (deficit > 0 && g.ok) {
      const pending = g.types.reduce((n, t) => n + queuedCount(g.queue, t), 0);
      if (pending < deficit && g.queue.length < QUEUE_DEPTH) queueUnit(ctx, g.train, base);
    }
  }
}

// ---------- atac: doar producție ----------

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

function runAttack(ctx: Ctx): void {
  const { world, p } = ctx;
  const team = p.team;
  const bs = ownBuildings(world, team);
  const base = baseCenter(bs, world);
  placeIfReady(ctx, bs, base);

  // clădirile de atac: fabrică, cazarmă, apoi aerodrom când se permite
  if (countType(bs, 'refinery') > 0 && countType(bs, 'factory') === 0) startBuilding(ctx, bs, 'factory', base);
  else if (countType(bs, 'factory') > 0 && countType(bs, 'barracks') === 0) startBuilding(ctx, bs, 'barracks', base);
  else if (countType(bs, 'factory') > 0 && countType(bs, 'airfield') === 0 && p.credits >= BUILDINGS.airfield.cost * 1.5) startBuilding(ctx, bs, 'airfield', base);

  // cozile ținute pline cu un mix de atac (rol implicit 'attack'; unitățile merg la punctul de adunare)
  const queues: Array<{ has: boolean; q: Player['production']['units']; mix: Array<[UnitType, number]> }> = [
    { has: countType(bs, 'factory') > 0, q: p.production.units, mix: [['tank', 5], ['rocket', 2]] },
    { has: countType(bs, 'barracks') > 0, q: p.production.infantry, mix: [['soldier', 3], ['bazooka', 2]] },
  ];
  for (const { has, q, mix } of queues) {
    if (!has || q.length >= QUEUE_DEPTH || q.length >= MAX_QUEUE) continue;
    queueUnit(ctx, pickTypeByDeficit(world, team, q, mix), base);
  }
  if (countType(bs, 'airfield') > 0 && p.production.air.length < 1) queueUnit(ctx, 'bomber', base);
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
    const mode: Mode3 | null = phase === 0 ? 'economy' : phase === 7 ? 'defense' : phase === 13 ? 'attack' : null;
    if (!mode || !a[mode]) continue;
    const ctx = makeCtx(world, internal, p, mem, mode, out);
    if (mode === 'economy') runEconomy(ctx);
    else if (mode === 'defense') runDefense(ctx);
    else runAttack(ctx);
    endCtx(ctx);
  }
  return out;
}
