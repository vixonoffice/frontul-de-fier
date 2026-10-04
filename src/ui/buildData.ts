// Ajutoare de afișare. Costurile, timpii, numele și descrierile vin DIN src/data (sursa unică);
// aici sunt doar listele de ordine, grupările pe tab-uri și textele de interfață.
import type { BuildingType, ProducerType, UnitType } from '../sim/types';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';

/** Ordinea cardurilor în tab-ul de clădiri. */
export const BUILD_LIST: BuildingType[] = ['refinery', 'factory', 'barracks', 'turret', 'rocketTurret', 'airfield'];

/** Unitățile, grupate după clădirea care le face. */
export const UNIT_GROUPS: Record<ProducerType, UnitType[]> = {
  factory: ['tank', 'rocket', 'harvester'],
  barracks: ['soldier', 'bazooka'],
  airfield: ['bomber'],
};

export const PRODUCERS: ProducerType[] = ['factory', 'barracks', 'airfield'];
/** Numele cozii din Production pentru fiecare clădire producătoare. */
export const QUEUE_KEY = { factory: 'units', barracks: 'infantry', airfield: 'air' } as const;
/** Lungimea maximă a unei cozi (vezi comentariul din Production). */
export const QUEUE_MAX = 5;

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
