// Jucătorul calculator: produce Command-uri prin același drum ca jucătorul uman.
// Determinist: orice decizie aleatoare trece prin world.rng (src/sim/rng.ts).
// Folosește aceleași mecanici ca jucătorul: formații, curent, reparații, apărare pe perimetru, bază compactă.
import type { Building, Command, Difficulty, EntityId, Team, Unit, UnitType, Vec, World } from './types';
import { BUILDINGS, MAX_BUILD_DISTANCE } from '../data/buildings';
import { UNITS } from '../data/units';
import { isFlying } from './air';
import { canWeaponTarget } from './combat';
import type { AIMemory, Internal } from './internal';
import { getAIMemory } from './internal';
import { isVisible } from './fog';
import { canPlaceBuilding } from './economy';
import { findPlacement } from './placement';
import { chance, nextFloat, pick } from './rng';
import { center, distCC, sortedBuildingIds, sortedUnitIds, teamBuildingsOfType } from './entities';
import { PI, fcos, fsin } from './fmath';
import { dirToEnemy, expansionOre, ownBuildingsOf, perimeterAnchor } from './baseplan';
import { powerOf, wouldBeLowPower } from './upkeep';

interface AIParams {
  income: number;            // credite / secundă, bonus peste recoltare
  decisionInterval: number;  // secunde
  firstWave: number;         // secunde
  waveInterval: number;      // secunde
  waveBaseSize: number;
  waveGrowth: number;
  turretTarget: number;
  scoutInterval: number;
  defendRadius: number;
  infantryQueue: number;     // câți infanteriști ține în coada cazărmii
  refineries: number;        // câte rafinării vrea (expansiune)
}

const AI_PARAMS: Record<Difficulty, AIParams> = {
  easy: { income: 4, decisionInterval: 3.0, firstWave: 200, waveInterval: 75, waveBaseSize: 2, waveGrowth: 1, turretTarget: 2, scoutInterval: 60, defendRadius: 13, infantryQueue: 1, refineries: 1 },
  normal: { income: 7, decisionInterval: 2.0, firstWave: 110, waveInterval: 55, waveBaseSize: 3, waveGrowth: 1, turretTarget: 4, scoutInterval: 45, defendRadius: 12, infantryQueue: 2, refineries: 2 },
  hard: { income: 36, decisionInterval: 1.2, firstWave: 80, waveInterval: 45, waveBaseSize: 12, waveGrowth: 4, turretTarget: 3, scoutInterval: 30, defendRadius: 11, infantryQueue: 3, refineries: 3 },
};


function ownArmy(world: World, team: Team): Unit[] {
  const out: Unit[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (u && u.team === team && UNITS[u.type].cargoCap === 0 && UNITS[u.type].domain === 'ground') out.push(u);
  }
  return out;
}

function harvesterCount(world: World, team: Team): number {
  let n = 0;
  for (const u of world.units.values()) if (u.team === team && UNITS[u.type].cargoCap > 0) n++;
  return n;
}

function mainBase(world: World, team: Team): Building | null {
  const bs = ownBuildingsOf(world, team);
  return bs.find((b) => b.type === 'hq') ?? bs[0] ?? null;
}

function updateMemory(world: World, internal: Internal, team: Team): void {
  const mem = getAIMemory(internal, team);
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (!b || b.team === team) continue;
    const c = center(b);
    if (isVisible(world, team, c.x, c.y)) mem.knownEnemyBuildings.set(b.id, { x: c.x, y: c.y });
  }
  // amenințare aeriană: aerodrom inamic văzut sau bombardier inamic văzut
  if (!mem.airThreat) {
    for (const id of sortedBuildingIds(world)) {
      const b = world.buildings.get(id);
      if (b && b.team !== team && b.type === 'airfield' && mem.knownEnemyBuildings.has(b.id)) { mem.airThreat = true; break; }
    }
    if (!mem.airThreat) {
      for (const u of world.units.values()) {
        if (u.team !== team && u.type === 'bomber' && isVisible(world, team, u.x, u.y)) { mem.airThreat = true; break; }
      }
    }
  }
  // curăță clădirile demolate din memorie
  for (const id of [...mem.knownEnemyBuildings.keys()]) {
    if (!world.buildings.has(id)) mem.knownEnemyBuildings.delete(id);
  }
}

