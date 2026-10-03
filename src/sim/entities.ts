// Mici utilitare comune peste Unit/Building, ca să nu repetăm switch-uri prin tot codul.
import type { Building, Entity, Unit, Vec, World, EntityId } from './types';
import { UNITS, type ArmorClass, type WeaponDef } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { sightOfBuilding, sightOfUnit } from './fog';

export function isUnit(e: Entity): e is Unit {
  return e.kind === 'unit';
}

export function center(e: Entity): Vec {
  if (isUnit(e)) return { x: e.x, y: e.y };
  return { x: e.tx + e.w / 2, y: e.ty + e.h / 2 };
}

export function armorOf(e: Entity): ArmorClass {
  return isUnit(e) ? UNITS[e.type].armor : BUILDINGS[e.type].armor;
}

export function weaponOf(e: Entity): WeaponDef | null {
  return isUnit(e) ? UNITS[e.type].weapon : BUILDINGS[e.type].weapon;
}

export function sightOf(e: Entity): number {
  return isUnit(e) ? sightOfUnit(e.type) : sightOfBuilding(e.type);
}

/** Rază folosită pentru coliziune/distanță "la margine" (pentru clădiri: jumătate din latura mare). */
export function collisionRadius(e: Entity): number {
  if (isUnit(e)) return UNITS[e.type].radius;
  return Math.max(e.w, e.h) / 2 * 0.8;
}

export function findEntity(world: World, id: EntityId): Entity | undefined {
  return world.units.get(id) ?? world.buildings.get(id);
}

/** Distanța centru-centru. */
export function distCC(a: Vec, b: Vec): number {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distanța "la margine": centru-centru minus raza de coliziune a țintei (pentru clădiri mari). */
export function edgeDist(fromPos: Vec, target: Entity): number {
  const c = center(target);
  const d = distCC(fromPos, c);
  return Math.max(0, d - collisionRadius(target));
}

export function sortedUnitIds(world: World): EntityId[] {
  return [...world.units.keys()].sort((a, b) => a - b);
}

export function sortedBuildingIds(world: World): EntityId[] {
  return [...world.buildings.keys()].sort((a, b) => a - b);
}

export function teamHasAliveBuilding(world: World, team: number, type: Building['type']): boolean {
  for (const b of world.buildings.values()) {
    if (b.team === team && b.type === type) return true;
  }
  return false;
}

export function teamBuildingsOfType(world: World, team: number, type: Building['type']): Building[] {
  const out: Building[] = [];
  for (const b of world.buildings.values()) if (b.team === team && b.type === type) out.push(b);
  return out;
}
