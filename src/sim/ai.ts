// Jucătorul calculator: produce Command-uri prin același drum ca jucătorul uman.
// Determinist: orice decizie aleatoare trece prin world.rng (src/sim/rng.ts).
import type { Building, Command, Difficulty, Team, Unit, UnitType, World } from './types';
import { BUILDINGS, MAX_BUILD_DISTANCE } from '../data/buildings';
import { UNITS } from '../data/units';
import { isFlying } from './air';
import { canWeaponTarget } from './combat';
import type { Internal } from './internal';
import { getAIMemory } from './internal';
import { isVisible } from './fog';
import { canPlaceBuilding } from './economy';
import { chance, nextFloat, pick } from './rng';
import { center, distCC, sortedBuildingIds, sortedUnitIds, teamBuildingsOfType } from './entities';
import { PI, fcos, fsin } from './fmath';

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
}

const AI_PARAMS: Record<Difficulty, AIParams> = {
  easy: { income: 4, decisionInterval: 3.0, firstWave: 260, waveInterval: 100, waveBaseSize: 2, waveGrowth: 1, turretTarget: 2, scoutInterval: 60, defendRadius: 13, infantryQueue: 1 },
  normal: { income: 7, decisionInterval: 2.0, firstWave: 150, waveInterval: 75, waveBaseSize: 3, waveGrowth: 1, turretTarget: 3, scoutInterval: 45, defendRadius: 12, infantryQueue: 2 },
  hard: { income: 11, decisionInterval: 1.2, firstWave: 110, waveInterval: 60, waveBaseSize: 4, waveGrowth: 2, turretTarget: 4, scoutInterval: 30, defendRadius: 11, infantryQueue: 3 },
};

function ownBuildings(world: World, team: Team): Building[] {
  const out: Building[] = [];
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (b && b.team === team) out.push(b);
  }
  return out;
}

function ownArmy(world: World, team: Team): Unit[] {
  const out: Unit[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (u && u.team === team && u.type !== 'harvester' && UNITS[u.type].domain === 'ground') out.push(u);
  }
  return out;
}

function harvesterCount(world: World, team: Team): number {
  let n = 0;
  for (const u of world.units.values()) if (u.team === team && u.type === 'harvester') n++;
  return n;
}

