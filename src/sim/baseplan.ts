// Planificarea bazei, comună asistentului și AI-ului: perimetrul de apărare, câmpuri de minereu, postări pentru gardieni.
// Totul determinist (fără rng); rezultatele grele (accesibilitate, clustere de minereu) se calculează o singură dată.
import type { Building, Team, Vec, World } from './types';
import { TERRAIN_GROUND } from './types';
import type { Internal } from './internal';
import { center, distCC, sortedBuildingIds } from './entities';
import { fatan2 } from './fmath';

export interface OreCluster { x: number; y: number; tiles: number[] }

const DIRS8: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Clusterele de minereu ale hărții (componente conexe, cel puțin 6 tile-uri), calculate o dată. */
export function oreClusters(world: World, internal: Internal): OreCluster[] {
  if (internal.oreClusters) return internal.oreClusters;
  const { w, h, ore } = world.map;
  const seen = new Uint8Array(w * h);
  const out: OreCluster[] = [];
  for (let i = 0; i < ore.length; i++) {
    if (ore[i] <= 0 || seen[i]) continue;
    const tiles: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      tiles.push(c);
      const cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (seen[n] || ore[n] <= 0) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (tiles.length < 6) continue;
    let sx = 0, sy = 0;
    for (const t of tiles) { sx += (t % w) + 0.5; sy += ((t / w) | 0) + 0.5; }
    out.push({ x: sx / tiles.length, y: sy / tiles.length, tiles });
  }
  internal.oreClusters = out;
  return out;
}

/** Câmpul de minereu (încă neexploatat) cel mai apropiat de bază și departe de rafinăriile existente. */
export function expansionOre(world: World, internal: Internal, bs: Building[], base: Vec, maxDist = 30): Vec | null {
  const refs = bs.filter((b) => b.type === 'refinery').map(center);
  let best: Vec | null = null, bestD = Infinity;
  for (const c of oreClusters(world, internal)) {
    let left = 0;
    for (const t of c.tiles) if (world.map.ore[t] > 0) left++;
    if (left < 6) continue;
    const d = distCC(base, c);
    if (d > maxDist || d >= bestD) continue;
    if (refs.some((r) => distCC(r, c) < 8)) continue;
    bestD = d; best = { x: c.x, y: c.y };
  }
  return best;
}

/** Câte câmpuri de minereu sunt la îndemână (limitează numărul de rafinării: 2..4). */
export function refineryCap(world: World, internal: Internal, base: Vec): number {
  let n = 0;
  for (const c of oreClusters(world, internal)) if (distCC(base, c) <= 30) n++;
  return Math.max(2, Math.min(4, n));
}

/** Tile-uri accesibile pe teren din pozițiile de start ale celorlalte echipe (flood-fill, calculat o dată pe echipă). */
function reachFromEnemies(world: World, internal: Internal, team: Team): Uint8Array {
  const cached = internal.reach.get(team);
  if (cached) return cached;
  const { w, h, terrain } = world.map;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  world.players.forEach((p, i) => {
    if (p.team === team) return;
    const s = world.map.starts[i];
    if (!s) return;
    const k = Math.floor(s.y) * w + Math.floor(s.x);
    if (terrain[k] === TERRAIN_GROUND && !seen[k]) { seen[k] = 1; stack.push(k); }
  });
  while (stack.length) {
    const c = stack.pop()!;
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen[n] || terrain[n] !== TERRAIN_GROUND) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  internal.reach.set(team, seen);
  return seen;
}

/** Direcția unitară dinspre `from` spre cel mai apropiat inamic cunoscut (sau startul unui adversar). */
export function dirToEnemy(world: World, team: Team, from: Vec, known: Iterable<Vec>): Vec {
  let tgt: Vec | null = null, bestD = Infinity;
  for (const pos of known) { const d = distCC(from, pos); if (d < bestD) { bestD = d; tgt = pos; } }
  if (!tgt) {
    let bd = Infinity;
    world.players.forEach((p, i) => {
      if (p.team === team || p.defeated) return;
      const s = world.map.starts[i];
      if (!s) return;
      const d = distCC(from, s);
      if (d < bd) { bd = d; tgt = s; }
    });
  }
  if (!tgt) return { x: 0, y: 1 };
  const t = tgt as Vec;
  const d = distCC(from, t) || 1;
  return { x: (t.x - from.x) / d, y: (t.y - from.y) / d };
}

