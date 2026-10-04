// Decor: stanci (Quaternius, CC0) pe tile-urile de stanca, doar vizual — nu schimba nimic din teren.
// Se construieste dupa ce GLB-urile s-au incarcat; cate o InstancedMesh per piesa de model.
import * as THREE from 'three';
import { TERRAIN_ROCK, type MapData } from '../sim/types';
import { getLoadedModel } from './assets';

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface Scenery { group: THREE.Group; dispose(): void }

interface Piece { geo: THREE.BufferGeometry; mat: THREE.Material }
interface Variant { pieces: Piece[]; height: number }

/** extrage din GLB piesele, cu transformarea coapta in geometrie, centrate pe (0,0) si cu baza pe y=0 */
function variantFrom(file: string): Variant | null {
  const gltf = getLoadedModel(file);
  if (!gltf) return null;
  gltf.scene.updateMatrixWorld(true);
  const pieces: Piece[] = [];
  const box = new THREE.Box3();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    geo.computeBoundingBox();
    box.union(geo.boundingBox!);
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    pieces.push({ geo, mat });
  });
  if (pieces.length === 0) return null;
  const cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
  for (const p of pieces) {
    p.geo.translate(-cx, -box.min.y, -cz);
    const mm = p.mat as THREE.MeshStandardMaterial;
    mm.metalness = 0;
    mm.roughness = 0.9;
    if (mm.name.toLowerCase().includes('leaves')) { mm.alphaTest = 0.45; mm.transparent = false; mm.side = THREE.DoubleSide; }
  }
  return { pieces, height: Math.max(box.max.y - box.min.y, box.max.x - box.min.x, box.max.z - box.min.z) };
}

interface Spot { x: number; y: number; k: number }

export function buildScenery(map: MapData, heightAt: (x: number, y: number) => number): Scenery | null {
  const rocks = [variantFrom('rock1.glb'), variantFrom('rock2.glb')].filter((v): v is Variant => !!v);
  const trees = ['tree1.glb', 'tree2.glb', 'tree3.glb'].map(variantFrom).filter((v): v is Variant => !!v);
  const bush = variantFrom('bush1.glb');
  const rockSpots: Spot[][] = rocks.map(() => []);
  const treeSpots: Spot[][] = trees.map(() => []);
  const bushSpots: Spot[] = [];
  for (let ty = 0; ty < map.h; ty++) {
    for (let tx = 0; tx < map.w; tx++) {
      const border = tx === 0 || ty === 0 || tx === map.w - 1 || ty === map.h - 1;
      const isRock = map.terrain[ty * map.w + tx] === TERRAIN_ROCK;
      if (!isRock && !border) continue;
      const jx = tx + 0.2 + hash2(tx, ty) * 0.6, jy = ty + 0.2 + hash2(ty, tx) * 0.6;
      const k = hash2(tx * 3, ty * 5);
      if (isRock) {
        const n = 1 + (hash2(tx, ty + 99) < 0.35 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const v = (tx + ty + i) % 4 === 0 ? Math.min(1, rocks.length - 1) : 0;
          rockSpots[v]?.push({ x: tx + 0.15 + hash2(tx + i, ty) * 0.7, y: ty + 0.15 + hash2(ty + i, tx) * 0.7, k: hash2(tx + i * 11, ty * 7) });
        }
      }
      // copaci si tufisuri doar pe stanca si pe marginea hartii (unde oricum nu se lupta nimeni)
      const r = hash2(tx + 31, ty + 17);
      if (trees.length && r < (isRock ? 0.22 : 0.2)) treeSpots[Math.floor(k * trees.length) % trees.length].push({ x: jx, y: jy, k });
      else if (bush && r > (isRock ? 0.62 : 0.55)) bushSpots.push({ x: jx, y: jy, k });
    }
  }
  const group = new THREE.Group();
  group.name = 'scenery';
  const insts: THREE.InstancedMesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const p = new THREE.Vector3();
  const place = (v: Variant, spots: Spot[], hMin: number, hMax: number, sink: number): void => {
    if (spots.length === 0) return;
    for (const piece of v.pieces) {
      const inst = new THREE.InstancedMesh(piece.geo, piece.mat, spots.length);
      const isLeaf = piece.mat.transparent === false && (piece.mat as THREE.MeshStandardMaterial).alphaTest > 0;
      inst.castShadow = !isLeaf;
      inst.receiveShadow = true;
      spots.forEach((sp, i) => {
        const s = (hMin + sp.k * (hMax - hMin)) / v.height;
        q.setFromEuler(new THREE.Euler(0, sp.k * 40, 0));
        sc.set(s, s * (0.85 + sp.k * 0.3), s);
        p.set(sp.x, heightAt(sp.x, sp.y) - sink, sp.y);
        m.compose(p, q, sc);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      group.add(inst);
      insts.push(inst);
      geos.push(piece.geo);
    }
  };
  rocks.forEach((v, i) => place(v, rockSpots[i], 0.6, 1.0, 0.05));
  trees.forEach((v, i) => place(v, treeSpots[i], 1.1, 1.7, 0.02));
  if (bush) place(bush, bushSpots, 0.45, 0.8, 0.02);
  if (insts.length === 0) return null;
  return { group, dispose: () => { for (const g of geos) g.dispose(); for (const i of insts) i.dispose(); } };
}
