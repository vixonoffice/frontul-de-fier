// Fuzioneaza mesh-urile statice ale unui model intr-un numar mic de desenari.
// Materialele fara textura si fara emisie se "coc" in culori pe varfuri (un singur material comun);
// restul se grupeaza dupa material. Mai putine draw call-uri = armate mari fluide pe telefon.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const vcMaterials = new Map<string, THREE.MeshStandardMaterial>();
function vertexColorMaterial(key: string): THREE.MeshStandardMaterial {
  let m = vcMaterials.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }); vcMaterials.set(key, m); }
  return m;
}

/** copie in float32, neindexata, doar position / normal / uv (atributele cuantizate nu suporta transformari) */
function floatGeometry(src: THREE.BufferGeometry, keepUv: boolean): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  const out = new THREE.BufferGeometry();
  const names: [string, number][] = [['position', 3], ['normal', 3]];
  if (keepUv && g.getAttribute('uv')) names.push(['uv', 2]);
  if (g.getAttribute('color')) names.push(['color', 3]);
  for (const [n, size] of names) {
    const a = g.getAttribute(n);
    if (!a) continue;
    const arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) {
      arr[i * size] = a.getX(i);
      arr[i * size + 1] = a.getY(i);
      if (size === 3) arr[i * size + 2] = a.getZ(i);
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  g.dispose();
  return out;
}

function flipWinding(g: THREE.BufferGeometry): void {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const size = a.itemSize;
    const arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < size; k++) {
        const i1 = (t + 1) * size + k, i2 = (t + 2) * size + k;
        const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp;
      }
    }
  }
}

function bakeable(m: THREE.Material): m is THREE.MeshStandardMaterial {
  const s = m as THREE.MeshStandardMaterial;
  return !!s.isMeshStandardMaterial && !s.map && !s.transparent && (s.emissiveIntensity <= 0.05 || s.emissive.getHex() === 0);
}

/**
 * Fuzioneaza `meshes` in `container` (geometria ajunge in spatiul local al lui container).
 * `container.matrixWorld` trebuie sa fie la zi. Returneaza mesh-urile noi.
 */
export function mergeMeshes(container: THREE.Object3D, meshes: THREE.Mesh[], tag: string): THREE.Mesh[] {
  const inv = new THREE.Matrix4().copy(container.matrixWorld).invert();
  const groups = new Map<string, { geos: THREE.BufferGeometry[]; mat: THREE.Material | null; vc: boolean }>();
  const m4 = new THREE.Matrix4();
  for (const mesh of meshes) {
    if (Array.isArray(mesh.material) || (mesh as THREE.SkinnedMesh).isSkinnedMesh) continue;
    const mat = mesh.material as THREE.Material;
    const vc = bakeable(mat);
    const g = floatGeometry(mesh.geometry, !vc);
    mesh.updateWorldMatrix(true, false);
    m4.multiplyMatrices(inv, mesh.matrixWorld);
    g.applyMatrix4(m4);
    if (m4.determinant() < 0) flipWinding(g);
    if (vc) {
      const c = (mat as THREE.MeshStandardMaterial).color;
      const n = g.getAttribute('position').count;
      const old = g.getAttribute('color');   // culori pe varfuri din model: se inmultesc cu culoarea materialului
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const k = old ? old.getX(i) : 1, k1 = old ? old.getY(i) : 1, k2 = old ? old.getZ(i) : 1;
        col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k1; col[i * 3 + 2] = c.b * k2;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const key = vc ? 'vc' : mat.uuid;
    let grp = groups.get(key);
    if (!grp) { grp = { geos: [], mat: vc ? null : mat, vc }; groups.set(key, grp); }
    grp.geos.push(g);
    mesh.parent?.remove(mesh);
  }
  const out: THREE.Mesh[] = [];
  for (const grp of groups.values()) {
    const merged = mergeGeometries(grp.geos, false);
    for (const g of grp.geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, grp.vc ? vertexColorMaterial(tag) : grp.mat!);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'merged';
    container.add(mesh);
    out.push(mesh);
  }
  return out;
}
