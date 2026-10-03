// Pathfinding: A* pe grilă 8-direcțională (fără "colț tăiat"), cu heap binar, plus
// netezire prin "string pulling" (line-of-sight), și flow field (Dijkstra) pentru grupuri mari.
import type { Vec, World, Building } from './types';
import { TERRAIN_GROUND } from './types';

export const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.4142135623730951], [1, -1, 1.4142135623730951],
  [-1, 1, 1.4142135623730951], [-1, -1, 1.4142135623730951],
];

function idx(w: number, x: number, y: number): number {
  return y * w + x;
}
function inBounds(w: number, h: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h;
}

/** Grilă de blocaje: stâncă/apă din teren + amprenta clădirilor. Nu include unitățile (soft-obstacle). */
export function buildBlockedGrid(world: World): Uint8Array {
  const { w, h, terrain } = world.map;
  const blocked = new Uint8Array(w * h);
  for (let i = 0; i < blocked.length; i++) blocked[i] = terrain[i] === TERRAIN_GROUND ? 0 : 1;
  const ids = [...world.buildings.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const b = world.buildings.get(id) as Building;
    for (let y = 0; y < b.h; y++) {
      for (let x = 0; x < b.w; x++) {
        const tx = b.tx + x, ty = b.ty + y;
        if (inBounds(w, h, tx, ty)) blocked[idx(w, tx, ty)] = 1;
      }
    }
  }
  return blocked;
}

export function isFree(blocked: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  return inBounds(w, h, x, y) && blocked[idx(w, x, y)] === 0;
}

/** Cel mai apropiat tile liber de (tx,ty), în raza R (căutare pe inele). */
export function nearestFree(blocked: Uint8Array, w: number, h: number, tx: number, ty: number, R: number): Vec | null {
  if (isFree(blocked, w, h, tx, ty)) return { x: tx, y: ty };
  for (let r = 1; r <= R; r++) {
    let best: Vec | null = null;
    let bestD = Infinity;
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== r) continue;
        const nx = tx + x, ny = ty + y;
        if (!isFree(blocked, w, h, nx, ny)) continue;
        const d = x * x + y * y;
        if (d < bestD) { bestD = d; best = { x: nx, y: ny }; }
      }
    }
    if (best) return best;
  }
  return null;
}

// --- heap binar minim, indexat ---
class MinHeap {
  private idxArr: number[] = [];
  private fArr: number[] = [];
  get size(): number { return this.idxArr.length; }
  push(i: number, f: number): void {
    this.idxArr.push(i); this.fArr.push(f);
    let k = this.idxArr.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.fArr[p] <= this.fArr[k]) break;
      this.swap(p, k); k = p;
    }
  }
  pop(): number {
    const top = this.idxArr[0];
    const li = this.idxArr.pop() as number, lf = this.fArr.pop() as number;
    if (this.idxArr.length) {
      this.idxArr[0] = li; this.fArr[0] = lf;
      let k = 0;
      for (;;) {
        const a = 2 * k + 1, b = a + 1;
        let m = k;
        if (a < this.idxArr.length && this.fArr[a] < this.fArr[m]) m = a;
        if (b < this.idxArr.length && this.fArr[b] < this.fArr[m]) m = b;
        if (m === k) break;
        this.swap(m, k); k = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.idxArr[a], this.idxArr[b]] = [this.idxArr[b], this.idxArr[a]];
    [this.fArr[a], this.fArr[b]] = [this.fArr[b], this.fArr[a]];
  }
}

function heuristic(x: number, y: number, gx: number, gy: number): number {
  const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
  return Math.max(dx, dy) + 0.4142135623730951 * Math.min(dx, dy);
}

const MAX_ASTAR_ITER = 8000;