/**
 * Următorul loc pentru o turelă pe perimetrul bazei: puncte pe conturul (cu margine) al clădirilor proprii, doar pe laturile
 * accesibile pe sol din exterior (laturile închise de stâncă/apă/marginea hărții sunt sărite), mai dese spre inamic,
 * lângă rafinării și lângă câmpul de minereu; se aleg mai întâi punctele cele mai departe de turelele existente (acoperă toate laturile).
 */
export function perimeterAnchor(world: World, internal: Internal, team: Team, bs: Building[], base: Vec, known: Iterable<Vec>, side = 0): Vec | null {
  const { w, h, terrain } = world.map;
  const body = bs.filter((b) => b.type !== 'turret' && b.type !== 'rocketTurret' && b.type !== 'tesla' && b.type !== 'wall');
  if (body.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of body) {
    minX = Math.min(minX, b.tx); minY = Math.min(minY, b.ty);
    maxX = Math.max(maxX, b.tx + b.w); maxY = Math.max(maxY, b.ty + b.h);
  }
  const M = 3 + side; // marginea conturului
  minX -= M; minY -= M; maxX += M; maxY += M;
  const reach = reachFromEnemies(world, internal, team);
  const dir = dirToEnemy(world, team, base, known);
  const turrets = bs.filter((b) => b.type === 'turret' || b.type === 'rocketTurret' || b.type === 'tesla').map(center);
  const refs = bs.filter((b) => b.type === 'refinery').map(center);
  const orePts = oreClusters(world, internal).filter((c) => distCC(base, c) < 24);
  const pts: Array<{ x: number; y: number; nx: number; ny: number }> = [];
  const step = 3;
  for (let x = minX; x <= maxX; x += step) { pts.push({ x, y: minY, nx: 0, ny: -1 }); pts.push({ x, y: maxY, nx: 0, ny: 1 }); }
  for (let y = minY + step; y < maxY; y += step) { pts.push({ x: minX, y, nx: -1, ny: 0 }); pts.push({ x: maxX, y, nx: 1, ny: 0 }); }
  let best: Vec | null = null, bestScore = -Infinity;
  for (const p of pts) {
    const px = Math.round(p.x), py = Math.round(p.y);
    if (px < 2 || py < 2 || px >= w - 2 || py >= h - 2) continue;
    if (terrain[py * w + px] !== TERRAIN_GROUND) continue;
    // latura e deschisă doar dacă în exterior (la ~4 tile-uri) e teren accesibil de la inamic
    const ox = Math.round(p.x + p.nx * 4), oy = Math.round(p.y + p.ny * 4);
    if (ox < 0 || oy < 0 || ox >= w || oy >= h || !reach[oy * w + ox]) continue;
    let score = (p.nx * dir.x + p.ny * dir.y) * 2 + 2; // mai des spre inamic
    for (const r of refs) if (distCC(r, p) < 7) score += 1.2;
    for (const c of orePts) if (distCC(c, p) < 9) score += 0.8;
    let nearest = 12;
    for (const t of turrets) nearest = Math.min(nearest, distCC(t, p));
    score += nearest * 0.9; // acoperire: întâi locurile departe de turele
    if (nearest < 3) score -= 6;
    if (score > bestScore) { bestScore = score; best = { x: p.x, y: p.y }; }
  }
  return best;
}

