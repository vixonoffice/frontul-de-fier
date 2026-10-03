// Metadate DOAR pentru afișare în UI (nume, cost, timp aproximativ pentru desenarea progresului).
// Nu sunt regulile reale de joc — acelea trăiesc în simulare (src/data, la integrare).
// Costurile de aici oglindesc reference/prototip-v1.html ca să fie coerente până la integrare.
import type { BuildingType, UnitType } from '../sim/types';

export interface BuildableInfo {
  name: string;
  cost: number;
  time: number; // secunde, doar pentru desenarea barei de progres dacă sim nu a mai raportat alt progres
}

export const BUILDING_INFO: Record<BuildingType, BuildableInfo> = {
  hq: { name: 'Cartier General', cost: 0, time: 0 },
  refinery: { name: 'Rafinărie', cost: 1000, time: 8 },
  factory: { name: 'Fabrică', cost: 1200, time: 10 },
  turret: { name: 'Turelă', cost: 600, time: 6 },
};

export const UNIT_INFO: Record<UnitType, BuildableInfo> = {
  tank: { name: 'Tanc', cost: 600, time: 6 },
  rocket: { name: 'Lansator', cost: 800, time: 8 },
  harvester: { name: 'Recoltor', cost: 900, time: 9 },
};

// Ordinea în care apar cardurile pe fiecare tab.
export const BUILDABLE_BUILDINGS: BuildingType[] = ['factory', 'refinery', 'turret'];
export const BUILDABLE_UNITS: UnitType[] = ['tank', 'rocket', 'harvester'];
