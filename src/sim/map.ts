// Generare hartă deterministă din seed: relief, stânci (ascunzători/strâmtori), bălți, minereu.
// Garantează conectivitate între toate pozițiile de start (BFS + "săpare" de culoar dacă e nevoie).
import type { GameSetup, MapData, MapStyle, Vec } from './types';
import { TERRAIN_GROUND, TERRAIN_ROCK, TERRAIN_WATER } from './types';
import type { RngHolder } from './rng';
import { nextFloat, nextInt, nextRange } from './rng';
import { PI, fcos, fsin } from './fmath';

const START_MARGIN = 9;
const CLEAR_RADIUS = 7;
const ORE_MIN = 700;
const ORE_MAX = 1100;

interface Corner { x: number; y: number }

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

// --- poziții de start: pentru N jucători, puncte din jurul hărții cât mai îndepărtate între ele ---

function startCandidates(w: number, h: number): Corner[] {
  const m = START_MARGIN;
  const c: Corner[] = [
    { x: m, y: h - m - 1 }, { x: w - m - 1, y: m }, { x: m, y: m }, { x: w - m - 1, y: h - m - 1 }, // colțuri
    { x: Math.floor(w / 2), y: m }, { x: Math.floor(w / 2), y: h - m - 1 }, { x: m, y: Math.floor(h / 2) }, { x: w - m - 1, y: Math.floor(h / 2) }, // mijloacele laturilor
  ];
  if (Math.min(w, h) >= 88) {
    // hărți mari: și un inel interior
    const ix = Math.floor(w * 0.3), iy = Math.floor(h * 0.3);
    c.push({ x: ix, y: iy }, { x: w - ix - 1, y: iy }, { x: ix, y: h - iy - 1 }, { x: w - ix - 1, y: h - iy - 1 });
  }
  return c;
}

/** Alege N puncte care maximizează distanța minimă dintre perechi (la egalitate, după seed) și le amestecă între echipe. */
function pickStarts(rng: RngHolder, w: number, h: number, n: number): Corner[] {
  const cands = startCandidates(w, h);
  const combos: Array<{ idx: number[]; minD: number }> = [];
  const rec = (start: number, cur: number[]): void => {
    if (cur.length === n) {
      let minD = Infinity;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const d = Math.sqrt((cands[cur[i]].x - cands[cur[j]].x) ** 2 + (cands[cur[i]].y - cands[cur[j]].y) ** 2);
        if (d < minD) minD = d;
      }
      combos.push({ idx: cur.slice(), minD });
      return;
    }
    for (let i = start; i < cands.length; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); }
  };
  rec(0, []);
  let best = 0;
  for (const c of combos) if (c.minD > best) best = c.minD;
  const top = combos.filter((c) => c.minD >= best * 0.97);
  const chosen = top[nextInt(rng, top.length)].idx.map((i) => cands[i]);
  // amestecare Fisher-Yates: omul nu e mereu în același colț
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    const t = chosen[i]; chosen[i] = chosen[j]; chosen[j] = t;
  }
  return chosen;
}

// --- stiluri de hartă ---

function fillDisc(terrain: Uint8Array, w: number, h: number, cx: number, cy: number, rx: number, ry: number, value: number): void {
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) {
    for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
      if (!inBounds(w, h, x, y)) continue;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) terrain[idx(w, x, y)] = value;
    }
  }
}

/** Creastă de stâncă între două puncte, groasă ~3, cu `gaps` treceri înguste (strâmtori). */
function ridge(rng: RngHolder, w: number, h: number, terrain: Uint8Array, x0: number, y0: number, x1: number, y1: number, gaps: number): void {
  const len = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const gapAt: number[] = [];
  for (let g = 0; g < gaps; g++) gapAt.push(Math.floor(len * ((g + 0.5) / gaps + (nextFloat(rng) - 0.5) * 0.18)));
  for (let t = 0; t <= len; t++) {
    if (gapAt.some((g) => Math.abs(g - t) <= 3)) continue;
    const x = Math.round(x0 + ((x1 - x0) * t) / len), y = Math.round(y0 + ((y1 - y0) * t) / len);
    const wob = nextInt(rng, 2);
    for (let oy = -1; oy <= 1 + wob; oy++) for (let ox = -1; ox <= 1 + wob; ox++) {
      if (inBounds(w, h, x + ox, y + oy)) terrain[idx(w, x + ox, y + oy)] = TERRAIN_ROCK;
    }
  }
}

