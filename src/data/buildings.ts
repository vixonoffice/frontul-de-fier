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
}

const TURRET_SHELL: WeaponDef = {
  kind: 'cannon',
  damage: 26,
  reload: 1.0,
  range: 6,
  projectileSpeed: 16,
  splash: 0,
  vs: { lightVehicle: 1.0, heavyVehicle: 1.0, structure: 0.8 },
};

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  hq: {
    type: 'hq', name: 'Cartier general',
    w: 3, h: 3, hp: 1700, sight: 8,
    cost: 0, buildTime: 0,
    armor: 'structure', weapon: null, buildable: false,
  },
  refinery: {
    type: 'refinery', name: 'Rafinărie',
    w: 3, h: 2, hp: 900, sight: 5,
    cost: 1000, buildTime: 8,
    armor: 'structure', weapon: null, buildable: true,
  },
  factory: {
    type: 'factory', name: 'Fabrică',
    w: 3, h: 3, hp: 1100, sight: 5,
    cost: 1200, buildTime: 10,
    armor: 'structure', weapon: null, buildable: true,
  },
  turret: {
    type: 'turret', name: 'Turelă',
    w: 1, h: 1, hp: 520, sight: 7,
    cost: 600, buildTime: 6,
    armor: 'structure', weapon: TURRET_SHELL, buildable: true,
  },
};

export const MAX_BUILD_DISTANCE = 8; // tile-uri de la o clădire proprie existentă
export const FREE_HARVESTER_ON_REFINERY = true;
