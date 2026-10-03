// Stare internă de simulare care NU face parte din contractul `World` (types.ts e read-only pentru noi).
// Ținută într-un WeakMap cheiat pe obiectul World, ca să nu "poluăm" contractul public.
// Totul de aici e reconstruit determinist din comenzi + world; nu afectează hash()-ul direct,
// dar e produs doar din world.rng / world, deci două World-uri paralele rulate identic rămân identice.
import type { EntityId, Team } from './types';
import type { FlowField } from './path';
import type { WeaponDef } from '../data/units';

export interface HarvestState {
  oreTile: number;              // index în world.map.ore, -1 = niciunul
  refineryId: EntityId | null;
  timer: number;                // secunde rămase până la următorul ciclu (minare/descărcare/așteptare)
}

export interface UnitNav {
  flow: FlowField | null;       // câmp partajat de grup, dacă unitatea se deplasează în grup mare
  repathCooldown: number;       // secunde până la următoarea re-planificare permisă
  engagedTarget: EntityId | null; // țintă angajată automat (idle-hold / attackMove), nu e ordin explicit
  holdOriginX: number;          // poziția din care s-a angajat în luptă idle (pentru leash)
  holdOriginY: number;
}

export interface AIMemory {
  decisionTimer: number;
  waveTimer: number;
  waveNumber: number;
  scoutTimer: number;
  knownEnemyBuildings: Map<EntityId, { x: number; y: number }>;
}

export interface Internal {
  harvest: Map<EntityId, HarvestState>;
  oreReserved: Map<number, number>;
  nav: Map<EntityId, UnitNav>;
  ai: Map<Team, AIMemory>;
  lastUnderAttackTick: Map<Team, number>;
  projectileWeapon: Map<EntityId, WeaponDef>; // arma care a lansat proiectilul (daună/splash reale)
  nextGroupMoveSeq: number;
}

const registry = new WeakMap<object, Internal>();

export function getInternal(world: object): Internal {
  let state = registry.get(world);
  if (!state) {
    state = {
      harvest: new Map(),
      oreReserved: new Map(),
      nav: new Map(),
      ai: new Map(),
      lastUnderAttackTick: new Map(),
      projectileWeapon: new Map(),
      nextGroupMoveSeq: 0,
    };
    registry.set(world, state);
  }
  return state;
}

export function getHarvestState(internal: Internal, id: EntityId): HarvestState {
  let s = internal.harvest.get(id);
  if (!s) { s = { oreTile: -1, refineryId: null, timer: 0 }; internal.harvest.set(id, s); }
  return s;
}

export function getNav(internal: Internal, id: EntityId): UnitNav {
  let n = internal.nav.get(id);
  if (!n) { n = { flow: null, repathCooldown: 0, engagedTarget: null, holdOriginX: 0, holdOriginY: 0 }; internal.nav.set(id, n); }
  return n;
}

export function getAIMemory(internal: Internal, team: Team): AIMemory {
  let m = internal.ai.get(team);
  if (!m) {
    m = { decisionTimer: 0, waveTimer: 0, waveNumber: 0, scoutTimer: 0, knownEnemyBuildings: new Map() };
    internal.ai.set(team, m);
  }
  return m;
}