/** Posturi pentru gardieni: la golurile dintre turele, lângă câmpul de minereu și lângă rafinării. */
export function guardPosts(world: World, internal: Internal, bs: Building[], base: Vec): Vec[] {
  const posts: Vec[] = [];
  const turrets = bs.filter((b) => b.type === 'turret' || b.type === 'rocketTurret').map(center);
  const ang = (p: Vec): number => fatan2(p.y - base.y, p.x - base.x);
  turrets.sort((a, b) => ang(a) - ang(b) || a.x - b.x || a.y - b.y);
  for (let i = 0; i < turrets.length; i++) {
    const a = turrets[i], b = turrets[(i + 1) % turrets.length];
    if (a === b) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // puțin spre interior, spre centrul bazei
    const d = distCC(mid, base) || 1;
    posts.push({ x: mid.x + ((base.x - mid.x) / d) * 1.5, y: mid.y + ((base.y - mid.y) / d) * 1.5 });
  }
  for (const c of oreClusters(world, internal)) if (distCC(base, c) < 24) posts.push({ x: c.x, y: c.y });
  for (const r of bs) if (r.type === 'refinery') { const c = center(r); posts.push({ x: c.x, y: c.y + r.h / 2 + 2.5 }); }
  if (posts.length === 0) posts.push({ x: base.x, y: base.y + 5 });
  return posts;
}

export function ownBuildingsOf(world: World, team: Team): Building[] {
  const out: Building[] = [];
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (b && b.team === team) out.push(b);
  }
  return out;
}

// ---------- ziduri la strâmtori (asistent) ----------

const WALL_RADIUS = 16;      // strâmtorile căutate în jurul bazei
const WALL_MAX_TOTAL = 12;   // câte ziduri proprii cel mult

/** Tile-urile accesibile (teren liber, fără ziduri) din care se pornește un BFS; `extra` = tile-uri închise ipotetic. */
function sealSafe(world: World, internal: Internal, team: Team, bs: Building[], base: Vec, extra: Set<number>): boolean {
  void internal;
  const { w, h, terrain, ore } = world.map;
  const walls = new Set<number>(extra);
  for (const b of world.buildings.values()) if (b.type === 'wall') walls.add(b.ty * w + b.tx);
  const seen = new Uint8Array(w * h);
  const sx = Math.max(0, Math.min(w - 1, Math.floor(base.x))), sy = Math.max(0, Math.min(h - 1, Math.floor(base.y)));
  const stack: number[] = [];
  // pornim de lângă HQ: primul tile liber din jurul centrului
  outer: for (let r = 0; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = y * w + x;
      if (terrain[k] === TERRAIN_GROUND && !walls.has(k)) { stack.push(k); seen[k] = 1; break outer; }
    }
  }
  if (stack.length === 0) return false;
  while (stack.length) {
    const c = stack.pop()!;
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (seen[n] || terrain[n] !== TERRAIN_GROUND || walls.has(n)) continue;
      // fără tăiat colțuri prin ziduri
      if (dx !== 0 && dy !== 0 && (walls.has(cy * w + nx) || walls.has(ny * w + cx))) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  const reached = (x: number, y: number): boolean => {
    // un tile atins în jurul punctului (clădirile stau pe teren, deci vecinătatea lor trebuie atinsă)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = Math.floor(x) + dx, Y = Math.floor(y) + dy;
      if (X >= 0 && Y >= 0 && X < w && Y < h && seen[Y * w + X]) return true;
    }
    return false;
  };
  for (const b of bs) {
    if (b.type === 'wall') continue;
    let ok = false;
    for (let y = b.ty - 1; y <= b.ty + b.h && !ok; y++) for (let x = b.tx - 1; x <= b.tx + b.w; x++) {
      if (x >= 0 && y >= 0 && x < w && y < h && seen[y * w + x]) { ok = true; break; }
    }
    if (!ok) return false;
  }
  for (const c of oreClusters(world, internal)) {
    if (distCC(base, c) > 24) continue;
    let any = false;
    for (const t of c.tiles) if (ore[t] > 0 && seen[t]) { any = true; break; }
    if (!any && !reached(c.x, c.y)) return false;
  }
  // și cel puțin un start inamic rămâne legat de bază
  let enemyOk = false, hasEnemy = false;
  world.players.forEach((p, i) => {
    if (p.team === team || p.defeated) return;
    const s = world.map.starts[i];
    if (!s) return;
    hasEnemy = true;
    if (reached(s.x, s.y)) enemyOk = true;
  });
  return !hasEnemy || enemyOk;
}

