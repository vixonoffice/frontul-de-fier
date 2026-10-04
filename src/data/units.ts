// Statistici unități. Toate distanțele în tile-uri, timpii în secunde.
// Nu există numere magice de gameplay în afara acestui fișier (vezi docs/PLAN.md regula 4).
import type { UnitType } from '../sim/types';

export type ArmorClass = 'lightVehicle' | 'heavyVehicle' | 'structure' | 'infantry' | 'aircraft';
export type WeaponKind = 'cannon' | 'rocket' | 'rifle' | 'bomb';

export interface WeaponDef {
  kind: WeaponKind;
  damage: number;
  reload: number;          // secunde între două tiruri
  range: number;            // tile-uri
  projectileSpeed: number;  // tile-uri / secundă
  splash: number;           // rază splash în tile-uri, 0 = fără
  // multiplicator de daună după clasa de armură a țintei
  vs: Record<ArmorClass, number>;
  canHitAir: boolean;       // poate ținti avioane în zbor
  canHitGround: boolean;
}

export interface UnitDef {
  type: UnitType;
  name: string;
  hp: number;
  speed: number;            // tile-uri / secundă
  turnRate: number;         // radiani / secundă (șasiu)
  turretTurnRate: number;   // radiani / secundă (turelă), 0 = fără turelă separată
  sight: number;            // tile-uri
  radius: number;           // tile-uri, pentru coliziune/separare
  cost: number;
  buildTime: number;        // secunde
  armor: ArmorClass;
  weapon: WeaponDef | null;
  cargoCap: number;         // doar recoltor
  mineAmount: number;       // minereu extras per tick de minare
  mineTime: number;         // secunde per ciclu de minare
  unloadAmount: number;     // credite per ciclu de descărcare
  unloadTime: number;       // secunde per ciclu de descărcare
  producedAt: 'factory' | 'barracks' | 'airfield';
  domain: 'ground' | 'air';
  desc: string;             // o propoziție pentru jucător: la ce e bună unitatea
}

// --- avioane ---
export const AIR_ALTITUDE = 3.2;        // tile-uri deasupra solului, în zbor
export const BOMBER_PAYLOAD = 4;        // bombe per ieșire
export const BOMBER_RELOAD_TIME = 8;   // secunde la sol, pe aerodrom, până e gata din nou
export const BOMBERS_PER_AIRFIELD = 3;

const CANNON: WeaponDef = {
  kind: 'cannon',
  damage: 30,
  reload: 1.3,
  range: 4.6,
  projectileSpeed: 16,
  splash: 0,
  vs: { lightVehicle: 1.0, heavyVehicle: 1.0, structure: 0.8, infantry: 0.35, aircraft: 0 },
  canHitAir: false, canHitGround: true,
};

const ROCKET: WeaponDef = {
  kind: 'rocket',
  damage: 52,
  reload: 2.6,
  range: 7.2,
  projectileSpeed: 8,
  splash: 0.7,
  vs: { lightVehicle: 1.1, heavyVehicle: 1.3, structure: 1.4, infantry: 0.5, aircraft: 1.6 },
  canHitAir: true, canHitGround: true,
};

const RIFLE: WeaponDef = {
  kind: 'rifle', damage: 9, reload: 0.5, range: 3.6, projectileSpeed: 30, splash: 0,
  vs: { lightVehicle: 0.5, heavyVehicle: 0.2, structure: 0.25, infantry: 1.0, aircraft: 0.4 },
  canHitAir: true, canHitGround: true,
};

const BAZOOKA: WeaponDef = {
  kind: 'rocket', damage: 38, reload: 2.4, range: 5, projectileSpeed: 9, splash: 0.3,
  vs: { lightVehicle: 1.2, heavyVehicle: 1.3, structure: 1.1, infantry: 0.3, aircraft: 1.5 },
  canHitAir: true, canHitGround: true,
};

