// Ajutoare de afișare. Costurile, timpii, numele și descrierile vin DIN src/data (sursa unică);
// aici sunt doar listele de ordine, grupările pe tab-uri și textele de interfață.
import type { BuildingType, ProducerType, UnitType } from '../sim/types';
import { BUILDINGS } from '../data/buildings';
import { UNITS, MAX_QUEUE } from '../data/units';

/** Ordinea cardurilor în tab-ul de clădiri. */
/** Tava de clădiri e împărțită în două secțiuni, ca să găsești repede un pătrat cu degetul. */
export const BUILD_SECTIONS: { label: string; items: BuildingType[] }[] = [
  { label: 'Bază', items: ['refinery', 'power', 'barracks', 'factory', 'airfield', 'radar', 'lab'] },
  { label: 'Apărare', items: ['turret', 'rocketTurret', 'tesla', 'wall'] },
];
export const BUILD_LIST: BuildingType[] = BUILD_SECTIONS.flatMap((s) => s.items);
/** Clădiri de apărare (pentru textele asistentului). */
export const DEFENSE_BUILDINGS: BuildingType[] = ['turret', 'rocketTurret', 'tesla', 'wall'];

/** Unitățile, grupate după clădirea care le face. */
export const UNIT_GROUPS: Record<ProducerType, UnitType[]> = {
  factory: ['tank', 'rocket', 'heavyTank', 'artillery', 'harvester', 'warHarvester'],
  barracks: ['soldier', 'bazooka'],
  airfield: ['bomber'],
};

export const PRODUCERS: ProducerType[] = ['factory', 'barracks', 'airfield'];
/** Numele cozii din Production pentru fiecare clădire producătoare. */
export const QUEUE_KEY = { factory: 'units', barracks: 'infantry', airfield: 'air' } as const;
/** Lungimea maximă a unei cozi (vezi comentariul din Production). */
export const QUEUE_MAX = MAX_QUEUE;

export function isUnitType(t: string): t is UnitType {
  return t in UNITS;
}
export function nameOf(t: BuildingType | UnitType): string {
  return isUnitType(t) ? UNITS[t].name : BUILDINGS[t].name;
}
export function costOf(t: BuildingType | UnitType): number {
  return isUnitType(t) ? UNITS[t].cost : BUILDINGS[t].cost;
}
export function descOf(t: BuildingType | UnitType): string {
  return isUnitType(t) ? UNITS[t].desc : BUILDINGS[t].desc;
}
export function timeOf(t: BuildingType | UnitType): number {
  return isUnitType(t) ? UNITS[t].buildTime : BUILDINGS[t].buildTime;
}
/** Tipul de unitate poate ataca? (avioanele bombardează, recoltorul nu are armă) */
export function canShoot(t: UnitType): boolean {
  return UNITS[t].weapon !== null && t !== 'bomber';
}

const SHORT: Partial<Record<BuildingType | UnitType, string>> = { rocketTurret: 'Antiaerian', refinery: 'Rafinărie', bomber: 'Bombardier', warHarvester: 'Blindat', heavyTank: 'Tanc greu', artillery: 'Artilerie', tesla: 'Tesla', lab: 'Laborator' };
/** Nume scurt, ca să încapă pe un pătrat de tavă. */
export function shortName(t: BuildingType | UnitType): string {
  return SHORT[t] ?? nameOf(t);
}

/** Unități care pot aduna minereu (recoltorul și cel blindat). */
export function canHarvest(t: UnitType): boolean {
  return t === 'harvester' || t === 'warHarvester';
}