/**
 * Plan de ziduri: goluri înguste (cel mult 3 tile-uri) între stâncă/apă, la mai puțin de WALL_RADIUS de bază, care continuă
 * de ambele părți (adică un trecător adevărat). Fiecare gol se acceptă doar dacă baza rămâne legată pe sol de toate clădirile
 * proprii, de câmpul de minereu și de un inamic (verificat cu BFS, cumulativ).
 */
export function wallPlan(world: World, internal: Internal, team: Team, bs: Building[], base: Vec): Array<{ tx: number; ty: number }> {
  const { w, h, terrain, ore } = world.map;
  const own = bs.filter((b) => b.type === 'wall').length;
  if (own >= WALL_MAX_TOTAL) return [];
  const cls = new Uint8Array(w * h); // 0 liber, 1 dur (stâncă/apă), 2 clădire
  for (let i = 0; i < cls.length; i++) cls[i] = terrain[i] === TERRAIN_GROUND ? 0 : 1;
  for (const b of world.buildings.values()) {
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const X = b.tx + x, Y = b.ty + y;
      if (X >= 0 && Y >= 0 && X < w && Y < h) cls[Y * w + X] = 2;
    }
  }
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 1 : cls[y * w + x]);
  const runs: Array<{ tiles: number[]; d: number }> = [];
  const seenRun = new Set<string>();
  const x0 = Math.max(1, Math.floor(base.x - WALL_RADIUS)), x1 = Math.min(w - 2, Math.ceil(base.x + WALL_RADIUS));
  const y0 = Math.max(1, Math.floor(base.y - WALL_RADIUS)), y1 = Math.min(h - 2, Math.ceil(base.y + WALL_RADIUS));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (at(x, y) !== 0) continue;
      for (const horiz of [true, false]) {
        const dx = horiz ? 1 : 0, dy = horiz ? 0 : 1;
        let a = 0;
        while (a < 4 && at(x - dx * (a + 1), y - dy * (a + 1)) === 0) a++;
        let b = 0;
        while (b < 4 && at(x + dx * (b + 1), y + dy * (b + 1)) === 0) b++;
        const len = a + b + 1;
        if (len > 3) continue;
        if (at(x - dx * (a + 1), y - dy * (a + 1)) !== 1 || at(x + dx * (b + 1), y + dy * (b + 1)) !== 1) continue; // capete: stâncă/apă
        const tiles: number[] = [];
        let ok = true;
        for (let k = -a; k <= b; k++) {
          const tx = x + dx * k, ty = y + dy * k;
          if (ore[ty * w + tx] > 0) { ok = false; break; }
          // trecătoare adevărată: de ambele părți (perpendicular) terenul continuă
          if (at(tx + dy, ty + dx) === 1 || at(tx - dy, ty - dx) === 1) { ok = false; break; }
          tiles.push(ty * w + tx);
        }
        if (!ok) continue;
        const key = (horiz ? 'h' : 'v') + tiles[0] + ':' + len;
        if (seenRun.has(key)) continue;
        seenRun.add(key);
        const cx = x + dx * ((b - a) / 2), cy = y + dy * ((b - a) / 2);
        const d = distCC(base, { x: cx, y: cy });
        if (d <= WALL_RADIUS) runs.push({ tiles, d });
      }
    }
  }
  runs.sort((p, q) => p.d - q.d || p.tiles[0] - q.tiles[0]);
  const accepted = new Set<number>();
  const plan: Array<{ tx: number; ty: number }> = [];
  for (const r of runs) {
    if (own + plan.length + r.tiles.length > WALL_MAX_TOTAL) continue;
    const trial = new Set<number>(accepted);
    for (const t of r.tiles) trial.add(t);
    if (!sealSafe(world, internal, team, bs, base, trial)) continue;
    for (const t of r.tiles) { accepted.add(t); plan.push({ tx: t % w, ty: (t / w) | 0 }); }
    if (plan.length >= 6) break;
  }
  return plan;
}

/** Verifică încă o dată (cu starea curentă a lumii) că închiderea acestui tile nu sigilează baza. */
export function wallTileSafe(world: World, internal: Internal, team: Team, bs: Building[], base: Vec, tx: number, ty: number): boolean {
  return sealSafe(world, internal, team, bs, base, new Set<number>([ty * world.map.w + tx]));
}
