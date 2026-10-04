// Statistici clădiri. Vezi src/data/units.ts pentru convenții.
import type { BuildingType } from '../sim/types';
import type { ArmorClass, WeaponDef } from './units';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  w: number; h: number;     // tile-uri
  hp: number;
  sight: number;            // tile-uri
  cost: number;              // 0 = nu se construiește (hq)
  buildTime: number;         // secunde
  armor: ArmorClass;
  weapon: WeaponDef | null;  // doar turret
  buildable: boolean;        // poate fi plasată de jucător/AI
  requires: BuildingType | null; // clădirea pe care trebuie s-o ai deja
  desc: string;              // o propoziție pentru jucător
}

const TURRET_SHELL: WeaponDef = {
  kind: 'cannon',
  damage: 26,
  reload: 1.0,
  range: 6,
  projectileSpeed: 16,
  splash: 0,
  vs: { lightVehicle: 1.0, heavyVehicle: 1.0, structure: 0.8, infantry: 0.6, aircraft: 0 },
  canHitAir: false, canHitGround: true,
};

const TURRET_ROCKET: WeaponDef = {
  kind: 'rocket', damage: 46, reload: 2.2, range: 8, projectileSpeed: 10, splash: 0.5,
  vs: { lightVehicle: 1.1, heavyVehicle: 1.2, structure: 1.0, infantry: 0.4, aircraft: 1.8 },
  canHitAir: true, canHitGround: true,
};

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  hq: {
    type: 'hq', name: 'Cartier general',
    w: 3, h: 3, hp: 1700, sight: 8,
    cost: 0, buildTime: 0,
    armor: 'structure', weapon: null, buildable: false,
    requires: null, desc: 'Inima bazei. Dacă pierzi toate clădirile, ai pierdut.',
  },
  refinery: {
    type: 'refinery', name: 'Rafinărie',
    w: 3, h: 2, hp: 900, sight: 5,
    cost: 1000, buildTime: 4,
    armor: 'structure', weapon: null, buildable: true,
    requires: null, desc: 'Aici descarcă recoltoarele minereul. Vine cu un recoltor gratuit.',
  },
  factory: {
    type: 'factory', name: 'Fabrică',
    w: 3, h: 3, hp: 1100, sight: 5,
    cost: 1200, buildTime: 5,
    armor: 'structure', weapon: null, buildable: true,
    requires: 'refinery', desc: 'Produce tancuri, lansatoare și recoltoare.',
  },
  turret: {
    type: 'turret', name: 'Turelă',
    w: 1, h: 1, hp: 520, sight: 7,
    cost: 600, buildTime: 3,
    armor: 'structure', weapon: TURRET_SHELL, buildable: true,
    requires: null, desc: 'Apără baza de trupe la sol. Nu trage în avioane.',
  },
  barracks: {
    type: 'barracks', name: 'Cazarmă',
    w: 2, h: 2, hp: 700, sight: 5,
    cost: 500, buildTime: 3,
    armor: 'structure', weapon: null, buildable: true,
    requires: null, desc: 'Antrenează soldați și antitanc. Ieftină, bună la început.',
  },
  airfield: {
    type: 'airfield', name: 'Aerodrom',
    w: 4, h: 3, hp: 900, sight: 6,
    cost: 2000, buildTime: 7,
    armor: 'structure', weapon: null, buildable: true,
    requires: 'factory', desc: 'Produce bombardiere (maximum 3 pe aerodrom). Aici se întorc să reîncarce.',
  },
  rocketTurret: {
    type: 'rocketTurret', name: 'Turelă antiaeriană',
    w: 1, h: 1, hp: 450, sight: 9,
    cost: 900, buildTime: 4,
    armor: 'structure', weapon: TURRET_ROCKET, buildable: true,
    requires: 'factory', desc: 'Rachete cu rază mare. Singura apărare fixă care dă jos avioane.',
  },
};

export const SELL_REFUND = 0.5; // fracțiunea din cost primită înapoi la vânzare (proporțional cu viața rămasă)
export const MAX_BUILD_DISTANCE = 8; // tile-uri de la o clădire proprie existentă
export const FREE_HARVESTER_ON_REFINERY = true;