/** Puterea unei echipe (clădiri + unități): folosită ca să aleagă ținta cea mai slabă în jocul 3-4 jucători. */
function strengthOf(world: World, team: Team): number {
  let n = 0;
  for (const b of world.buildings.values()) if (b.team === team) n += 2;
  for (const u of world.units.values()) if (u.team === team) n += 1;
  return n;
}

/** Echipa-țintă: amestec de proximitate și slăbiciune; poate fi alta la fiecare val. */
function pickTargetTeam(world: World, internal: Internal, team: Team): Team | null {
  const mem = getAIMemory(internal, team);
  const base = mainBase(world, team);
  const from = base ? center(base) : { x: world.map.w / 2, y: world.map.h / 2 };
  let maxS = 1;
  for (const p of world.players) if (p.team !== team && !p.defeated) maxS = Math.max(maxS, strengthOf(world, p.team));
  let best: Team | null = null, bestScore = Infinity;
  for (const p of world.players) {
    if (p.team === team || p.defeated) continue;
    // cea mai apropiată clădire cunoscută a echipei, altfel startul ei
    let d = Infinity;
    for (const [id, pos] of mem.knownEnemyBuildings) {
      const b = world.buildings.get(id);
      if (b && b.team === p.team) d = Math.min(d, distCC(from, pos));
    }
    if (!Number.isFinite(d)) {
      const s = world.map.starts[world.players.findIndex((pp) => pp.team === p.team)];
      d = s ? distCC(from, s) : 1000;
    }
    const score = d * (0.5 + strengthOf(world, p.team) / maxS);
    if (score < bestScore) { bestScore = score; best = p.team; }
  }
  return best;
}

/** Ținta unui atac în echipa aleasă; pe hard: întâi centrale și rafinării, altfel cea mai apropiată clădire. */
function pickAttackTarget(world: World, internal: Internal, team: Team, targetTeam: Team | null, hard: boolean): Vec | null {
  const mem = getAIMemory(internal, team);
  const base = mainBase(world, team);
  const from = base ? center(base) : { x: world.map.w / 2, y: world.map.h / 2 };
  let best: Vec | null = null;
  let bestScore = Infinity;
  for (const [id, pos] of mem.knownEnemyBuildings) {
    const b = world.buildings.get(id);
    if (!b || (targetTeam !== null && b.team !== targetTeam)) continue;
    const prio = hard ? (b.type === 'power' ? 0 : b.type === 'refinery' ? 1 : 2) : 0;
    const score = prio * 1000 + distCC(from, pos);
    if (score < bestScore) { bestScore = score; best = pos; }
  }
  if (best) return best;
  // nimic descoperit încă: ghicește spre startul unui adversar nedefeated
  for (const p of world.players) {
    if (p.team === team || p.defeated || (targetTeam !== null && p.team !== targetTeam)) continue;
    const s = world.map.starts[world.players.findIndex((pp) => pp.team === p.team)];
    if (s) return { x: s.x, y: s.y };
  }
  return null;
}

function tryPlaceNear(world: World, team: Team, type: Building['type'], anchor: { x: number; y: number }): { tx: number; ty: number } | null {
  for (let r = 2; r < MAX_BUILD_DISTANCE; r++) {
    for (let k = 0; k < 24; k++) {
      const ang = nextFloat(world) * PI * 2;
      const tx = Math.round(anchor.x + fcos(ang) * r) - 1;
      const ty = Math.round(anchor.y + fsin(ang) * r) - 1;
      if (canPlaceBuilding(world, team, type, tx, ty)) return { tx, ty };
    }
  }
  return null;
}

/** Rulează AI-ul pentru toți jucătorii isAI și întoarce comenzile lor pentru acest tick. */
export function runAI(world: World, internal: Internal, dt: number): Command[] {
  const out: Command[] = [];
  for (const p of world.players) {
    if (!p.isAI || p.defeated) continue;
    out.push(...runOne(world, internal, p.team, p.difficulty, dt));
  }
  // world.waveTimer (UI) = cel mai apropiat val îndreptat spre un om; dacă nu e niciunul, cel mai apropiat în general
  let soonestHuman = Infinity, soonest = Infinity;
  for (const p of world.players) {
    if (!p.isAI || p.defeated) continue;
    const mem = getAIMemory(internal, p.team);
    if (mem.waveTimer < soonest) soonest = mem.waveTimer;
    const aim = mem.aimTeam !== null ? world.players[mem.aimTeam] : null;
    if (aim && !aim.isAI && mem.waveTimer < soonestHuman) soonestHuman = mem.waveTimer;
  }
  const pick1 = Number.isFinite(soonestHuman) ? soonestHuman : soonest;
  world.waveTimer = Number.isFinite(pick1) ? Math.max(0, Math.round(pick1 * 20)) : world.waveTimer;
  return out;
}

