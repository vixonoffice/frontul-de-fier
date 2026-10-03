// Teren: mesh de relief cu vertex colors, roci instantiate, apa cu shader simplu,
// minereu instantiat (scalat cu cantitatea ramasa), iarba/pietre decorative instantiate.
import * as THREE from 'three';
import { TERRAIN_ROCK, TERRAIN_WATER, type MapData } from '../sim/types';
import { createRock, rockMaterial, oreCrystalGeometry, oreMaterial, grassGeometry, grassMaterial } from './models';

export const RELIEF_SCALE = 1.4;
const GROUND_VARIANTS = [0x7d7650, 0x6b6a45, 0x8b7d55];
const ROCK_GROUND = 0x5a564b;

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export interface TerrainBuild {
  group: THREE.Group;
  /** inaltime (world Y) la coordonate de tile continue (interpolare biliniara) */
  heightAt(x: number, y: number): number;
  update(time: number): void;
  dispose(): void;
}

export function buildTerrain(map: MapData): TerrainBuild {
  const { w, h, terrain, height, ore } = map;
  const group = new THREE.Group();
  group.name = 'terrain';

  const tileH = (tx: number, ty: number): number => {
    const cx = Math.max(0, Math.min(w - 1, tx));
    const cy = Math.max(0, Math.min(h - 1, ty));
    let hv = height[cy * w + cx];
    if (terrain[cy * w + cx] === TERRAIN_WATER) hv -= 0.35;
    return hv;
  };

  // --- ground: grid de (w+1)x(h+1) varfuri ---
  const gw = w + 1, gh = h + 1;
  const positions = new Float32Array(gw * gh * 3);
  const colors = new Float32Array(gw * gh * 3);
  const cornerHeight = new Float32Array(gw * gh);
  const col = new THREE.Color();
  for (let vy = 0; vy < gh; vy++) {
    for (let vx = 0; vx < gw; vx++) {
      const i = vy * gw + vx;
      const hv = (tileH(vx - 1, vy - 1) + tileH(vx, vy - 1) + tileH(vx - 1, vy) + tileH(vx, vy)) / 4;
      cornerHeight[i] = hv;
      positions[i * 3 + 0] = vx;
      positions[i * 3 + 1] = hv * RELIEF_SCALE;
      positions[i * 3 + 2] = vy;

      // culoare = media tile-urilor adiacente
      let r = 0, g = 0, b = 0, n = 0;
      for (const [tx, ty] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]] as const) {
        const cx = Math.max(0, Math.min(w - 1, tx));
        const cy = Math.max(0, Math.min(h - 1, ty));
        const t = terrain[cy * w + cx];
        let c = GROUND_VARIANTS[Math.floor(hash2(cx, cy) * GROUND_VARIANTS.length) % GROUND_VARIANTS.length];
        if (t === TERRAIN_ROCK) c = ROCK_GROUND;
        else if (t === TERRAIN_WATER) c = GROUND_VARIANTS[1];
        col.setHex(c);
        r += col.r; g += col.g; b += col.b; n++;
      }
      colors[i * 3 + 0] = r / n;
      colors[i * 3 + 1] = g / n;
      colors[i * 3 + 2] = b / n;
    }
  }
  const indices: number[] = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const a = ty * gw + tx, b = a + 1, c = a + gw, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeo.setIndex(indices);
  groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  group.add(groundMesh);

  // --- apa ---
  const waterVerts: number[] = [];
  const waterIdx: number[] = [];
  let wv = 0;
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (terrain[ty * w + tx] !== TERRAIN_WATER) continue;
      const y0 = height[ty * w + tx] * RELIEF_SCALE - 0.15;
      waterVerts.push(tx, y0, ty, tx + 1, y0, ty, tx, y0, ty + 1, tx + 1, y0, ty + 1);
      waterIdx.push(wv, wv + 2, wv + 1, wv + 1, wv + 2, wv + 3);
      wv += 4;
    }
  }
  let waterMat: THREE.ShaderMaterial | null = null;
  if (wv > 0) {
    const waterGeo = new THREE.BufferGeometry();
    waterGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(waterVerts), 3));
    waterGeo.setIndex(waterIdx);
    waterGeo.computeVertexNormals();
    waterMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(0x0c2b33) }, glint: { value: new THREE.Color(0x8fd8d8) } },
      transparent: true,
      vertexShader: `varying vec2 vUv; varying vec3 vWorldPos; void main(){ vUv=position.xz; vWorldPos=(modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform float time; uniform vec3 deep; uniform vec3 glint; varying vec2 vUv; varying vec3 vWorldPos;
        void main(){
          float wave = sin(vUv.x*0.7+time*0.8)*0.5+sin(vUv.y*0.9-time*1.1)*0.5;
          float spec = smoothstep(0.88,1.0, sin(vUv.x*1.3+vUv.y*1.3+time*1.4)*0.5+0.5);
          vec3 c = mix(deep, deep*1.4, wave*0.5+0.5);
          c += glint*spec*0.5;
          gl_FragColor = vec4(c, 0.88);
        }`,
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    group.add(waterMesh);
  }

  // --- roci instantiate ---
  const rockGeo = createRock();
  const rockPositions: { x: number; y: number }[] = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (terrain[ty * w + tx] !== TERRAIN_ROCK) continue;
      const n = 1 + Math.floor(hash2(tx, ty + 99) * 3);
      for (let i = 0; i < n; i++) rockPositions.push({ x: tx, y: ty });
    }
  }
  let rockMesh: THREE.InstancedMesh | null = null;
  if (rockPositions.length > 0) {
    rockMesh = new THREE.InstancedMesh(rockGeo, rockMaterial(), rockPositions.length);
    rockMesh.castShadow = true;
    rockMesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < rockPositions.length; i++) {
      const { x, y } = rockPositions[i];
      const jx = x + 0.2 + hash2(x, y + i) * 0.6;
      const jy = y + 0.2 + hash2(x + i, y) * 0.6;
      const hv = tileH(Math.floor(jx), Math.floor(jy)) * RELIEF_SCALE;
      const scale = 0.5 + hash2(x * 3 + i, y * 7) * 0.9;
      p.set(jx, hv + scale * 0.2, jy);
      q.setFromEuler(new THREE.Euler(0, hash2(x, y) * Math.PI * 2, 0));
      s.set(scale, scale * (0.7 + hash2(y, x) * 0.6), scale);
      m.compose(p, q, s);
      rockMesh.setMatrixAt(i, m);
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    group.add(rockMesh);
  }

  // --- minereu instantiat ---
  const oreTiles: { x: number; y: number; idx: number }[] = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const idx = ty * w + tx;
      if (ore[idx] > 0) oreTiles.push({ x: tx, y: ty, idx });
    }
  }
  const ORE_PER_TILE_MAX = 4;
  const oreMesh = oreTiles.length > 0
    ? new THREE.InstancedMesh(oreCrystalGeometry(), oreMaterial(), oreTiles.length * ORE_PER_TILE_MAX)
    : null;
  if (oreMesh) {
    oreMesh.castShadow = true;
    group.add(oreMesh);
  }

  // --- iarba si pietre decorative ---
  const grassGeo = grassGeometry();
  const grassSpots: { x: number; y: number }[] = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const t = terrain[ty * w + tx];
      if (t !== 0) continue;
      if (hash2(tx + 0.5, ty + 0.5) > 0.4) continue;
      const n = 1 + Math.floor(hash2(tx, ty) * 2);
      for (let i = 0; i < n; i++) grassSpots.push({ x: tx, y: ty });
    }
  }
  let grassMesh: THREE.InstancedMesh | null = null;
  if (grassSpots.length > 0) {
    grassMesh = new THREE.InstancedMesh(grassGeo, grassMaterial(), grassSpots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < grassSpots.length; i++) {
      const { x, y } = grassSpots[i];
      const jx = x + hash2(x, y + i * 3) ;
      const jy = y + hash2(x + i * 5, y);
      const hv = tileH(x, y) * RELIEF_SCALE;
      const scale = 0.6 + hash2(x + i, y + i) * 0.7;
      p.set(jx, hv, jy);
      q.setFromEuler(new THREE.Euler(0, hash2(x * 2, y * 2 + i) * Math.PI * 2, 0));
      s.set(scale, scale, scale);
      m.compose(p, q, s);
      grassMesh.setMatrixAt(i, m);
    }
    grassMesh.instanceMatrix.needsUpdate = true;
    group.add(grassMesh);
  }

  const bilinear = (x: number, y: number): number => {
    const cx = Math.max(0, Math.min(w - 1.001, x));
    const cy = Math.max(0, Math.min(h - 1.001, y));
    const x0 = Math.floor(cx), y0 = Math.floor(cy);
    const fx = cx - x0, fy = cy - y0;
    const h00 = cornerHeight[y0 * gw + x0];
    const h10 = cornerHeight[y0 * gw + x0 + 1];
    const h01 = cornerHeight[(y0 + 1) * gw + x0];
    const h11 = cornerHeight[(y0 + 1) * gw + x0 + 1];
    const a = h00 * (1 - fx) + h10 * fx;
    const b = h01 * (1 - fx) + h11 * fx;
    return (a * (1 - fy) + b * fy) * RELIEF_SCALE;
  };

  const mtx = new THREE.Matrix4();
  const qI = new THREE.Quaternion();
  const sV = new THREE.Vector3();
  const pV = new THREE.Vector3();
  const update = (time: number): void => {
    if (waterMat) waterMat.uniforms.time.value = time;
    if (oreMesh) {
      let inst = 0;
      const shimmer = 1 + Math.sin(time * 2) * 0.08;
      for (const tile of oreTiles) {
        const amount = ore[tile.idx];
        if (amount <= 0) continue;
        const frac = Math.min(1, amount / 400);
        const count = Math.max(1, Math.round(frac * ORE_PER_TILE_MAX));
        for (let i = 0; i < count; i++) {
          const jx = tile.x + 0.25 + hash2(tile.x, tile.y + i) * 0.5;
          const jy = tile.y + 0.25 + hash2(tile.x + i, tile.y) * 0.5;
          const hv = tileH(tile.x, tile.y) * RELIEF_SCALE;
          const scale = (0.5 + frac * 0.8) * shimmer;
          pV.set(jx, hv + 0.15 * scale, jy);
          qI.setFromEuler(new THREE.Euler(time * 0.3 + i, time * 0.5, 0));
          sV.set(scale, scale, scale);
          mtx.compose(pV, qI, sV);
          oreMesh.setMatrixAt(inst, mtx);
          inst++;
        }
      }
      oreMesh.count = inst;
      oreMesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);

  const dispose = (): void => {
    groundGeo.dispose();
    groundMat.dispose();
    rockGeo.dispose();
    grassGeo.dispose();
    waterMat?.dispose();
  };

  return { group, heightAt: bilinear, update, dispose };
}
