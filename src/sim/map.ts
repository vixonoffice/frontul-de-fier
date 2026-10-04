// Generare hartă deterministă din seed: relief, stânci (ascunzători/strâmtori), bălți, minereu.
// Garantează conectivitate între toate pozițiile de start (BFS + "săpare" de culoar dacă e nevoie).
import type { GameSetup, MapData, Vec } from './types';
import { TERRAIN_GROUND, TERRAIN_ROCK, TERRAIN_WATER } from './types';
import type { RngHolder } from './rng';
import { nextFloat, nextInt, nextRange } from './rng';
import { PI, fcos, fsin } from './fmath';

const START_MARGIN = 9;
const CLEAR_RADIUS = 7;
const ORE_MIN = 700;
const ORE_MAX = 1100;

interface Corner { x: number; y: number }

function cornerFor(team: number, w: number, h: number): Corner {
  switch (team) {
    case 0: return { x: START_MARGIN, y: h - START_MARGIN - 1 };       // echipa 0: colț stânga-jos
    case 1: return { x: w - START_MARGIN - 1, y: START_MARGIN };       // echipa 1: colț dreapta-sus
    case 2: return { x: START_MARGIN, y: START_MARGIN };               // echipa 2: colț stânga-sus
    default: return { x: w - START_MARGIN - 1, y: h - START_MARGIN - 1 }; // echipa 3: colț dreapta-jos
  }
}

function idx(w: number, x: number, y: number): number {
  return y * w + x;
}

function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

function passableTerrain(terrain: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  if (!inBounds(w, h, x, y)) return false;
  return terrain[idx(w, x, y)] === TERRAIN_GROUND;
}

function clearArea(terrain: Uint8Array, w: number, h: number, cx: number, cy: number, r: number): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const tx = cx + x, ty = cy + y;
      if (!inBounds(w, h, tx, ty)) continue;
      if (x * x + y * y <= r * r + 1) terrain[idx(w, tx, ty)] = TERRAIN_GROUND;
    }
  }
}

function minDistToList(x: number, y: number, pts: Corner[]): number {
  let best = Infinity;
  for (const p of pts) {
    const dx = x - p.x, dy = y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return best;
}

// --- relief vizual: zgomot "value noise" pe o grilă grosieră, interpolat biliniar + netezire ---
function generateHeight(rng: RngHolder, w: number, h: number, out: Float32Array): void {
  const cell = 9; // distanța între punctele grilei grosiere
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = nextFloat(rng);

  const raw = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x / cell, gy = y / cell;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx); // smoothstep
      const sy = fy * fy * (3 - 2 * fy);
      const v00 = grid[y0 * gw + x0];
      const v10 = grid[y0 * gw + x0 + 1];
      const v01 = grid[(y0 + 1) * gw + x0];
      const v11 = grid[(y0 + 1) * gw + x0 + 1];
      const a = v00 + (v10 - v00) * sx;
      const b = v01 + (v11 - v01) * sx;
      raw[idx(w, x, y)] = a + (b - a) * sy;
    }
  }
  // o trecere de netezire (box blur 3x3) ca să elimine muchiile grilei
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, n = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const tx = x + ox, ty = y + oy;
          if (!inBounds(w, h, tx, ty)) continue;
          sum += raw[idx(w, tx, ty)];
          n++;
        }
      }
      out[idx(w, x, y)] = sum / n;
    }
  }
}

function scatterRock(rng: RngHolder, w: number, h: number, terrain: Uint8Array, clusters: number): void {
  for (let k = 0; k < clusters; k++) {
    const cx = nextInt(rng, w), cy = nextInt(rng, h);
    const r = 1.4 + nextFloat(rng) * 2.8;
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        const tx = cx + x, ty = cy + y;
        if (!inBounds(w, h, tx, ty)) continue;
        const d = Math.sqrt(x * x + (y * 1.2) * (y * 1.2));
        if (d < r + nextFloat(rng) * 0.9) terrain[idx(w, tx, ty)] = TERRAIN_ROCK;
      }
    }
  }
}

function scatterWater(rng: RngHolder, w: number, h: number, terrain: Uint8Array, ponds: number): void {
  for (let k = 0; k < ponds; k++) {
    const cx = nextInt(rng, w), cy = nextInt(rng, h);
    const r = 1.5 + nextFloat(rng) * 2.2;
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        const tx = cx + x, ty = cy + y;
        if (!inBounds(w, h, tx, ty)) continue;
        const d = Math.sqrt(x * x + y * y);
        if (d < r) terrain[idx(w, tx, ty)] = TERRAIN_WATER;
      }
    }
  }
}