function runOne(world: World, internal: Internal, team: Team, difficulty: Difficulty, dt: number): Command[] {
  const params = AI_PARAMS[difficulty];
  const mem = getAIMemory(internal, team);
  const cmds: Command[] = [];
  const p = world.players[team];

  p.credits += params.income * dt;
  updateMemory(world, internal, team);

  mem.decisionTimer -= dt;
  if (mem.decisionTimer <= 0) {
    mem.decisionTimer = params.decisionInterval;
    mem.aimTeam = pickTargetTeam(world, internal, team);
    decide(world, internal, team, difficulty, params, cmds);
    if (difficulty !== 'easy') maintain(world, internal, team, difficulty, cmds);
  }

  if (difficulty === 'hard') {
    mem.bombTimer -= dt;
    if (mem.bombTimer <= 0) { mem.bombTimer = 12; bombRaid(world, internal, team, cmds); }
    mem.huntTimer -= dt;
    if (mem.huntTimer <= 0) { mem.huntTimer = 25; huntHarvesters(world, internal, team, cmds); }
  }

  mem.scoutTimer -= dt;
  if (mem.scoutTimer <= 0) {
    mem.scoutTimer = params.scoutInterval;
    scout(world, internal, team, cmds);
  }

  if (mem.waveTimer <= 0) mem.waveTimer = params.firstWave;
  mem.waveTimer -= dt;
  if (mem.waveTimer <= 0) {
    // vehiculele grav avariate nu pleacă la atac: rămân la bază
    const army = ownArmy(world, team).filter((u) => !mem.retreat.has(u.id) || u.hp >= u.maxHp * 0.6);
    for (const id of [...mem.retreat]) { const u = world.units.get(id); if (!u || u.hp >= u.maxHp * 0.6) mem.retreat.delete(id); }
    const needed = Math.min(params.waveBaseSize + mem.waveNumber * params.waveGrowth, difficulty === 'hard' ? 40 : 18);
    if (army.length >= needed) {
      const targetTeam = pickTargetTeam(world, internal, team);
      const target = pickAttackTarget(world, internal, team, targetTeam, difficulty === 'hard');
      if (target) {
        const ids = army.map((u) => u.id);
        mem.waveIds = ids;
        mem.waveTarget = target;
        if (difficulty === 'hard' && ids.length >= 12) {
          // atac din două direcții: jumătate direct, jumătate pe un flanc, care apoi se alătură
          const base = mainBase(world, team);
          const from = base ? center(base) : target;
          const d = distCC(from, target) || 1;
          const px = -(target.y - from.y) / d, py = (target.x - from.x) / d;
          const side = chance(world, 0.5) ? 1 : -1;
          const fx = Math.max(3, Math.min(world.map.w - 4, target.x + px * 14 * side - ((target.x - from.x) / d) * 6));
          const fy = Math.max(3, Math.min(world.map.h - 4, target.y + py * 14 * side - ((target.y - from.y) / d) * 6));
          const groupA = ids.filter((_, i) => i % 2 === 0), groupB = ids.filter((_, i) => i % 2 === 1);
          cmds.push({ t: 'attackMove', team, ids: groupA, x: target.x, y: target.y });
          cmds.push({ t: 'attackMove', team, ids: groupB, x: fx, y: fy });
          mem.flank = { ids: groupB, x: target.x, y: target.y };
        } else {
          cmds.push({ t: 'attackMove', team, ids, x: target.x, y: target.y });
        }
        mem.waveNumber++;
        const owner = teamOwning(world, target);
        if (owner !== null) world.events.push({ type: 'waveIncoming', team: owner, wave: mem.waveNumber });
      }
      mem.waveTimer = params.waveInterval;
    } else {
      mem.waveTimer = 5; // reîncearcă în scurt timp, nu pierde ciclul complet
    }
  }

  // grupul de flanc, ajuns la destinație (inactiv), se alătură atacului principal
  if (mem.flank) {
    const idle: EntityId[] = [];
    const alive = mem.flank.ids.filter((id) => world.units.has(id));
    for (const id of alive) if (world.units.get(id)!.order.kind === 'idle') idle.push(id);
    if (alive.length === 0) mem.flank = null;
    else if (idle.length >= Math.ceil(alive.length / 2)) {
      cmds.push({ t: 'attackMove', team, ids: idle, x: mem.flank.x, y: mem.flank.y });
      mem.flank = null;
    }
  }

  defend(world, internal, team, params, cmds);
  return cmds;
}

