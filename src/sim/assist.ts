// Asistentul jucătorului (doar jucători umani): trei moduri independente, economie / apărare / atac.
// Conduce DOAR baza (ce se construiește și ce se produce); nu dă niciodată ordine de mișcare sau atac armatei:
// tactica și atacurile le face jucătorul. Apărarea produce gardieni (rol 'guard'), care acționează singuri (guard.ts).
// Rulează în step(), determinist (fără rng), și acționează EXCLUSIV prin comenzi normale (aceleași costuri și reguli
// ca pentru jucător): nu are bani sau viteză în plus. Fiecare mod decide o dată pe secundă, eșalonat.
import type { AssistMode, Building, BuildingType, Command, Player, Team, Unit, UnitType, Vec, World } from './types';
import { TERRAIN_GROUND } from './types';
import { BUILDINGS } from '../data/buildings';
import { MAX_QUEUE, UNITS } from '../data/units';
import type { AssistMem, Internal } from './internal';
import { getAssistMem } from './internal';
import { isVisible } from './fog';
import { center, distCC, sortedUnitIds } from './entities';
import { findPlacement } from './placement';
import { isFlying } from './air';
import { guardsOf } from './guard';
import { dirToEnemy, expansionOre, guardPosts, oreClusters, ownBuildingsOf, perimeterAnchor, refineryCap, wallPlan, wallTileSafe } from './baseplan';
import { canPlaceBuilding } from './economy';
import { powerOf, wouldBeLowPower } from './upkeep';

const EVENT_THROTTLE_TICKS = 20;     // cel mult un eveniment 'assist' pe secundă pe mod
const GUARD_POOL_RADIUS = 25;        // unitățile libere din jurul bazei pot fi promovate gardieni
const TURN_MAX_TICKS = 600;          // un mod care așteaptă prea mult pierde prioritatea la bani
const HARV_PER_REFINERY = 3;         // ciclul: rafinărie, apoi recoltoare până sunt 3 per rafinărie
const QUEUE_DEPTH = 3;               // cozile se țin umplute până la atât (plata se face pe rând)
const POWER_SPARE = 12;              // rezerva de curent sub care se construiește o centrală
const RICH = 4000;                   // peste atât și fără nimic de cumpărat: recoltor blindat
const TICKS_MIN = 20 * 60;

type Mode3 = 'economy' | 'defense' | 'attack';

