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
  idle: number;                 // secunde petrecute inactiv (idle) fără daună; la prag recoltorul reia singur
}

/** Starea de zbor a unui bombardier (în afara contractului). */
export interface BomberState {
  airfieldId: EntityId | null;  // aerodromul „de acasă” (loc de parcare rezervat)
  spot: number;                 // indexul locului de parcare
  parked: boolean;              // la sol, pe aerodrom
  rearm: number;                // secunde până la reîncărcare completă (cât timp e parcat)
  dropTimer: number;            // secunde până la următoarea bombă
  dropping: boolean;            // a început lansarea pe linia de zbor
  runX: number; runY: number;   // punctul vizat al bombardamentului
  loiter: number;               // unghiul de rotire când n-are aerodrom
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
  airThreat: boolean;           // a văzut aerodrom sau bombardiere inamice
  bombTimer: number;            // secunde până la următorul raid aerian
}

/** Memoria asistentului unui jucător (în afara contractului). */
export interface AssistMem {
  known: Map<EntityId, { x: number; y: number }>; // clădiri inamice văzute
  lastEvent: { economy: number; defense: number; attack: number }; // tick-ul ultimului eveniment 'assist' (throttle)
  econWant: { type: string; cost: number } | null; // clădirea pe care economia o așteaptă (rezervă pentru atac)
  waves: number;                                   // câte atacuri a lansat
  attackTarget: { x: number; y: number } | null;
  defending: Map<EntityId, { hx: number; hy: number }>; // unități trimise la apărare, care se întorc apoi
  airSeen: boolean;
  startedBuild: boolean;                           // clădirea din slot a fost pornită de asistent (doar pe aia o plasează singur)
}

export interface Internal {
  harvest: Map<EntityId, HarvestState>;
  oreReserved: Map<number, number>;
  nav: Map<EntityId, UnitNav>;
  ai: Map<Team, AIMemory>;
  lastUnderAttackTick: Map<Team, number>;
  projectileWeapon: Map<EntityId, WeaponDef>; // arma care a lansat proiectilul (daună/splash reale)
  bomber: Map<EntityId, BomberState>;
  assist: Map<Team, AssistMem>;
  lastPlayerCmd: Map<EntityId, number>;       // ultimul tick în care jucătorul a dat o comandă explicită unității
  lastDamageTick: Map<EntityId, number>;      // ultimul tick în care unitatea a primit daună
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
      bomber: new Map(),
      assist: new Map(),
      lastPlayerCmd: new Map(),
      lastDamageTick: new Map(),
      nextGroupMoveSeq: 0,
    };
    registry.set(world, state);
  }
  return state;
}

export function getHarvestState(internal: Internal, id: EntityId): HarvestState {
  let s = internal.harvest.get(id);
  if (!s) { s = { oreTile: -1, refineryId: null, timer: 0, idle: 0 }; internal.harvest.set(id, s); }
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
    m = { decisionTimer: 0, waveTimer: 0, waveNumber: 0, scoutTimer: 0, knownEnemyBuildings: new Map(), airThreat: false, bombTimer: 30 };
    internal.ai.set(team, m);
  }
  return m;
}

export function getBomberState(internal: Internal, id: EntityId): BomberState {
  let s = internal.bomber.get(id);
  if (!s) {
    s = { airfieldId: null, spot: 0, parked: false, rearm: 0, dropTimer: 0, dropping: false, runX: 0, runY: 0, loiter: 0 };
    internal.bomber.set(id, s);
  }
  return s;
}

export function getAssistMem(internal: Internal, team: Team): AssistMem {
  let m = internal.assist.get(team);
  if (!m) {
    m = {
      known: new Map(), lastEvent: { economy: -1e9, defense: -1e9, attack: -1e9 }, econWant: null,
      waves: 0, attackTarget: null, defending: new Map(), airSeen: false, startedBuild: false,
    };
    internal.assist.set(team, m);
  }
  return m;
}
