// Ceață de război per echipă: 0 nevăzut, 1 văzut cândva, 2 vizibil acum. Recalculată la 4 tick-uri.
import type { World } from './types';

export const FOG_INTERVAL_TICKS = 4;

function markSight(fog: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): void {
  const r2 = r * r;
  const minY = Math.max(0, Math.floor(cy - r));
  const maxY = Math.min(h - 1, Math.ceil(cy + r));
  const minX = Math.max(0, Math.floor(cx - r));
  const maxX = Math.min(w - 1, Math.ceil(cx + r));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) {
        const i = y * w + x;
        fog[i] = 2;
      }
    }
  }
}

export function recomputeFog(world: World): void {
  const { w, h } = world.map;
  for (const player of world.players) {
    const fog = world.fog[player.team];
    // 2 (vizibil acum) devine 1 (văzut cândva); 1 rămâne 1; se re-marchează 2 mai jos
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1;
  }
  const unitIds = [...world.units.keys()].sort((a, b) => a - b);
  for (const id of unitIds) {
    const u = world.units.get(id);
    if (!u) continue;
    const fog = world.fog[u.team];
    markSight(fog, w, h, u.x, u.y, sightOfUnit(u.type));
  }
  const buildingIds = [...world.buildings.keys()].sort((a, b) => a - b);
  for (const id of buildingIds) {
    const b = world.buildings.get(id);
    if (!b) continue;
    const fog = world.fog[b.team];
    markSight(fog, w, h, b.tx + b.w / 2, b.ty + b.h / 2, sightOfBuilding(b.type));
  }
}

// importuri locale leneșe ca să evităm un ciclu de dependențe la nivel de modul
import { UNITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import type { UnitType, BuildingType } from './types';

export function sightOfUnit(t: UnitType): number {
  return UNITS[t].sight;
}
export function sightOfBuilding(t: BuildingType): number {
  return BUILDINGS[t].sight;
}

export function isVisible(world: World, team: number, x: number, y: number): boolean {
  const { w, h } = world.map;
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
  return world.fog[team][ty * w + tx] === 2;
}

export function wasSeen(world: World, team: number, x: number, y: number): boolean {
  const { w, h } = world.map;
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
  return world.fog[team][ty * w + tx] >= 1;
}
