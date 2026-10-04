// Căutare de loc pentru clădiri noi (folosită de asistent și de AI): bază compactă, cu 1 tile liber între clădiri,
// fără să blocheze docurile rafinăriilor sau ieșirile producătorilor, aproape de un punct de ancorare.
import type { BuildingType, Team, Vec, World } from './types';
import { BUILDINGS, MAX_BUILD_DISTANCE } from '../data/buildings';
import { canPlaceBuilding } from './economy';
import { TERRAIN_GROUND } from './types';

const DOCK_TYPES: ReadonlySet<BuildingType> = new Set<BuildingType>(['refinery', 'factory', 'barracks']);

export interface PlaceOpts {
  /** Puncte de evitat (ex. alte turele): candidații apropiați primesc penalizare. */
  avoid?: Vec[];
  /** Distanța maximă (în tile-uri) față de ancoră; implicit nelimitată (limita reală e MAX_BUILD_DISTANCE de o clădire proprie). */
  maxAnchorDist?: number;
}

/** Cel mai bun loc pentru `type`, sau null. Scor = distanța la ancoră (+ penalizări); determinist, fără rng. */
export function findPlacement(
  world: World, team: Team, type: BuildingType, anchor: Vec, opts: PlaceOpts = {},
): { tx: number; ty: number } | null {
  const def = BUILDINGS[type];
  const { w: mw, h: mh, terrain, ore } = world.map;
  const occ = new Uint8Array(mw * mh);      // 1 = clădire
  const reserved = new Uint8Array(mw * mh); // 1 = zonă de dock/ieșire a unei clădiri proprii
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ids = [...world.buildings.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const b = world.buildings.get(id)!;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const X = b.tx + x, Y = b.ty + y;
      if (X >= 0 && Y >= 0 && X < mw && Y < mh) occ[Y * mw + X] = 1;
    }
    if (b.team !== team) continue;
    minX = Math.min(minX, b.tx); minY = Math.min(minY, b.ty);
    maxX = Math.max(maxX, b.tx + b.w); maxY = Math.max(maxY, b.ty + b.h);
    if (DOCK_TYPES.has(b.type)) {
      // două rânduri sub clădire (și câte un tile în lateral) rămân libere pentru recoltoare/unități
      for (let y = b.ty + b.h; y < b.ty + b.h + 2; y++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
        if (x >= 0 && y >= 0 && x < mw && y < mh) reserved[y * mw + x] = 1;
      }
    }
  }
  if (!Number.isFinite(minX)) return null;

  const needsDock = DOCK_TYPES.has(type);
  const cands: Array<{ tx: number; ty: number; score: number }> = [];
  const R = MAX_BUILD_DISTANCE;
  for (let ty = Math.max(1, Math.floor(minY - R)); ty <= Math.min(mh - def.h - 1, Math.ceil(maxY + R)); ty++) {
    for (let tx = Math.max(1, Math.floor(minX - R)); tx <= Math.min(mw - def.w - 1, Math.ceil(maxX + R)); tx++) {
      let ok = true;
      // amprenta + inelul de 1 tile: fără clădiri, fără zone rezervate; fără minereu (în afară de rafinărie, pe inel)
      for (let y = ty - 1; y <= ty + def.h && ok; y++) {
        for (let x = tx - 1; x <= tx + def.w; x++) {
          const i = y * mw + x;
          const inside = x >= tx && x < tx + def.w && y >= ty && y < ty + def.h;
          if (occ[i]) { ok = false; break; }
          if (inside) {
            if (terrain[i] !== TERRAIN_GROUND || reserved[i] || ore[i] > 0) { ok = false; break; }
          } else if (ore[i] > 0 && type !== 'refinery') { ok = false; break; }
        }
      }
      if (!ok) continue;
      if (needsDock) {
        // propriul dock (două rânduri dedesubt) trebuie să fie teren liber
        for (let y = ty + def.h; y < ty + def.h + 2 && ok; y++) for (let x = tx; x < tx + def.w; x++) {
          if (y >= mh || x >= mw || terrain[y * mw + x] !== TERRAIN_GROUND || occ[y * mw + x]) { ok = false; break; }
        }
        if (!ok) continue;
      }
      const cx = tx + def.w / 2, cy = ty + def.h / 2;
      const d = Math.sqrt((cx - anchor.x) ** 2 + (cy - anchor.y) ** 2);
      if (opts.maxAnchorDist !== undefined && d > opts.maxAnchorDist) continue;
      let score = d;
      if (opts.avoid) {
        for (const a of opts.avoid) {
          const da = Math.sqrt((cx - a.x) ** 2 + (cy - a.y) ** 2);
          if (da < 4) score += (4 - da) * 2;
        }
      }
      cands.push({ tx, ty, score });
    }
  }
  cands.sort((a, b) => a.score - b.score || a.ty - b.ty || a.tx - b.tx);
  // verificarea completă (unități, distanța de construcție) doar pentru cei mai buni candidați
  for (let i = 0; i < cands.length && i < 40; i++) {
    if (canPlaceBuilding(world, team, type, cands[i].tx, cands[i].ty)) return { tx: cands[i].tx, ty: cands[i].ty };
  }
  return null;
}