function teamOwning(world: World, pos: { x: number; y: number }): Team | null {
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (!b) continue;
    const c = center(b);
    if (Math.abs(c.x - pos.x) < 2 && Math.abs(c.y - pos.y) < 2) return b.team;
  }
  return null;
}

/** Locul de așezare: turelele pe perimetru, rafinăriile lângă minereu, restul compact în jurul centrului bazei. */
function placementFor(world: World, internal: Internal, team: Team, type: Building['type'], bs: Building[], base: Vec): { tx: number; ty: number } | null {
  const mem = getAIMemory(internal, team);
  let anchor: Vec = base;
  let avoid: Vec[] | undefined;
  if (type === 'turret') {
    anchor = perimeterAnchor(world, internal, team, bs, base, mem.knownEnemyBuildings.values()) ?? base;
    avoid = bs.filter((b) => b.type === 'turret' || b.type === 'rocketTurret').map(center);
  } else if (type === 'rocketTurret') {
    const vip = bs.filter((b) => b.type === 'factory' || b.type === 'airfield' || b.type === 'refinery');
    anchor = vip.length ? center(vip[bs.filter((b) => b.type === 'rocketTurret').length % vip.length]) : base;
  } else if (type === 'refinery') {
    anchor = expansionOre(world, internal, bs, base) ?? base;
  }
  return findPlacement(world, team, type, anchor, { avoid }) ?? findPlacement(world, team, type, base) ?? tryPlaceNear(world, team, type, base);
}