function buildTerrain(rng: RngHolder, style: Exclude<MapStyle, 'random'>, w: number, h: number, terrain: Uint8Array, starts: Vec[]): void {
  const scale = (w * h) / 6400;
  const farFromStarts = (x: number, y: number, d: number): boolean => minDistToList(x, y, starts) > d;
  if (style === 'open') {
    scatterRock(rng, w, h, terrain, Math.round(9 * scale));
    scatterWater(rng, w, h, terrain, Math.round(2 * scale));
  } else if (style === 'passes') {
    // două creste (verticală + orizontală) cu 2-3 strâmtori fiecare, între baze
    const gaps = 2 + nextInt(rng, 2);
    ridge(rng, w, h, terrain, Math.floor(w / 2), 0, Math.floor(w / 2), h - 1, gaps);
    ridge(rng, w, h, terrain, 0, Math.floor(h / 2), w - 1, Math.floor(h / 2), gaps);
    scatterRock(rng, w, h, terrain, Math.round(6 * scale));
  } else if (style === 'lakes') {
    const lakes = 3 + nextInt(rng, 3);
    for (let k = 0; k < lakes; k++) {
      for (let tries = 0; tries < 20; tries++) {
        const cx = 8 + nextInt(rng, w - 16), cy = 8 + nextInt(rng, h - 16);
        const r = (5 + nextFloat(rng) * 5) * Math.sqrt(scale);
        if (!farFromStarts(cx, cy, r + 13)) continue;
        fillDisc(terrain, w, h, cx, cy, r * (0.8 + nextFloat(rng) * 0.5), r, TERRAIN_WATER);
        break;
      }
    }
    scatterRock(rng, w, h, terrain, Math.round(8 * scale));
  } else {
    // islands: apă peste tot, insule în jurul bazelor și în centru, legate prin punți de uscat
    terrain.fill(TERRAIN_WATER);
    for (const s of starts) fillDisc(terrain, w, h, s.x, s.y, 16, 16, TERRAIN_GROUND);
    fillDisc(terrain, w, h, w / 2, h / 2, 11 * Math.sqrt(scale), 11 * Math.sqrt(scale), TERRAIN_GROUND);
    for (let k = 0; k < 4; k++) {
      const cx = 10 + nextInt(rng, w - 20), cy = 10 + nextInt(rng, h - 20);
      fillDisc(terrain, w, h, cx, cy, 4 + nextFloat(rng) * 3, 4 + nextFloat(rng) * 3, TERRAIN_GROUND);
    }
    for (const s of starts) carveCorridor(terrain, w, h, Math.floor(s.x), Math.floor(s.y), Math.floor(w / 2), Math.floor(h / 2));
    scatterRock(rng, w, h, terrain, Math.round(5 * scale));
  }
}

const ORE_FIELD_R = 3.4;

/** Câmp de minereu cu aceleași tile-uri și aceleași cantități pentru fiecare start (corectitudine). */
function equalOreField(w: number, h: number, terrain: Uint8Array, ore: Uint16Array, cx: number, cy: number, amounts: number[]): void {
  let k = 0;
  const r = Math.ceil(ORE_FIELD_R);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (Math.sqrt(x * x + y * y) >= ORE_FIELD_R) continue;
      const tx = cx + x, ty = cy + y;
      if (!inBounds(w, h, tx, ty)) continue;
      terrain[idx(w, tx, ty)] = TERRAIN_GROUND;
      ore[idx(w, tx, ty)] = amounts[k % amounts.length];
      k++;
    }
  }
}

export function generateMap(rng: RngHolder, setup: GameSetup): MapData {
  const w = setup.mapSize.w, h = setup.mapSize.h;
  const terrain = new Uint8Array(w * h);
  const height = new Float32Array(w * h);
  const ore = new Uint16Array(w * h);
  const n = Math.max(2, Math.min(4, setup.players.length));

  generateHeight(rng, w, h, height);

  const starts: Vec[] = pickStarts(rng, w, h, n).map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
  while (starts.length < setup.players.length) starts.push({ x: starts[0].x, y: starts[0].y });

  const styles: Array<Exclude<MapStyle, 'random'>> = ['open', 'passes', 'lakes', 'islands'];
  const requested = setup.mapStyle ?? 'random';
  const style = requested === 'random' ? styles[nextInt(rng, styles.length)] : requested;
  buildTerrain(rng, style, w, h, terrain, starts);

  // zonele de start rămân libere
  for (const s of starts) clearArea(terrain, w, h, Math.floor(s.x), Math.floor(s.y), CLEAR_RADIUS);

  // minereu: câte un câmp identic lângă fiecare start (spre interior)
  const amounts: number[] = [];
  for (let i = 0; i < 40; i++) amounts.push(Math.round(nextRange(rng, ORE_MIN, ORE_MAX)));
  const oreSpots: Vec[] = [];
  for (const s of starts) {
    const dirx = w / 2 - s.x, diry = h / 2 - s.y;
    const dlen = Math.max(1, Math.sqrt(dirx * dirx + diry * diry));
    const ox = Math.max(4, Math.min(w - 5, Math.round(s.x + (dirx / dlen) * 11)));
    const oy = Math.max(4, Math.min(h - 5, Math.round(s.y + (diry / dlen) * 11)));
    equalOreField(w, h, terrain, ore, ox, oy, amounts);
    oreSpots.push({ x: ox, y: oy });
  }
  // câmpuri contestate în mijloc: mai multe cu cât sunt mai mulți jucători
  const midCount = n + nextInt(rng, 2);
  const sc = Math.min(w, h) / 80;
  for (let k = 0; k < midCount; k++) {
    const ang = (k / midCount) * PI * 2 + nextFloat(rng) * 0.6;
    const r = (6 + nextFloat(rng) * 5) * sc;
    const cx = Math.round(w / 2 + fcos(ang) * r);
    const cy = Math.round(h / 2 + fsin(ang) * r);
    if (minDistToList(cx, cy, starts) < 21) continue; // câmpurile contestate nu intră în raza unui start (corectitudine)
    equalOreField(w, h, terrain, ore, cx, cy, amounts.slice(k * 3).concat(amounts));
    oreSpots.push({ x: cx, y: cy });
  }

  // fiecare start trebuie să ajungă la toți ceilalți și la propriul câmp de minereu
  ensureConnectivity(terrain, w, h, starts.concat(oreSpots));

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
