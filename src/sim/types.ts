// CONTRACT între simulare, randare, UI și AI. Îl modifică doar orchestratorul.
// Coordonate: în unități de tile (1 = un tile). x spre est, y spre sud. Unghiuri în radiani, 0 = est.

export const TICK_RATE = 20; // tick-uri pe secundă, fix
export type Team = 0 | 1 | 2 | 3;
export type EntityId = number;

// Etapa 2: infanterie (soldier, bazooka), aviație (bomber), cazarmă, aerodrom, turelă cu rachete (antiaeriană).
// Etapa 3: recoltor înarmat (warHarvester), centrală electrică (power), grade, reparații, strivire.
// Etapa 4 (pasul 1): tanc greu, artilerie, zid, turn Tesla, radar, laborator.
export type UnitType = 'tank' | 'rocket' | 'harvester' | 'soldier' | 'bazooka' | 'bomber' | 'warHarvester' | 'heavyTank' | 'artillery';
export type BuildingType = 'hq' | 'refinery' | 'factory' | 'turret' | 'barracks' | 'airfield' | 'rocketTurret' | 'power' | 'wall' | 'tesla' | 'radar' | 'lab';
/** Clădirea care produce o unitate; fiecare are propria coadă în Production. */
export type ProducerType = 'factory' | 'barracks' | 'airfield';
export type WeaponFx = 'shell' | 'rocket' | 'bullet' | 'bomb' | 'tesla' | 'artillery';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Vec { x: number; y: number }

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attack'; targetId: EntityId }
  | { kind: 'attackMove'; x: number; y: number }
  | { kind: 'bombRun'; x: number; y: number }                 // doar avioane: zboară, lansează bombele pe punct, se întoarce
  | { kind: 'returnToBase' }                                   // doar avioane: întoarcere la aerodrom pentru reîncărcare
  | { kind: 'harvest'; phase: 'seek' | 'toOre' | 'mining' | 'toRefinery' | 'unloading' | 'waiting' };

export interface Unit {
  id: EntityId;
  kind: 'unit';
  type: UnitType;
  team: Team;
  x: number; y: number;          // centru, în tile-uri
  angle: number;                 // orientarea șasiului
  turretAngle: number;           // orientarea turelei / armei
  hp: number; maxHp: number;
  order: Order;
  path: Vec[];                   // waypoint-uri rămase (doar pentru debug/randare)
  carry: number;                 // minereu încărcat (recoltor)
  cooldown: number;              // tick-uri până la următoarea tragere
  lastFireTick: number;          // pentru efectul de flacără la țeavă
  moving: boolean;
  alt: number;                   // înălțime de zbor în tile-uri (0 = la sol); doar avioanele au > 0
  ammo: number;                  // bombe rămase (avion); 0 pentru restul
  role: UnitRole;                // implicit 'attack'; recoltoarele îl ignoră
  kills: number;                 // câte unități/clădiri a distrus
  rank: 0 | 1 | 2;               // grad: 0 recrut, 1 veteran, 2 elită (vezi VETERANCY în data/units.ts)
}

export interface Building {
  id: EntityId;
  kind: 'building';
  type: BuildingType;
  team: Team;
  tx: number; ty: number;        // colțul stânga-sus, în tile-uri
  w: number; h: number;
  hp: number; maxHp: number;
  turretAngle: number;
  cooldown: number;
  lastFireTick: number;
  builtTick: number;
  repairing: boolean;            // se repară acum (costă credite pe măsură ce recuperează viață)
}

export type Entity = Unit | Building;

export interface Projectile {
  id: EntityId;
  kind: WeaponFx;
  team: Team;
  x: number; y: number;
  fromX: number; fromY: number;
  targetId: EntityId;
  tx: number; ty: number;        // ultima poziție cunoscută a țintei
  z?: number;                    // doar bombe: înălțimea curentă de cădere în tile-uri (scade spre 0)
}

export type SimEvent =
  | { type: 'fire'; sourceId: EntityId; x: number; y: number; angle: number; weapon: WeaponFx }
  | { type: 'hit'; x: number; y: number; weapon: WeaponFx }
  | { type: 'destroyed'; id: EntityId; kind: 'unit' | 'building'; team: Team; x: number; y: number; size: number }
  | { type: 'unitReady'; team: Team; id: EntityId; unit: UnitType }
  | { type: 'buildingReady'; team: Team; building: BuildingType }   // gata de plasat
  | { type: 'buildingPlaced'; team: Team; id: EntityId; building: BuildingType }
  | { type: 'underAttack'; team: Team; x: number; y: number }
  | { type: 'unload'; team: Team; x: number; y: number; amount: number }
  | { type: 'waveIncoming'; team: Team; wave: number }
  | { type: 'sold'; team: Team; id: EntityId; building: BuildingType; x: number; y: number; refund: number }
  // ce a decis asistentul, ca UI-ul să poată arăta un jurnal scurt (ex: build + 'refinery', train + 'tank', attack, defend)
  | { type: 'assist'; team: Team; mode: AssistMode; action: 'build' | 'train' | 'attack' | 'defend'; what: UnitType | BuildingType | null; x: number; y: number }
  | { type: 'crushed'; id: EntityId; team: Team; x: number; y: number }                 // infanterist strivit de un vehicul inamic
  | { type: 'promoted'; id: EntityId; team: Team; rank: 1 | 2; x: number; y: number }   // unitate avansată în grad
  | { type: 'lowPower'; team: Team; on: boolean }                                       // a intrat / a ieșit din lipsă de curent
  | { type: 'gameOver'; winner: Team };