function decide(world: World, internal: Internal, team: Team, difficulty: Difficulty, params: AIParams, cmds: Command[]): void {
  const p = world.players[team];
  const mem = getAIMemory(internal, team);
  const baseB = mainBase(world, team);
  const base = baseB ? center(baseB) : { x: world.map.w / 2, y: world.map.h / 2 };
  const bs = ownBuildingsOf(world, team);
  let saving = false;

  const count = (t: Building['type']) => teamBuildingsOfType(world, team, t).length;
  // recordul fiecărui tip: normal/hard reconstruiesc ce li s-a distrus
  for (const t of ['refinery', 'factory', 'barracks', 'power', 'turret', 'rocketTurret', 'airfield'] as const) {
    mem.peak.set(t, Math.max(mem.peak.get(t) ?? 0, count(t)));
  }

  // plasează clădirea gata, dacă există una în așteptare
  if (p.production.building && p.production.building.ready) {
    const spot = placementFor(world, internal, team, p.production.building.type, bs, base);
    if (spot) cmds.push({ t: 'buildPlace', team, tx: spot.tx, ty: spot.ty });
  } else if (!p.production.building) {
    const hasFactory = count('factory') > 0;
    const hasRefinery = count('refinery') > 0;
    const hasBarracks = count('barracks') > 0;
    const turretCount = count('turret');
    const body = bs.length - turretCount - count('rocketTurret');
    const turretTarget = params.turretTarget + (difficulty === 'normal' ? Math.floor(body / 4) : 0);
    const aaTarget = difficulty === 'hard' ? 2 : difficulty === 'normal' ? 1 : 0;
    const pw = powerOf(world, team);
    const harvEnough = harvesterCount(world, team) >= 2 * count('refinery');
    const rebuild = (t: Building['type']): boolean => difficulty !== 'easy' && count(t) < (mem.peak.get(t) ?? 0);
    let next: Building['type'] | null = null;
    if (!hasRefinery) next = 'refinery';
    else if (pw.made - pw.used < 8) next = 'power';
    else if (!hasFactory) next = 'factory';
    else if (!hasBarracks) next = 'barracks';
    else if (count('refinery') < params.refineries && harvEnough && expansionOre(world, internal, bs, base)) next = 'refinery';
    else if (turretCount < turretTarget) next = 'turret';
    else if (mem.airThreat && count('rocketTurret') < aaTarget) next = 'rocketTurret';
    else if (difficulty === 'hard' && turretCount >= 2 && count('airfield') === 0) next = 'airfield';
    else if (rebuild('refinery')) next = 'refinery';
    else if (rebuild('factory')) next = 'factory';
    else if (rebuild('power')) next = 'power';
    else if (rebuild('barracks')) next = 'barracks';
    if (next && next !== 'power' && wouldBeLowPower(world, team, next)) next = 'power';
    if (next) {
      const reserve = next === 'turret' ? 300 : next === 'rocketTurret' ? 200 : next === 'airfield' ? 300 : 0;
      if (p.credits >= BUILDINGS[next].cost + reserve) cmds.push({ t: 'buildStart', team, building: next });
      else if (ownArmy(world, team).length >= 4) saving = true; // strânge bani pentru clădire, nu mai cheltui pe unități
    }
  }

  if (difficulty === 'hard' && !saving && ownArmy(world, team).length >= 4 && teamBuildingsOfType(world, team, 'airfield').length > 0
    && p.production.air.length === 0 && p.credits < UNITS.bomber.cost) {
    let bombers = 0;
    for (const u of world.units.values()) if (u.team === team && u.type === 'bomber') bombers++;
    if (bombers < 3) saving = true;
  }

  // aviație (doar hard): până la 3 bombardiere; strânge bani pentru ele
  if (difficulty === 'hard' && teamBuildingsOfType(world, team, 'airfield').length > 0) {
    let bombers = p.production.air.length;
    for (const u of world.units.values()) if (u.team === team && u.type === 'bomber') bombers++;
    if (bombers < 3 && p.production.air.length < 1 && p.credits >= UNITS.bomber.cost) {
      cmds.push({ t: 'train', team, unit: 'bomber' });
    }
  }

  const harv = harvesterCount(world, team);
  const harvQueued = p.production.units.some((u) => u.type === 'harvester');
  const harvWanted = 2 * Math.max(1, count('refinery'));
  if (harv < harvWanted && !harvQueued && p.credits >= UNITS.harvester.cost) {
    cmds.push({ t: 'train', team, unit: 'harvester' });
  } else if (!saving && p.production.units.length < 3 && p.credits >= UNITS.rocket.cost) {
    const type: UnitType = chance(world, 0.62) ? 'tank' : 'rocket';
    if (p.credits >= UNITS[type].cost) cmds.push({ t: 'train', team, unit: type });
  }

  // infanterie din cazarmă, în paralel cu fabrica
  if (!saving && p.production.infantry.length < params.infantryQueue && p.credits >= UNITS.bazooka.cost) {
    const type: UnitType = chance(world, 0.6) ? 'soldier' : 'bazooka';
    cmds.push({ t: 'train', team, unit: type });
  }
}

/** Întreținere (normal/hard): reparații, retragerea vehiculelor avariate spre bază. */
function maintain(world: World, internal: Internal, team: Team, difficulty: Difficulty, cmds: Command[]): void {
  const mem = getAIMemory(internal, team);
  const p = world.players[team];
  const baseB = mainBase(world, team);
  if (!baseB) return;
  const base = center(baseB);
  // reparații: clădirile avariate se repară cât timp sunt bani
  if (p.credits > 400) {
    for (const b of ownBuildingsOf(world, team)) if (!b.repairing && b.hp < b.maxHp * 0.85) cmds.push({ t: 'repair', team, id: b.id, on: true });
  }
  if (difficulty === 'hard') {
    // vehiculele grav avariate se retrag lângă bază (nu mor degeaba) și se alătură următorului val
    const dir = dirToEnemy(world, team, base, mem.knownEnemyBuildings.values());
    const home = { x: base.x + dir.x * 6, y: base.y + dir.y * 6 };
    const back: EntityId[] = [];
    for (const u of ownArmy(world, team)) {
      if ((u.type === 'tank' || u.type === 'rocket') && u.hp < u.maxHp * 0.35 && (u.order.kind === 'attackMove' || u.order.kind === 'attack') && distCC(base, u) > 12) {
        back.push(u.id);
        mem.retreat.add(u.id);
      }
    }
    if (back.length) cmds.push({ t: 'move', team, ids: back, x: home.x, y: home.y });
  }
}

