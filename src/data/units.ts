// Statistici unități. Toate distanțele în tile-uri, timpii în secunde.
// Nu există numere magice de gameplay în afara acestui fișier (vezi docs/PLAN.md regula 4).
import type { UnitType } from '../sim/types';

export type ArmorClass = 'lightVehicle' | 'heavyVehicle' | 'structure';
export type WeaponKind = 'cannon' | 'rocket';

export interface WeaponDef {
  kind: WeaponKind;
  damage: number;
  reload: number;          // secunde între două tiruri
  range: number;            // tile-uri
  projectileSpeed: number;  // tile-uri / secundă
  splash: number;           // rază splash în tile-uri, 0 = fără
  // multiplicator de daună după clasa de armură a țintei
  vs: Record<ArmorClass, number>;
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
}

const CANNON: WeaponDef = {
  kind: 'cannon',
  damage: 30,
  reload: 1.3,
  range: 4.6,
  projectileSpeed: 16,
  splash: 0,
  vs: { lightVehicle: 1.0, heavyVehicle: 1.0, structure: 0.8 },
};

const ROCKET: WeaponDef = {
  kind: 'rocket',
  damage: 52,
  reload: 2.6,
  range: 7.2,
  projectileSpeed: 8,
  splash: 0.7,
  vs: { lightVehicle: 1.1, heavyVehicle: 1.3, structure: 1.4 },
};

export const UNITS: Record<UnitType, UnitDef> = {
  tank: {
    type: 'tank', name: 'Tanc',
    hp: 320, speed: 1.7, turnRate: 5, turretTurnRate: 4,
    sight: 6, radius: 0.375,
    cost: 600, buildTime: 6,
    armor: 'heavyVehicle', weapon: CANNON,
    cargoCap: 0, mineAmount: 0, mineTime: 1, unloadAmount: 0, unloadTime: 1,
  },
  rocket: {
    type: 'rocket', name: 'Lansator',
    hp: 170, speed: 1.3, turnRate: 4.5, turretTurnRate: 3.5,
    sight: 8, radius: 0.34375,
    cost: 800, buildTime: 8,
    armor: 'lightVehicle', weapon: ROCKET,
    cargoCap: 0, mineAmount: 0, mineTime: 1, unloadAmount: 0, unloadTime: 1,
  },
  harvester: {
    type: 'harvester', name: 'Recoltor',
    hp: 700, speed: 1.1, turnRate: 3.5, turretTurnRate: 0,
    sight: 4, radius: 0.4375,
    cost: 900, buildTime: 9,
    armor: 'heavyVehicle', weapon: null,
    cargoCap: 300, mineAmount: 25, mineTime: 0.45, unloadAmount: 50, unloadTime: 0.2,
  },
};

export const STARTING_CREDITS = 3000;