function mainBase(world: World, team: Team): Building | null {
  const bs = ownBuildings(world, team);
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

function pickAttackTarget(world: World, internal: Internal, team: Team): { x: number; y: number } | null {
  const mem = getAIMemory(internal, team);
  const base = mainBase(world, team);
  const from = base ? center(base) : { x: world.map.w / 2, y: world.map.h / 2 };
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const pos of mem.knownEnemyBuildings.values()) {
    const d = distCC(from, pos);
    if (d < bestD) { bestD = d; best = pos; }
  }
  if (best) return best;
  // nimic descoperit încă: ghicește spre colțul de start al unui adversar nedefeated
  for (const p of world.players) {
    if (p.team === team || p.defeated) continue;
    const idx = world.players.findIndex((pp) => pp.team === p.team);
    const s = world.map.starts[idx];
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
  // actualizează world.waveTimer (UI) = cel mai apropiat val, în tick-uri
  let soonest = Infinity;
  for (const p of world.players) {
    if (!p.isAI || p.defeated) continue;
    const mem = getAIMemory(internal, p.team);
    if (mem.waveTimer < soonest) soonest = mem.waveTimer;
  }
  world.waveTimer = Number.isFinite(soonest) ? Math.max(0, Math.round(soonest * 20)) : world.waveTimer;
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
    decide(world, internal, team, difficulty, params, cmds);
  }

  if (difficulty === 'hard') {
    mem.bombTimer -= dt;
    if (mem.bombTimer <= 0) { mem.bombTimer = 15; bombRaid(world, internal, team, cmds); }
  }

  mem.scoutTimer -= dt;
  if (mem.scoutTimer <= 0) {
    mem.scoutTimer = params.scoutInterval;
    scout(world, internal, team, cmds);
  }

  if (mem.waveTimer <= 0) mem.waveTimer = params.firstWave;
  mem.waveTimer -= dt;
  if (mem.waveTimer <= 0) {
    const army = ownArmy(world, team);
    const needed = Math.min(params.waveBaseSize + mem.waveNumber * params.waveGrowth, 18);
    if (army.length >= needed) {
      const target = pickAttackTarget(world, internal, team);
      if (target) {
        const ids = army.map((u) => u.id);
        cmds.push({ t: 'attackMove', team, ids, x: target.x, y: target.y });
        mem.waveNumber++;
        const targetTeam = teamOwning(world, target);
        if (targetTeam !== null) world.events.push({ type: 'waveIncoming', team: targetTeam, wave: mem.waveNumber });
      }
      mem.waveTimer = params.waveInterval;
    } else {
      mem.waveTimer = 5; // reîncearcă în scurt timp, nu pierde ciclul complet
    }
  }

  defend(world, team, params, cmds);
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

function decide(world: World, internal: Internal, team: Team, difficulty: Difficulty, params: AIParams, cmds: Command[]): void {
  const p = world.players[team];
  const mem = getAIMemory(internal, team);
  const base = mainBase(world, team);
  const anchor = base ? center(base) : { x: world.map.w / 2, y: world.map.h / 2 };
  let saving = false;

  // plasează clădirea gata, dacă există una în așteptare
  if (p.production.building && p.production.building.ready) {
    const spot = tryPlaceNear(world, team, p.production.building.type, anchor);
    if (spot) cmds.push({ t: 'buildPlace', team, tx: spot.tx, ty: spot.ty });
  } else if (!p.production.building) {
    const count = (t: Building['type']) => teamBuildingsOfType(world, team, t).length;
    const hasFactory = count('factory') > 0;
    const hasRefinery = count('refinery') > 0;
    const hasBarracks = count('barracks') > 0;
    const turretCount = count('turret');
    const aaTarget = difficulty === 'hard' ? 2 : difficulty === 'normal' ? 1 : 0;
    let next: Building['type'] | null = null;
    if (!hasRefinery) next = 'refinery';
    else if (!hasFactory) next = 'factory';
    else if (!hasBarracks) next = 'barracks';
    else if (turretCount < params.turretTarget) next = 'turret';
    else if (mem.airThreat && count('rocketTurret') < aaTarget) next = 'rocketTurret';
    else if (difficulty === 'hard' && turretCount >= 2 && count('airfield') === 0) next = 'airfield';
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
  if (harv < 2 && !harvQueued && p.credits >= UNITS.harvester.cost) {
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

/** Raid aerian (hard): bombardierele gata de plecare lovesc turelele, apoi rafinăria. */
function bombRaid(world: World, internal: Internal, team: Team, cmds: Command[]): void {
  const mem = getAIMemory(internal, team);
  const ready: number[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (u && u.team === team && u.type === 'bomber' && u.order.kind === 'idle' && u.ammo >= 2) ready.push(id);
  }
  if (ready.length === 0) return;
  const base = mainBase(world, team);
  const from = base ? center(base) : { x: 0, y: 0 };
  let best: { x: number; y: number } | null = null;
  let bestScore = Infinity;
  for (const [id, pos] of mem.knownEnemyBuildings) {
    const b = world.buildings.get(id);
    if (!b) continue;
    const prio = b.type === 'turret' || b.type === 'rocketTurret' ? 0 : b.type === 'refinery' ? 1 : b.type === 'factory' ? 2 : 3;
    const score = prio * 1000 + distCC(from, pos);
    if (score < bestScore) { bestScore = score; best = pos; }
  }
  if (best) cmds.push({ t: 'bomb', team, ids: ready, x: best.x, y: best.y });
}

function scout(world: World, internal: Internal, team: Team, cmds: Command[]): void {
  const army = ownArmy(world, team).filter((u) => u.order.kind === 'idle');
  if (army.length === 0) return;
  const scoutUnit = pick(world, army);
  const target = pickAttackTarget(world, internal, team);
  if (!target) return;
  const jitterX = (nextFloat(world) - 0.5) * 6;
  const jitterY = (nextFloat(world) - 0.5) * 6;
  cmds.push({ t: 'attackMove', team, ids: [scoutUnit.id], x: target.x + jitterX, y: target.y + jitterY });
}

function defend(world: World, team: Team, params: AIParams, cmds: Command[]): void {
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