function oreField(rng: RngHolder, w: number, h: number, terrain: Uint8Array, ore: Uint16Array, cx: number, cy: number, r: number): void {
  for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
    for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
      const tx = cx + x, ty = cy + y;
      if (!inBounds(w, h, tx, ty)) continue;
      const i = idx(w, tx, ty);
      if (terrain[i] !== TERRAIN_GROUND) continue;
      const d = Math.sqrt(x * x + y * y);
      if (d < r) ore[i] = Math.round(nextRange(rng, ORE_MIN, ORE_MAX));
    }
  }
}

// BFS 8-direcțional peste teren traversabil; întoarce setul de tile-uri atinse din `from`.
function floodFill(terrain: Uint8Array, w: number, h: number, fromX: number, fromY: number): Uint8Array {
  const seenArr = new Uint8Array(w * h);
  const stack = [idx(w, fromX, fromY)];
  seenArr[stack[0]] = 1;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let head = 0;
  while (head < stack.length) {
    const c = stack[head++];
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!passableTerrain(terrain, w, h, nx, ny)) continue;
      const n = idx(w, nx, ny);
      if (seenArr[n]) continue;
      seenArr[n] = 1;
      stack.push(n);
    }
  }
  return seenArr;
}

function carveCorridor(terrain: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number): void {
  // Bresenham + culoar de lățime ~2 ca să garanteze o cale traversabilă.
  let x = x0, y = y0;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let err = dx - dy;
  for (let guard = 0; guard < w + h + 4; guard++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const tx = x + ox, ty = y + oy;
        if (inBounds(w, h, tx, ty)) terrain[idx(w, tx, ty)] = TERRAIN_GROUND;
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

function ensureConnectivity(terrain: Uint8Array, w: number, h: number, starts: Vec[]): void {
  if (starts.length < 2) return;
  for (let guard = 0; guard < starts.length + 2; guard++) {
    const base = starts[0];
    const bx = Math.floor(base.x), by = Math.floor(base.y);
    const reached = floodFill(terrain, w, h, bx, by);
    let allConnected = true;
    for (let i = 1; i < starts.length; i++) {
      const sx = Math.floor(starts[i].x), sy = Math.floor(starts[i].y);
      if (!reached[idx(w, sx, sy)]) {
        allConnected = false;
        carveCorridor(terrain, w, h, bx, by, sx, sy);
      }
    }
    if (allConnected) return;
  }
}

export function generateMap(rng: RngHolder, setup: GameSetup): MapData {
  const w = setup.mapSize.w, h = setup.mapSize.h;
  const terrain = new Uint8Array(w * h);
  const height = new Float32Array(w * h);
  const ore = new Uint16Array(w * h);

  generateHeight(rng, w, h, height);

  const starts: Vec[] = setup.players.map((p) => {
    const c = cornerFor(p.team, w, h);
    return { x: c.x + 0.5, y: c.y + 0.5 };
  });

  scatterRock(rng, w, h, terrain, 26);
  scatterWater(rng, w, h, terrain, 4);

  // zonele de start și o "sosea" largă rămân libere
  for (const s of starts) clearArea(terrain, w, h, Math.floor(s.x), Math.floor(s.y), CLEAR_RADIUS);

  ensureConnectivity(terrain, w, h, starts);

  // minereu: un câmp lângă fiecare start (puțin spre interiorul hărții) + 2-3 contestate în mijloc
  for (const s of starts) {
    const cx = w / 2, cy = h / 2;
    const dirx = cx - s.x, diry = cy - s.y;
    const dlen = Math.max(1, Math.sqrt(dirx * dirx + diry * diry));
    const ox = Math.round(s.x + (dirx / dlen) * 11);
    const oy = Math.round(s.y + (diry / dlen) * 11);
    oreField(rng, w, h, terrain, ore, ox, oy, 3.4);
  }
  const midCount = 2 + nextInt(rng, 2); // 2 sau 3
  const midX = w / 2, midY = h / 2;
  for (let k = 0; k < midCount; k++) {
    const ang = (k / midCount) * PI * 2 + nextFloat(rng) * 0.6;
    const r = 6 + nextFloat(rng) * 5;
    const cx = Math.round(midX + fcos(ang) * r);
    const cy = Math.round(midY + fsin(ang) * r);
    oreField(rng, w, h, terrain, ore, cx, cy, 3 + nextFloat(rng) * 1.2);
  }

  // minereul nu trebuie plasat chiar pe pozițiile de start (zona construibilă)
  for (const s of starts) clearOreNear(ore, w, h, Math.floor(s.x), Math.floor(s.y), CLEAR_RADIUS);

  return { w, h, terrain, height, ore, starts };
}

function clearOreNear(ore: Uint16Array, w: number, h: number, cx: number, cy: number, r: number): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const tx = cx + x, ty = cy + y;
      if (!inBounds(w, h, tx, ty)) continue;
      if (x * x + y * y <= r * r) ore[idx(w, tx, ty)] = 0;
    }
  }
}

export function isPassable(terrain: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return passableTerrain(terrain, w, h, x, y);
}

export const _internal = { floodFill, minDistToList };