/** Raid aerian (hard), cu escortă: pornesc când armata de la sol e aproape de țintă (sau nu e niciun atac în curs). */
function bombRaid(world: World, internal: Internal, team: Team, cmds: Command[]): void {
  const mem = getAIMemory(internal, team);
  const ready: number[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (u && u.team === team && u.type === 'bomber' && u.order.kind === 'idle' && u.ammo >= 2) ready.push(id);
  }
  if (ready.length === 0) return;
  // escorta: dacă un val e în curs, bombardierele așteaptă ca armata să fie la ~30 de tile-uri de țintă
  if (mem.waveTarget && mem.waveIds.length > 0) {
    const alive = mem.waveIds.map((id) => world.units.get(id)).filter((u): u is Unit => !!u);
    if (alive.length > 0) {
      let cx = 0, cy = 0;
      for (const u of alive) { cx += u.x; cy += u.y; }
      cx /= alive.length; cy /= alive.length;
      if (distCC({ x: cx, y: cy }, mem.waveTarget) > 30 && alive.some((u) => u.order.kind !== 'idle')) return;
    }
  }
  const base = mainBase(world, team);
  const from = base ? center(base) : { x: 0, y: 0 };
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (const [id, pos] of mem.knownEnemyBuildings) {
    const b = world.buildings.get(id);
    if (!b) continue;
    // antiaeriana întâi, apoi centralele, turelele, rafinăriile
    const prio = b.type === 'rocketTurret' ? 0 : b.type === 'power' ? 1 : b.type === 'turret' ? 2 : b.type === 'refinery' ? 3 : b.type === 'factory' ? 4 : 5;
    const score = prio * 1000 + distCC(from, pos);
    if (score < bestScore) { bestScore = score; best = pos; }
  }
  if (best) cmds.push({ t: 'bomb', team, ids: ready, x: best.x, y: best.y });
}

/** Hard: un mic detașament vânează un recoltor inamic văzut. */
function huntHarvesters(world: World, internal: Internal, team: Team, cmds: Command[]): void {
  const mem = getAIMemory(internal, team);
  let prey: Unit | null = null;
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u || u.team === team || UNITS[u.type].cargoCap === 0 || world.players[u.team].defeated) continue;
    if (isVisible(world, team, u.x, u.y)) { prey = u; break; }
  }
  if (!prey) return;
  const pr = prey;
  const squad = ownArmy(world, team)
    .filter((u) => u.order.kind === 'idle' && (u.type === 'tank' || u.type === 'rocket') && !mem.waveIds.includes(u.id))
    .sort((a, b) => distCC(a, pr) - distCC(b, pr) || a.id - b.id)
    .slice(0, 3);
  if (squad.length >= 2) cmds.push({ t: 'attack', team, ids: squad.map((u) => u.id), targetId: pr.id });
}

function scout(world: World, internal: Internal, team: Team, cmds: Command[]): void {
  const army = ownArmy(world, team).filter((u) => u.order.kind === 'idle');
  if (army.length === 0) return;
  const scoutUnit = pick(world, army);
  const target = pickAttackTarget(world, internal, team, getAIMemory(internal, team).aimTeam, false);
  if (!target) return;
  const jitterX = (nextFloat(world) - 0.5) * 6;
  const jitterY = (nextFloat(world) - 0.5) * 6;
  cmds.push({ t: 'attackMove', team, ids: [scoutUnit.id], x: target.x + jitterX, y: target.y + jitterY });
}

function defend(world: World, internal: Internal, team: Team, params: AIParams, cmds: Command[]): void {
  void internal;
  const base = mainBase(world, team);
  if (!base) return;
  const basePos = center(base);
  let intruder: Unit | null = null;
  let airIntruder: Unit | null = null;
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u || u.team === team || world.players[u.team].defeated) continue;
    if (!isVisible(world, team, u.x, u.y)) continue;
    if (distCC(basePos, { x: u.x, y: u.y }) >= params.defendRadius) continue;
    if (isFlying(u)) { if (!airIntruder) airIntruder = u; } else { intruder = u; break; }
  }
  const target = intruder ?? airIntruder;
  if (!target) return;
  const defenders = ownArmy(world, team).filter((u) => {
    if (u.order.kind !== 'idle' && u.order.kind !== 'move') return false;
    const w = UNITS[u.type].weapon;
    return !!w && canWeaponTarget(w, target);
  });
  if (defenders.length === 0) return;
  cmds.push({ t: 'attack', team, ids: defenders.map((u) => u.id), targetId: target.id });
}

export const _test = { AI_PARAMS };
export type { AIMemory };