/** A* clasic. Întoarce waypoint-uri centrate-pe-tile (fără punctul de start), netezite prin LOS. */
export function findPath(blocked: Uint8Array, w: number, h: number, sx: number, sy: number, gx: number, gy: number): Vec[] | null {
  const goalFree = nearestFree(blocked, w, h, gx, gy, 7);
  if (!goalFree) return null;
  gx = goalFree.x; gy = goalFree.y;
  if (sx === gx && sy === gy) return [];

  const N = w * h;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  const s = idx(w, sx, sy), goal = idx(w, gx, gy);
  gScore[s] = 0;
  heap.push(s, heuristic(sx, sy, gx, gy));
  let iter = 0;
  while (heap.size && iter++ < MAX_ASTAR_ITER) {
    const c = heap.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    if (c === goal) break;
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!isFree(blocked, w, h, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        // interzice tăierea colțului: ambele tile-uri adiacente trebuie libere
        if (!isFree(blocked, w, h, cx + dx, cy) || !isFree(blocked, w, h, cx, cy + dy)) continue;
      }
      const n = idx(w, nx, ny);
      if (closed[n]) continue;
      const ng = gScore[c] + cost;
      if (ng < gScore[n]) {
        gScore[n] = ng;
        came[n] = c;
        heap.push(n, ng + heuristic(nx, ny, gx, gy));
      }
    }
  }
  if (came[goal] < 0 && goal !== s) return null;

  const raw: Vec[] = [];
  let c = goal;
  while (c !== s) {
    raw.push({ x: (c % w) + 0.5, y: ((c / w) | 0) + 0.5 });
    c = came[c];
    if (c < 0) break;
  }
  raw.reverse();
  return smoothPath(blocked, w, h, { x: sx + 0.5, y: sy + 0.5 }, raw);
}

// --- string pulling: elimină waypoint-uri intermediare cu linie de vedere liberă ---
function hasLineOfSight(blocked: Uint8Array, w: number, h: number, a: Vec, b: Vec): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2) + 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + dx * t);
    const y = Math.floor(a.y + dy * t);
    if (!isFree(blocked, w, h, x, y)) return false;
  }
  return true;
}

function smoothPath(blocked: Uint8Array, w: number, h: number, start: Vec, waypoints: Vec[]): Vec[] {
  if (waypoints.length <= 1) return waypoints;
  const out: Vec[] = [];
  let anchor = start;
  let i = 0;
  while (i < waypoints.length) {
    let j = waypoints.length - 1;
    while (j > i && !hasLineOfSight(blocked, w, h, anchor, waypoints[j])) j--;
    out.push(waypoints[j]);
    anchor = waypoints[j];
    i = j + 1;
  }
  return out;
}

// --- flow field: câmp de distanțe Dijkstra de la o țintă, pentru grupuri numeroase ---
export interface FlowField { w: number; h: number; dist: Float32Array; gx: number; gy: number }

export function buildFlowField(blocked: Uint8Array, w: number, h: number, gx: number, gy: number): FlowField {
  const goalFree = nearestFree(blocked, w, h, gx, gy, 7) ?? { x: gx, y: gy };
  gx = goalFree.x; gy = goalFree.y;
  const N = w * h;
  const dist = new Float32Array(N).fill(Infinity);
  const closed = new Uint8Array(N);
  const heap = new MinHeap();
  const goal = idx(w, gx, gy);
  dist[goal] = 0;
  heap.push(goal, 0);
  while (heap.size) {
    const c = heap.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!isFree(blocked, w, h, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isFree(blocked, w, h, cx + dx, cy) || !isFree(blocked, w, h, cx, cy + dy)) continue;
      }
      const n = idx(w, nx, ny);
      if (closed[n]) continue;
      const nd = dist[c] + cost;
      if (nd < dist[n]) { dist[n] = nd; heap.push(n, nd); }
    }
  }
  return { w, h, dist, gx, gy };
}

/** Următorul tile (centrul lui) în direcția gradientului descrescător al câmpului de distanțe. */
export function flowFieldStep(field: FlowField, blocked: Uint8Array, x: number, y: number): Vec | null {
  const { w, h, dist } = field;
  const cx = Math.floor(x), cy = Math.floor(y);
  let bestD = dist[idx(w, cx, cy)];
  if (!Number.isFinite(bestD)) bestD = Infinity;
  let best: Vec | null = null;
  for (const [dx, dy] of DIRS) {
    const nx = cx + dx, ny = cy + dy;
    if (!isFree(blocked, w, h, nx, ny)) continue;
    if (dx !== 0 && dy !== 0) {
      if (!isFree(blocked, w, h, cx + dx, cy) || !isFree(blocked, w, h, cx, cy + dy)) continue;
    }
    const d = dist[idx(w, nx, ny)];
    if (d < bestD) { bestD = d; best = { x: nx + 0.5, y: ny + 0.5 }; }
  }
  return best;
}
