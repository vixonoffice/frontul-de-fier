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
  lastRef: number;              // ultima rafinărie folosită (minereul se caută lângă ea)
  slot: number;                 // locul din coada rafinăriei (-1 = niciunul)
  lx: number; ly: number;       // ultima poziție verificată pentru detectarea blocajelor
  stuck: number;                // secunde fără progres
  banRef: number; banT: number; // rafinărie evitată temporar
  badTile: number;              // tile de minereu de evitat după un blocaj
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
  face: number | null;          // direcția în care se întoarce unitatea când se oprește pe slotul din formație
}

export interface AIMemory {
  decisionTimer: number;
  waveTimer: number;
  waveNumber: number;
  scoutTimer: number;
  knownEnemyBuildings: Map<EntityId, { x: number; y: number }>;
  airThreat: boolean;           // a văzut aerodrom sau bombardiere inamice
  bombTimer: number;            // secunde până la următorul raid aerian
  peak: Map<string, number>;    // câte clădiri de fiecare tip a avut cel mult (pentru reconstruire)
  aimTeam: Team | null;         // echipa spre care ar merge următorul val
  flank: { ids: EntityId[]; x: number; y: number } | null; // grupul de flanc și ținta lui finală
  huntTimer: number;
  waveIds: EntityId[];          // unitățile ultimului val
  waveTarget: { x: number; y: number } | null;
  retreat: Set<EntityId>;       // vehicule retrase pentru că erau grav avariate
}

/** Memoria asistentului unui jucător (în afara contractului). Asistentul conduce doar BAZA: construiește și produce. */
export interface AssistMem {
  lastEvent: { economy: number; defense: number; attack: number }; // tick-ul ultimului eveniment 'assist' (throttle)
  wantCost: { economy: number; defense: number; attack: number };   // costul următorului lucru pe care modul îl așteaptă (0 = nimic)
  turnSince: number;
  turn: number;                                                     // rotația între modurile active (cine are prioritate la bani)
  airSeen: boolean;
  econDone: boolean;                                                // primul ciclu de rafinărie + recoltoare s-a încheiat
  harvPrev: number;                                                 // numărul de recoltoare la ultima verificare
  lastHarvLoss: number;                                             // tick-ul ultimei pierderi de recoltor
  rally: { x: number; y: number } | null;                           // punctul de adunare setat de asistent
  startedBuild: boolean;                                            // clădirea din slot a fost pornită de asistent
  known: Map<EntityId, { x: number; y: number }>;                   // clădiri inamice văzute (direcția spre inamic)
}

export interface Internal {
  harvest: Map<EntityId, HarvestState>;
  oreReserved: Map<number, number>;
  nav: Map<EntityId, UnitNav>;
  ai: Map<Team, AIMemory>;
  lastUnderAttackTick: Map<Team, number>;
  projectileSource: Map<EntityId, EntityId>;  // cine a tras proiectilul (credit pentru distrugeri / grade)
  lowPower: Map<Team, boolean>;               // echipa e în lipsă de curent
  projectileWeapon: Map<EntityId, WeaponDef>; // arma care a lansat proiectilul (daună/splash reale)
  bomber: Map<EntityId, BomberState>;
  assist: Map<Team, AssistMem>;
  oreClusters: Array<{ x: number; y: number; tiles: number[] }> | null; // clusterele de minereu (calculate o dată)
  reach: Map<Team, Uint8Array>;               // tile-uri accesibile de la inamici (pentru perimetrul de apărare)
  docks: Map<EntityId, { occupant: EntityId | null; queue: EntityId[] }>; // dock-ul fiecărei rafinării
  guardPost: Map<EntityId, { x: number; y: number }>;   // postul fiecărui gardian
  guardState: Map<EntityId, { x: number; y: number }>;  // gardian care răspunde la o alarmă (locul alarmei)
  lastHit: Map<Team, { x: number; y: number; tick: number }>; // ultima lovitură în clădire/recoltor al echipei
  playerRole: Set<EntityId>;                 // unități al căror rol l-a setat jucătorul (asistentul nu le schimbă)
  pendingPost: Map<EntityId, { x: number; y: number }>; // postul ales de asistent, preluat de comanda 'role' a lui
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
      projectileSource: new Map(),
      lowPower: new Map(),
      bomber: new Map(),
      assist: new Map(),
      docks: new Map(),
      oreClusters: null,
      reach: new Map(),
      guardPost: new Map(),
      guardState: new Map(),
      lastHit: new Map(),
      playerRole: new Set(),
      pendingPost: new Map(),
      lastDamageTick: new Map(),
      nextGroupMoveSeq: 0,
    };
    registry.set(world, state);
  }
  return state;
}

export function getHarvestState(internal: Internal, id: EntityId): HarvestState {
  let s = internal.harvest.get(id);
  if (!s) { s = { oreTile: -1, refineryId: null, timer: 0, idle: 0, lastRef: -1, slot: -1, lx: 0, ly: 0, stuck: 0, banRef: -1, banT: 0, badTile: -1 }; internal.harvest.set(id, s); }
  return s;
}

export function getNav(internal: Internal, id: EntityId): UnitNav {
  let n = internal.nav.get(id);
  if (!n) { n = { flow: null, repathCooldown: 0, engagedTarget: null, holdOriginX: 0, holdOriginY: 0, face: null }; internal.nav.set(id, n); }
  return n;
}

export function getAIMemory(internal: Internal, team: Team): AIMemory {
  let m = internal.ai.get(team);
  if (!m) {
    m = { decisionTimer: 0, waveTimer: 0, waveNumber: 0, scoutTimer: 0, knownEnemyBuildings: new Map(), airThreat: false, bombTimer: 30, peak: new Map(), aimTeam: null, flank: null, huntTimer: 25, waveIds: [], waveTarget: null, retreat: new Set() };
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
      lastEvent: { economy: -1e9, defense: -1e9, attack: -1e9 }, wantCost: { economy: 0, defense: 0, attack: 0 },
      turn: 0, turnSince: 0, airSeen: false, startedBuild: false, econDone: false, harvPrev: 0, lastHarvLoss: 0, rally: null, known: new Map(),
    };
    internal.assist.set(team, m);
  }
  return m;
}