// progress 0..1. `paid`: costul a fost deja luat. Unitățile din coadă se plătesc abia când le vine rândul
// (așa poți pune 50 în coadă fără să ai banii pe toate); clădirile se plătesc la start.
export interface ProductionSlot<T> { type: T; progress: number; ready: boolean; paid: boolean }

/** Asistentul jucătorului: trei comutatoare independente. Rulează în sim (determinist), doar pentru jucători umani. */
// 'allIn': la atac pleacă toată armata, inclusiv garda (altfel garda rămâne acasă).
export type AssistMode = 'economy' | 'defense' | 'attack' | 'allIn';
export interface AssistState { economy: boolean; defense: boolean; attack: boolean; allIn: boolean }

/** Rolul unei unități de luptă: 'attack' = forța de atac (pleacă în ofensive), 'guard' = garda bazei
 * (stă lângă bază, merge singură unde e atacată o clădire proprie, apoi se întoarce la post). */
export type UnitRole = 'attack' | 'guard';
export interface Production {
  building: ProductionSlot<BuildingType> | null;
  units: ProductionSlot<UnitType>[];   // coada fabricii (vehicule), maxim MAX_QUEUE
  infantry: ProductionSlot<UnitType>[]; // coada cazărmii
  air: ProductionSlot<UnitType>[];      // coada aerodromului
  rally: Vec | null;
}

export interface Player {
  team: Team;
  credits: number;
  isAI: boolean;
  difficulty: Difficulty;
  assist: AssistState;
  power: { made: number; used: number }; // curent produs / consumat; sub necesar = producție și turele mai lente
  radar?: boolean;               // true cât timp are un radar propriu și nu e în lipsă de curent (UI: minihartă)
  production: Production;
  defeated: boolean;
}

export const TERRAIN_GROUND = 0;
export const TERRAIN_ROCK = 1;
export const TERRAIN_WATER = 2;

export interface MapData {
  w: number; h: number;
  terrain: Uint8Array;           // TERRAIN_* per tile, index = y*w+x
  height: Float32Array;          // relief vizual 0..1 per tile (nu afectează gameplay-ul)
  ore: Uint16Array;              // minereu rămas per tile
  starts: Vec[];                 // poziția de start a fiecărei echipe
}

export interface World {
  tick: number;
  map: MapData;
  units: Map<EntityId, Unit>;
  buildings: Map<EntityId, Building>;
  projectiles: Projectile[];
  players: Player[];             // index = team
  fog: Uint8Array[];             // per echipă: 0 nevăzut, 1 văzut cândva, 2 vizibil acum
  events: SimEvent[];            // evenimentele ultimului tick (golite la începutul fiecărui step)
  winner: Team | null;
  nextId: number;
  rng: number;                   // starea RNG-ului, folosit doar prin sim/rng.ts
  waveTimer: number;             // tick-uri până la următorul val al AI-ului (pentru UI)
}

export type Command =
  | { t: 'move'; team: Team; ids: EntityId[]; x: number; y: number }
  | { t: 'attack'; team: Team; ids: EntityId[]; targetId: EntityId }
  | { t: 'attackMove'; team: Team; ids: EntityId[]; x: number; y: number }
  | { t: 'stop'; team: Team; ids: EntityId[] }
  | { t: 'harvest'; team: Team; ids: EntityId[]; x: number; y: number }   // recoltoarele merg la minereul de lângă (x,y)
  | { t: 'bomb'; team: Team; ids: EntityId[]; x: number; y: number }      // avioanele bombardează punctul (x,y)
  | { t: 'buildStart'; team: Team; building: BuildingType }
  | { t: 'buildPlace'; team: Team; tx: number; ty: number }
  | { t: 'buildCancel'; team: Team }
  | { t: 'train'; team: Team; unit: UnitType; count?: number }           // count: câte să pună în coadă (implicit 1, până la MAX_QUEUE)
  | { t: 'trainCancel'; team: Team; unit: UnitType; all?: boolean }      // all: scoate din coadă toate de acest tip
  | { t: 'assist'; team: Team; mode: AssistMode; on: boolean }           // pornește/oprește un mod al asistentului
  | { t: 'rally'; team: Team; x: number; y: number }
  | { t: 'sell'; team: Team; id: EntityId }
  | { t: 'role'; team: Team; ids: EntityId[]; role: UnitRole }
  | { t: 'repair'; team: Team; id: EntityId; on: boolean };              // pornește/oprește repararea unei clădiri proprii          // mută unitățile în gardă sau în forța de atac                             // vinde o clădire proprie (nu HQ); primești SELL_REFUND din cost

/** Tipul hărții: câmpie deschisă, trecători printre stânci, lacuri, insule legate de poduri de pământ, sau la întâmplare. */
export type MapStyle = 'open' | 'passes' | 'lakes' | 'islands' | 'random';

export interface GameSetup {
  seed: number;
  mapSize: { w: number; h: number };
  mapStyle?: MapStyle;            // implicit 'random'
  // 2-4 jucători, fiecare pentru el. Pozițiile de start se trag la întâmplare din seed (nu mai e mereu același colț).
  players: { team: Team; isAI: boolean; difficulty: Difficulty }[];
}

// API-ul public al simulării (implementat în src/sim/index.ts)
export interface SimAPI {
  createWorld(setup: GameSetup): World;
  step(world: World, commands: Command[]): void;          // avansează exact un tick
  canPlace(world: World, team: Team, type: BuildingType, tx: number, ty: number): boolean;
  hash(world: World): number;                              // pentru verificarea desincronizării în multiplayer
}