const BOMB: WeaponDef = {
  kind: 'bomb', damage: 120, reload: 0.25, range: 0.8, projectileSpeed: 6, splash: 1.3,
  vs: { lightVehicle: 1.2, heavyVehicle: 1.0, structure: 1.5, infantry: 1.5, aircraft: 0 },
  canHitAir: false, canHitGround: true,
};

export const UNITS: Record<UnitType, UnitDef> = {
  tank: {
    type: 'tank', name: 'Tanc',
    hp: 320, speed: 2.2, turnRate: 5, turretTurnRate: 4,
    sight: 6, radius: 0.375,
    cost: 600, buildTime: 3,
    armor: 'heavyVehicle', weapon: CANNON,
    cargoCap: 0, mineAmount: 0, mineTime: 1, unloadAmount: 0, unloadTime: 1,
    producedAt: 'factory', domain: 'ground', desc: 'Blindat, bun la toate. Nu poate trage în avioane.',
  },
  rocket: {
    type: 'rocket', name: 'Lansator',
    hp: 170, speed: 1.8, turnRate: 4.5, turretTurnRate: 3.5,
    sight: 8, radius: 0.34375,
    cost: 800, buildTime: 4,
    armor: 'lightVehicle', weapon: ROCKET,
    cargoCap: 0, mineAmount: 0, mineTime: 1, unloadAmount: 0, unloadTime: 1,
    producedAt: 'factory', domain: 'ground', desc: 'Trage de departe, bun contra clădirilor și avioanelor. Fragil.',
  },
  harvester: {
    type: 'harvester', name: 'Recoltor',
    hp: 700, speed: 1.7, turnRate: 3.5, turretTurnRate: 0,
    sight: 4, radius: 0.4375,
    cost: 900, buildTime: 4,
    armor: 'heavyVehicle', weapon: null,
    cargoCap: 500, mineAmount: 50, mineTime: 0.3, unloadAmount: 125, unloadTime: 0.1,
    producedAt: 'factory', domain: 'ground', desc: 'Adună minereu și îl duce la rafinărie. Așa faci bani.',
  },
  soldier: {
    type: 'soldier', name: 'Soldat',
    hp: 60, speed: 1.6, turnRate: 9, turretTurnRate: 0,
    sight: 5, radius: 0.2,
    cost: 150, buildTime: 1.5,
    armor: 'infantry', weapon: RIFLE,
    cargoCap: 0, mineAmount: 0, mineTime: 1, unloadAmount: 0, unloadTime: 1,
    producedAt: 'barracks', domain: 'ground', desc: 'Ieftin și rapid de făcut. Bun contra altor soldați, slab contra tancurilor.',
  },
  bazooka: {
    type: 'bazooka', name: 'Antitanc',
    hp: 75, speed: 1.5, turnRate: 9, turretTurnRate: 0,
    sight: 6, radius: 0.2,
    cost: 300, buildTime: 2.5,
    armor: 'infantry', weapon: BAZOOKA,
    cargoCap: 0, mineAmount: 0, mineTime: 1, unloadAmount: 0, unloadTime: 1,
    producedAt: 'barracks', domain: 'ground', desc: 'Soldat cu lansator. Distruge tancuri și dă jos avioane.',
  },
  bomber: {
    type: 'bomber', name: 'Bombardier',
    hp: 260, speed: 5.5, turnRate: 2.4, turretTurnRate: 0,
    sight: 7, radius: 0.5,
    cost: 1400, buildTime: 7,
    armor: 'aircraft', weapon: BOMB,
    cargoCap: 0, mineAmount: 0, mineTime: 1, unloadAmount: 0, unloadTime: 1,
    producedAt: 'airfield', domain: 'air', desc: 'Zboară peste orice, lasă 4 bombe pe țintă și se întoarce la aerodrom să reîncarce.',
  },
};

export const MAX_QUEUE = 99;            // câte unități încap într-o coadă de producție
export const STARTING_CREDITS = 5000;
