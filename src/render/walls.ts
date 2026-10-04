// Ziduri: segmente de beton care se leaga de vecini (dreapta / colt / T / cruce, dupa cei 4 vecini).
// O singura InstancedMesh per (varianta, echipa): 150 de segmente costa cateva desenari.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Team } from '../sim/types';
import { TEAM_COLORS } from './models';

export interface WallEntry { tx: number; ty: number; team: Team; hpFrac: number }

const N = 1, E = 2, S = 4, W = 8;

function colored(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
function part(w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colored(g, c);
}

function buildGeometry(mask: number, team: Team): THREE.BufferGeometry {
  const concrete = new THREE.Color(0x9b988e), dark = new THREE.Color(0x6f6c63), stripe = new THREE.Color(TEAM_COLORS[team]);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(part(0.4, 0.14, 0.4, 0, 0.07, 0, dark));
  parts.push(part(0.34, 0.6, 0.34, 0, 0.35, 0, concrete));
  parts.push(part(0.38, 0.05, 0.38, 0, 0.64, 0, stripe));
  const arm = (dx: number, dz: number): void => {
    const alongX = dx !== 0;
    const len = 0.5;
    const cx = dx * 0.25, cz = dz * 0.25;
    parts.push(part(alongX ? len : 0.26, 0.12, alongX ? 0.3 : len, cx, 0.06, cz, dark));
    parts.push(part(alongX ? len : 0.24, 0.46, alongX ? 0.24 : len, cx, 0.34, cz, concrete));
    parts.push(part(alongX ? len : 0.1, 0.04, alongX ? 0.1 : len, cx, 0.58, cz, stripe));
  };
  if (mask & N) arm(0, -1);
  if (mask & E) arm(1, 0);
  if (mask & S) arm(0, 1);
  if (mask & W) arm(-1, 0);
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  return merged;
}

interface Slot { mesh: THREE.InstancedMesh; capacity: number }

export class WallLayer {
  readonly group = new THREE.Group();
  private readonly geos = new Map<string, THREE.BufferGeometry>();
  private readonly slots = new Map<string, Slot>();
  private readonly mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 });
  private readonly m = new THREE.Matrix4();
  private readonly c = new THREE.Color();

  constructor() { this.group.name = 'walls'; }

  private slot(key: string, mask: number, team: Team, need: number): Slot {
    let s = this.slots.get(key);
    if (s && s.capacity >= need) return s;
    if (s) { this.group.remove(s.mesh); s.mesh.dispose(); }
    let geo = this.geos.get(key);
    if (!geo) { geo = buildGeometry(mask, team); this.geos.set(key, geo); }
    const capacity = Math.max(32, need * 2);
    const mesh = new THREE.InstancedMesh(geo, this.mat, capacity);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    s = { mesh, capacity };
    this.slots.set(key, s);
    return s;
  }

  /** o data pe tick: reconstruieste instantele (varianta fiecarui segment depinde de vecini) */
  update(entries: WallEntry[], heightAt: (x: number, y: number) => number): void {
    const at = new Map<number, Team>();
    for (const e of entries) at.set(e.tx * 4096 + e.ty, e.team);
    const buckets = new Map<string, { mask: number; team: Team; list: WallEntry[] }>();
    for (const e of entries) {
      const same = (dx: number, dy: number): boolean => at.get((e.tx + dx) * 4096 + e.ty + dy) === e.team;
      const mask = (same(0, -1) ? N : 0) | (same(1, 0) ? E : 0) | (same(0, 1) ? S : 0) | (same(-1, 0) ? W : 0);
      const key = mask + ':' + e.team;
      let b = buckets.get(key);
      if (!b) { b = { mask, team: e.team, list: [] }; buckets.set(key, b); }
      b.list.push(e);
    }
    for (const s of this.slots.values()) s.mesh.count = 0;
    for (const [key, b] of buckets) {
      const s = this.slot(key, b.mask, b.team, b.list.length);
      b.list.forEach((e, i) => {
        const x = e.tx + 0.5, z = e.ty + 0.5;
        this.m.makeTranslation(x, heightAt(x, z), z);
        s.mesh.setMatrixAt(i, this.m);
        const k = e.hpFrac < 0.25 ? 0.4 : e.hpFrac < 0.5 ? 0.65 : 1;
        const t = e.hpFrac < 0.25 ? 0.8 : 1;
        this.c.setRGB(k, k * t, k * t);
        s.mesh.setColorAt(i, this.c);
      });
      s.mesh.count = b.list.length;
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const s of this.slots.values()) s.mesh.dispose();
    for (const g of this.geos.values()) g.dispose();
    this.mat.dispose();
  }
}
