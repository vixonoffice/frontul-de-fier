// CONTRACT între simulare, randare, UI și AI. Îl modifică doar orchestratorul.
// Coordonate: în unități de tile (1 = un tile). x spre est, y spre sud. Unghiuri în radiani, 0 = est.

export const TICK_RATE = 20; // tick-uri pe secundă, fix
export type Team = 0 | 1 | 2 | 3;
export type EntityId = number;

// Etapa 2: infanterie (soldier, bazooka), aviație (bomber), cazarmă, aerodrom, turelă cu rachete (antiaeriană).
export type UnitType = 'tank' | 'rocket' | 'harvester' | 'soldier' | 'bazooka' | 'bomber';
export type BuildingType = 'hq' | 'refinery' | 'factory' | 'turret' | 'barracks' | 'airfield' | 'rocketTurret';
/** Clădirea care produce o unitate; fiecare are propria coadă în Production. */
export type ProducerType = 'factory' | 'barracks' | 'airfield';
export type WeaponFx = 'shell' | 'rocket' | 'bullet' | 'bomb';
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
  | { type: 'gameOver'; winner: Team };

export interface ProductionSlot<T> { type: T; progress: number; ready: boolean } // progress 0..1
export interface Production {
  building: ProductionSlot<BuildingType> | null;
  units: ProductionSlot<UnitType>[];   // coada fabricii (vehicule), maxim 5
  infantry: ProductionSlot<UnitType>[]; // coada cazărmii, maxim 5
  air: ProductionSlot<UnitType>[];      // coada aerodromului, maxim 5
  rally: Vec | null;
}

export interface Player {
  team: Team;
  credits: number;
  isAI: boolean;
  difficulty: Difficulty;
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
  | { t: 'train'; team: Team; unit: UnitType }
  | { t: 'trainCancel'; team: Team; unit: UnitType }
  | { t: 'rally'; team: Team; x: number; y: number };

export interface GameSetup {
  seed: number;
  mapSize: { w: number; h: number };
  players: { team: Team; isAI: boolean; difficulty: Difficulty }[];
}

// API-ul public al simulării (implementat în src/sim/index.ts)
export interface SimAPI {
  createWorld(setup: GameSetup): World;
  step(world: World, commands: Command[]): void;          // avansează exact un tick
  canPlace(world: World, team: Team, type: BuildingType, tx: number, ty: number): boolean;
  hash(world: World): number;                              // pentru verificarea desincronizării în multiplayer
}