// ---------- utilitare ----------

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
  for (const b of world.buildings.values()) {
    if (b.team === team) continue;
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

function harvesterCount(world: World, team: Team): number {
  let n = 0;
  for (const u of world.units.values()) if (u.team === team && UNITS[u.type].cargoCap > 0) n++;
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

/** Cine are prioritatea la bani: economia până se încheie primul ciclu de rafinărie, apoi rotația (părți egale). */
function holderOf(p: Player, mem: AssistMem): Mode3 {
  const act = activeModes(p);
  if (!mem.econDone && p.assist.economy) return 'economy';
  return act[mem.turn % act.length];
}

function makeCtx(world: World, internal: Internal, p: Player, mem: AssistMem, mode: Mode3, out: Command[]): Ctx {
  const act = activeModes(p);
  const holder = holderOf(p, mem);
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
  if (act.length <= 1 || !ctx.mem.econDone) return;
  if (ctx.mode !== holderOf(ctx.p, ctx.mem)) return;
  const waited = ctx.world.tick - ctx.mem.turnSince > TURN_MAX_TICKS;
  if (ctx.spent || ctx.mem.wantCost[ctx.mode] === 0 || waited) {
    ctx.mem.turn = (ctx.mem.turn + 1) % act.length;
    ctx.mem.turnSince = ctx.world.tick;
  }
}

/** Dacă clădirea dorită ar duce în lipsă de curent, mai întâi o centrală. */
function withPower(world: World, team: Team, want: BuildingType): BuildingType {
  if (want !== 'power' && wouldBeLowPower(world, team, want)) return 'power';
  return want;
}

/** Pornește o clădire în slotul de construcție (dacă e liber, are cerințele și sunt bani). */
function startBuilding(ctx: Ctx, bs: Building[], type: BuildingType, base: Vec): boolean {
  const t = withPower(ctx.world, ctx.p.team, type);
  const def = BUILDINGS[t];
  if (ctx.p.production.building) return false;
  if (def.requires && countType(bs, def.requires) === 0) return false;
  if (!buy(ctx, def.cost)) return false;
  ctx.out.push({ t: 'buildStart', team: ctx.p.team, building: t });
  ctx.mem.startedBuild = true;
  emit(ctx.world, ctx.mem, ctx.p.team, ctx.mode, 'build', t, base.x, base.y);
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

function knownPositions(mem: AssistMem): Vec[] { return [...mem.known.values()]; }

/** Ancora de plasare: turelele pe perimetru, antiaeriana lângă clădirile de preț, rafinăriile lângă minereu, restul compact în jurul centrului. */
function anchorFor(ctx: Ctx, bs: Building[], type: BuildingType, base: Vec): Vec {
  const { world, internal, mem, p } = ctx;
  if (type === 'turret') return perimeterAnchor(world, internal, p.team, bs, base, knownPositions(mem)) ?? base;
  if (type === 'tesla') {
    // laturile cele mai atacate: loviturile recente în clădiri; altfel direcția inamicului
    const hits = internal.hitLog.get(p.team) ?? [];
    return perimeterAnchor(world, internal, p.team, bs, base, hits.length ? hits : knownPositions(mem)) ?? base;
  }
  if (type === 'rocketTurret') {
    const vip = bs.filter((b) => b.type === 'factory' || b.type === 'airfield' || b.type === 'refinery' || b.type === 'hq');
    const idx = countType(bs, 'rocketTurret');
    return vip.length ? center(vip[idx % vip.length]) : base;
  }
  if (type === 'refinery') return expansionOre(world, internal, bs, base) ?? base;
  return base;
}

/** Clădirea gata (pornită de asistent) se plasează singură. */
function placeIfReady(ctx: Ctx, bs: Building[], base: Vec): void {
  const p = ctx.p;
  const slot = p.production.building;
  if (!slot) { ctx.mem.startedBuild = false; return; }
  if (!slot.ready || !ctx.mem.startedBuild) return;
  const type = slot.type;
  const anchor = anchorFor(ctx, bs, type, base);
  if (type === 'wall') {
    // zidurile se pun doar pe tile-urile planificate la strâmtori, și doar dacă baza rămâne legată pe sol
    const plan = ctx.mem.wallPlan;
    while (plan.length) {
      const t = plan[0];
      if (canPlaceBuilding(ctx.world, p.team, 'wall', t.tx, t.ty) && wallTileSafe(ctx.world, ctx.internal, p.team, bs, base, t.tx, t.ty)) {
        plan.shift();
        ctx.out.push({ t: 'buildPlace', team: p.team, tx: t.tx, ty: t.ty });
        emit(ctx.world, ctx.mem, p.team, ctx.mode, 'build', 'wall', t.tx, t.ty);
        return;
      }
      plan.shift();
    }
    ctx.out.push({ t: 'buildCancel', team: p.team }); // nu mai e niciun loc sigur: rambursare
    return;
  }
  const avoid = bs.filter((b) => b.type === 'turret' || b.type === 'rocketTurret' || b.type === 'tesla').map(center);
  const spot = findPlacement(ctx.world, p.team, type, anchor, { avoid });
  if (!spot) return;
  ctx.out.push({ t: 'buildPlace', team: p.team, tx: spot.tx, ty: spot.ty });
  emit(ctx.world, ctx.mem, p.team, ctx.mode, 'build', type, spot.tx, spot.ty);
}

// ---------- economie ----------

function runEconomy(ctx: Ctx): void {
  const { world, internal, p, mem, out } = ctx;
  const team = p.team;
  const bs = ownBuildingsOf(world, team);
  const base = baseCenter(bs, world);
  placeIfReady(ctx, bs, base);
  const refs = countType(bs, 'refinery');
  const hasFactory = countType(bs, 'factory') > 0;
  const harvAlive = harvesterCount(world, team);
  const harvQueued = queuedCount(p.production.units, 'harvester') + queuedCount(p.production.units, 'warHarvester');
  const cap = refineryCap(world, internal, base);

  // pierderi de recoltoare (pentru recoltorul blindat)
  if (harvAlive < mem.harvPrev) mem.lastHarvLoss = world.tick;
  mem.harvPrev = harvAlive;

  // recoltoarele inactive se întorc la minat
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u || u.team !== team || UNITS[u.type].cargoCap === 0 || u.order.kind !== 'idle') continue;
    out.push({ t: 'harvest', team, ids: [id], x: u.x, y: u.y });
  }

  const pw = powerOf(world, team);
  const needPower = pw.made - pw.used < POWER_SPARE && countType(bs, 'power') < 6;
  const harvTarget = HARV_PER_REFINERY * refs;
  const needHarv = hasFactory && refs > 0 && harvAlive + harvQueued < harvTarget;
  mem.econDone = refs >= Math.min(2, cap) && hasFactory && harvAlive + harvQueued >= Math.min(harvTarget, 2 * refs);

  // ce urmează în dezvoltarea bazei: ciclul rafinărie -> recoltoare -> rafinărie..., cu curent pozitiv
  let want: BuildingType | null = null;
  if (refs === 0) want = 'refinery';
  else if (needPower) want = 'power';
  else if (!hasFactory) want = 'factory';
  else if (!needHarv && refs < cap) want = 'refinery';
  else if (countType(bs, 'barracks') === 0 && refs >= Math.min(2, cap)) want = 'barracks';
  else if (countType(bs, 'radar') === 0 && refs >= 2 && p.credits >= BUILDINGS.radar.cost * 1.3) want = 'radar';
  else if (countType(bs, 'lab') === 0 && countType(bs, 'radar') > 0 && p.credits >= BUILDINGS.lab.cost * 1.3) want = 'lab';
  else if (countType(bs, 'airfield') === 0 && refs >= 2 && p.credits >= BUILDINGS.airfield.cost * 1.5) want = 'airfield';

  if (want) {
    // construcția are prioritate peste recoltoare doar dacă e centrala sau prima rafinărie
    if (!p.production.building && (want !== 'refinery' || !needHarv)) startBuilding(ctx, bs, want, base);
  }
  if (needHarv && !ctx.blocked) {
    const rich = p.credits > RICH && world.tick - mem.lastHarvLoss < 3 * TICKS_MIN && mem.lastHarvLoss > 0;
    queueUnit(ctx, rich ? 'warHarvester' : 'harvester', base);
  }
}

// ---------- apărare ----------

const GUARD_MIX: Array<[UnitType, number]> = [['tank', 2], ['soldier', 2], ['rocket', 1], ['bazooka', 1]];

function runDefense(ctx: Ctx): void {
  const { world, internal, p, mem, out } = ctx;
  const team = p.team;
  const bs = ownBuildingsOf(world, team);
  const base = baseCenter(bs, world);
  placeIfReady(ctx, bs, base);

  // reparații automate pentru clădirile avariate
  for (const b of bs) if (!b.repairing && b.hp < b.maxHp * 0.9) out.push({ t: 'repair', team, id: b.id, on: true });

  // turele proporționale cu mărimea bazei și cu timpul de joc (fără plafon fix mic)
  let body = 0;
  for (const b of bs) if (b.type !== 'turret' && b.type !== 'rocketTurret' && b.type !== 'tesla' && b.type !== 'wall') body++;
  const minutes = world.tick / TICKS_MIN;
  const gunHave = countType(bs, 'turret');
  const aaHave = countType(bs, 'rocketTurret');
  const gunTarget = Math.min(20, Math.max(4, Math.ceil(body / 1.5)) + Math.floor(minutes / 4));
  let aaTarget = Math.min(6, Math.floor(body / 4));
  if (mem.airSeen || minutes >= 5) aaTarget = Math.max(aaTarget, 1);
  const hasFactory = countType(bs, 'factory') > 0;
  const teslaHave = countType(bs, 'tesla');
  const teslaTarget = Math.min(4, Math.floor(gunHave / 2));
  if (!p.production.building) {
    let want: BuildingType | null = null;
    if (mem.airSeen && hasFactory && aaHave < aaTarget) want = 'rocketTurret';
    else if (countType(bs, 'lab') > 0 && gunHave >= 3 && teslaHave < teslaTarget) want = 'tesla'; // centrala se construiește automat dacă lipsește curentul
    else if (gunHave < gunTarget) want = 'turret';
    else if (hasFactory && aaHave < aaTarget) want = 'rocketTurret';
    else if (gunHave >= 4 && minutes >= 2) {
      // ziduri la strâmtorile înguste din jurul bazei (planul se reface rar, doar când e gol)
      if (mem.wallPlan.length === 0 && world.tick - mem.wallPlanTick > 600) {
        mem.wallPlanTick = world.tick;
        mem.wallPlan = wallPlan(world, internal, team, bs, base);
      }
      if (mem.wallPlan.length > 0) want = 'wall';
    }
    if (want) startBuilding(ctx, bs, want, base);
  }

  // gardieni: ~1 la 2 turele + 4, tancuri / lansatoare / infanterie, prin rolul 'guard'
  const guards = guardsOf(world, team);
  const wantGuards = Math.floor((gunHave + aaHave) / 2) + 4;
  if (guards.length < wantGuards) {
    const have = new Map<UnitType, number>();
    for (const id of guards) { const t = world.units.get(id)!.type; have.set(t, (have.get(t) ?? 0) + 1); }
    // tipurile în ordinea deficitului (cel mai gol întâi)
    const order = GUARD_MIX.map(([t, wgt], i) => ({ t, r: (have.get(t) ?? 0) / wgt, i })).sort((a, b) => a.r - b.r || a.i - b.i).map((o) => o.t);
    // întâi promovează o unitate liberă (de cel mai lipsă tip disponibil) din jurul bazei
    let promoted = false;
    for (const type of order) {
      for (const id of sortedUnitIds(world)) {
        const u = world.units.get(id) as Unit;
        if (u.team !== team || u.type !== type || u.role !== 'attack' || u.order.kind !== 'idle') continue;
        if (internal.playerRole.has(id) || internal.pendingPost.has(id)) continue;
        if (distCC(base, { x: u.x, y: u.y }) > GUARD_POOL_RADIUS) continue;
        const posts = guardPosts(world, internal, bs, base);
        const post = posts[guards.length % posts.length];
        internal.pendingPost.set(id, post);
        out.push({ t: 'role', team, ids: [id], role: 'guard' });
        emit(world, mem, team, 'defense', 'defend', u.type, post.x, post.y);
        promoted = true;
        break;
      }
      if (promoted) break;
    }
    if (!promoted) {
      // altfel produce tipul cel mai lipsă pentru care există clădirea producătoare
      for (const type of order) {
        const prod = UNITS[type].producedAt;
        const q = prod === 'factory' ? p.production.units : p.production.infantry;
        if (countType(bs, prod) === 0) continue;
        if (queuedCount(q, type) < 2 && q.length < QUEUE_DEPTH) queueUnit(ctx, type, base);
        break;
      }
    }
  }
}

// ---------- atac: doar producție ----------

/** Compoziția inamicilor vizibili: vehicule / infanterie / aer. */
function enemyMix(world: World, team: Team): { veh: number; inf: number; air: number } {
  const r = { veh: 0, inf: 0, air: 0 };
  for (const u of world.units.values()) {
    if (u.team === team || !isVisible(world, team, u.x, u.y)) continue;
    const def = UNITS[u.type];
    if (def.domain === 'air') r.air++;
    else if (def.armor === 'infantry') r.inf++;
    else r.veh++;
  }
  return r;
}

function pickTypeByWeights(world: World, team: Team, q: Player['production']['units'], mix: Array<[UnitType, number]>): UnitType {
  let best = mix[0][0];
  let bestRatio = Infinity;
  for (const [type, weight] of mix) {
    const have = aliveCount(world, team, type) + queuedCount(q, type);
    const ratio = have / weight;
    if (ratio < bestRatio) { bestRatio = ratio; best = type; }
  }
  return best;
}

/** Punct de adunare în afara bazei, pe partea dinspre inamic, pe teren liber. */
function rallyPoint(world: World, mem: AssistMem, team: Team, bs: Building[], base: Vec): Vec {
  const dir = dirToEnemy(world, team, base, mem.known.values());
  const { w, h, terrain } = world.map;
  for (let d = 14; d >= 7; d--) {
    const x = Math.round(base.x + dir.x * d), y = Math.round(base.y + dir.y * d);
    let ok = x >= 3 && y >= 3 && x < w - 3 && y < h - 3;
    for (let oy = -1; oy <= 1 && ok; oy++) for (let ox = -1; ox <= 1; ox++) if (terrain[(y + oy) * w + x + ox] !== TERRAIN_GROUND) { ok = false; break; }
    if (ok && !bs.some((b) => x >= b.tx - 1 && x <= b.tx + b.w && y >= b.ty - 1 && y <= b.ty + b.h)) return { x, y };
  }
  return { x: base.x, y: base.y + 6 };
}

function runAttack(ctx: Ctx): void {
  const { world, internal, p, mem, out } = ctx;
  const team = p.team;
  const bs = ownBuildingsOf(world, team);
  const base = baseCenter(bs, world);
  placeIfReady(ctx, bs, base);
  const hasFactory = countType(bs, 'factory') > 0;
  const hasBarracks = countType(bs, 'barracks') > 0;

  // clădirile de atac: fabrică, cazarmă, aerodrom când se permite; a doua când se adună bani
  if (!p.production.building) {
    if (countType(bs, 'refinery') > 0 && !hasFactory) startBuilding(ctx, bs, 'factory', base);
    else if (hasFactory && !hasBarracks) startBuilding(ctx, bs, 'barracks', base);
    else if (hasFactory && countType(bs, 'airfield') === 0 && p.credits >= BUILDINGS.airfield.cost * 1.5) startBuilding(ctx, bs, 'airfield', base);
    else if (hasFactory && countType(bs, 'factory') < 2 && p.credits >= 3500) startBuilding(ctx, bs, 'factory', base);
    else if (hasBarracks && countType(bs, 'barracks') < 2 && p.credits >= 3000) startBuilding(ctx, bs, 'barracks', base);
  }

  // punct de adunare în afara bazei, spre inamic (producția îl folosește; nu comandă nicio unitate existentă)
  const rp = rallyPoint(world, mem, team, bs, base);
  if (!p.production.rally || distCC(p.production.rally, rp) > 3) {
    if (!mem.rally || distCC(mem.rally, rp) > 3) { mem.rally = rp; out.push({ t: 'rally', team, x: rp.x, y: rp.y }); }
  }

  // mixul se adaptează la ce are inamicul: bazooka/lansator contra vehiculelor și aerului, soldați/tancuri contra infanteriei
  const em = enemyMix(world, team);
  const total = em.veh + em.inf + em.air;
  let wTank = 5, wRocket = 2, wSoldier = 3, wBazooka = 2;
  if (total >= 3) {
    if (em.veh + em.air > total * 0.55) { wBazooka *= 2; wRocket *= 1.5; wSoldier *= 0.7; }
    if (em.inf > total * 0.45) { wSoldier *= 2; wTank *= 1.3; wBazooka *= 0.6; wRocket *= 0.6; }
    if (em.air > 0) { wBazooka *= 1.5; wRocket *= 1.5; }
  }
  const queues: Array<{ has: boolean; q: Player['production']['units']; mix: Array<[UnitType, number]> }> = [
    { has: hasFactory, q: p.production.units, mix: countType(bs, 'lab') > 0 ? [['tank', wTank], ['rocket', wRocket], ['heavyTank', 3], ['artillery', 1.5]] : [['tank', wTank], ['rocket', wRocket]] },
    { has: hasBarracks, q: p.production.infantry, mix: [['soldier', wSoldier], ['bazooka', wBazooka]] },
  ];
  for (const { has, q, mix } of queues) {
    if (!has || q.length >= QUEUE_DEPTH || q.length >= MAX_QUEUE) continue;
    queueUnit(ctx, pickTypeByWeights(world, team, q, mix), base);
  }
  if (countType(bs, 'airfield') > 0 && p.production.air.length < 1) queueUnit(ctx, 'bomber', base);
  void internal;
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

export const _test = { oreClusters };
