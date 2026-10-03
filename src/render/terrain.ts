// Teren: mesh de relief cu vertex colors, roci instantiate, apa cu shader simplu,
// minereu instantiat (scalat cu cantitatea ramasa), iarba/pietre decorative instantiate.
import * as THREE from 'three';
import { TERRAIN_ROCK, TERRAIN_WATER, type MapData } from '../sim/types';
import { createRock, rockMaterial, ROCK_TINTS, oreCrystalGeometries, oreMaterial, grassGeometry, grassMaterial } from './models';

export const RELIEF_SCALE = 1.4;
// paleta calma de stepa uscata — variatie pe suprafete mari, nu zgomot tile-cu-tile
const GROUND_COOL = 0x6b6a45;
const GROUND_WARM = 0x8b7d55;
const GROUND_DRY = 0x8f8a5c;
const GROUND_SOIL = 0x585340;
const GROUND_BASE = 0x7d7650;
const ROCK_GROUND = 0x5a564b;

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** zgomot lin, pe mai multe tile-uri deodata (nu sare de la un tile la altul) */
function smoothNoise(x: number, y: number, freq: number, phase: number): number {
  const n =
    Math.sin(x * freq + phase) * 0.5 + Math.sin(y * freq * 1.3 - phase * 0.7) * 0.5 +
    Math.sin((x + y) * freq * 0.6 + phase * 1.6) * 0.4;
  return Math.max(0, Math.min(1, n * 0.33 + 0.5));
}

function softGlowTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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

      // culoare = media tile-urilor adiacente, pe baza unui zgomot lin (pete mari, nu sare-si-piper)
      let r = 0, g = 0, b = 0, n = 0;
      for (const [tx, ty] of [[vx - 1, vy - 1], [vx, vy - 1], [vx - 1, vy], [vx, vy]] as const) {
        const cx = Math.max(0, Math.min(w - 1, tx));
        const cy = Math.max(0, Math.min(h - 1, ty));
        const t = terrain[cy * w + cx];
        const base = new THREE.Color(GROUND_COOL).lerp(new THREE.Color(GROUND_WARM), smoothNoise(cx, cy, 0.07, 0));
        base.lerp(new THREE.Color(GROUND_BASE), 0.35);
        const dryT = smoothNoise(cx, cy, 0.05, 11.3);
        if (dryT > 0.68) base.lerp(new THREE.Color(GROUND_DRY), (dryT - 0.68) / 0.32);
        const soilT = smoothNoise(cx, cy, 0.045, 27.1);
        if (soilT < 0.26) base.lerp(new THREE.Color(GROUND_SOIL), (0.26 - soilT) / 0.26);
        let c = base;
        if (t === TERRAIN_ROCK) c = new THREE.Color(ROCK_GROUND);
        else if (t === TERRAIN_WATER) c = new THREE.Color(GROUND_COOL);
        col.copy(c);
        r += col.r; g += col.g; b += col.b; n++;
      }
      // zgomot fin per-vertex, foarte usor — rupe aspectul de plastic neted
      const jitter = 0.94 + hash2(vx, vy) * 0.12;
      colors[i * 3 + 0] = (r / n) * jitter;
      colors[i * 3 + 1] = (g / n) * jitter;
      colors[i * 3 + 2] = (b / n) * jitter;
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
    const rockColors = new Float32Array(rockPositions.length * 3);
    rockMesh.instanceColor = new THREE.InstancedBufferAttribute(rockColors, 3);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const tintA = new THREE.Color();
    const tintB = new THREE.Color();
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
      tintA.setHex(ROCK_TINTS[i % ROCK_TINTS.length]);
      tintB.setHex(ROCK_TINTS[(i + 1) % ROCK_TINTS.length]);
      tintA.lerp(tintB, hash2(x + 5, y + 5));
      rockColors[i * 3] = tintA.r; rockColors[i * 3 + 1] = tintA.g; rockColors[i * 3 + 2] = tintA.b;
    }
    rockMesh.instanceMatrix.needsUpdate = true;
    rockMesh.instanceColor.needsUpdate = true;
    group.add(rockMesh);
  }

  // --- minereu instantiat: ciorchine de cristale alungite + glow pe sol ---
  const oreTiles: { x: number; y: number; idx: number; count: number }[] = [];
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const idx = ty * w + tx;
      if (ore[idx] > 0) oreTiles.push({ x: tx, y: ty, idx, count: 3 + Math.floor(hash2(tx, ty) * 4) }); // 3..6
    }
  }
  const ORE_PER_TILE_MAX = 6;
  const crystalGeos = oreCrystalGeometries();
  // geometrie combinata (merge) ca sa putem avea 3 forme diferite intr-un singur InstancedMesh e complicat;
  // folosim un InstancedMesh per forma, fiecare cu propriul subset de sloturi.
  const oreMeshes: THREE.InstancedMesh[] = crystalGeos.map(
    (geo) => new THREE.InstancedMesh(geo, oreMaterial(), oreTiles.length * ORE_PER_TILE_MAX),
  );
  for (const om of oreMeshes) { om.castShadow = true; group.add(om); }

  let oreGlowMesh: THREE.InstancedMesh | null = null;
  const glowTex = oreTiles.length > 0 ? softGlowTexture() : null;
  if (oreTiles.length > 0 && glowTex) {
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex, color: 0xf0b13a, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    oreGlowMesh = new THREE.InstancedMesh(glowGeo, glowMat, oreTiles.length);
    oreGlowMesh.renderOrder = 1;
    const gm = new THREE.Matrix4();
    const gp = new THREE.Vector3();
    const gq = new THREE.Quaternion();
    const gs = new THREE.Vector3();
    for (let i = 0; i < oreTiles.length; i++) {
      const t = oreTiles[i];
      const hv = tileH(t.x, t.y) * RELIEF_SCALE;
      gp.set(t.x + 0.5, hv + 0.03, t.y + 0.5);
      gs.set(2.6, 2.6, 2.6);
      gm.compose(gp, gq, gs);
      oreGlowMesh.setMatrixAt(i, gm);
    }
    oreGlowMesh.instanceMatrix.needsUpdate = true;
    group.add(oreGlowMesh);
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
  // doua culori (olive / khaki) in doua batch-uri instantiate separate
  const grassSpotsA = grassSpots.filter((_, i) => hash2(grassSpots[i].x, grassSpots[i].y + i) < 0.5);
  const grassSpotsB = grassSpots.filter((_, i) => hash2(grassSpots[i].x, grassSpots[i].y + i) >= 0.5);
  const grassMeshes: THREE.InstancedMesh[] = [];
  for (const [spots, variant] of [[grassSpotsA, 0], [grassSpotsB, 1]] as const) {
    if (spots.length === 0) continue;
    const gmesh = new THREE.InstancedMesh(grassGeo, grassMaterial(variant), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < spots.length; i++) {
      const { x, y } = spots[i];
      const jx = x + hash2(x, y + i * 3);
      const jy = y + hash2(x + i * 5, y);
      const hv = tileH(x, y) * RELIEF_SCALE;
      const scale = 0.55 + hash2(x + i, y + i) * 0.6;
      p.set(jx, hv, jy);
      q.setFromEuler(new THREE.Euler(0, hash2(x * 2, y * 2 + i) * Math.PI * 2, 0));
      s.set(scale, scale, scale);
      m.compose(p, q, s);
      gmesh.setMatrixAt(i, m);
    }
    gmesh.instanceMatrix.needsUpdate = true;
    group.add(gmesh);
    grassMeshes.push(gmesh);
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
    if (oreMeshes.length > 0) {
      const shimmer = 1 + Math.sin(time * 2) * 0.08;
      const insts = oreMeshes.map(() => 0);
      for (const tile of oreTiles) {
        const amount = ore[tile.idx];
        if (amount <= 0) continue;
        const frac = Math.min(1, amount / 400);
        const count = Math.max(2, Math.round(frac * tile.count));
        for (let i = 0; i < count; i++) {
          const variant = i % oreMeshes.length;
          const jx = tile.x + 0.25 + hash2(tile.x, tile.y + i) * 0.5;
          const jy = tile.y + 0.25 + hash2(tile.x + i, tile.y) * 0.5;
          const hv = tileH(tile.x, tile.y) * RELIEF_SCALE;
          const scale = (0.6 + frac * 0.7) * shimmer;
          pV.set(jx, hv, jy);
          // inclinare statica per instanta (nu se roteste pe X/Z — doar o usoara rotatie Y continua)
          const tiltX = (hash2(tile.x + i, tile.y) - 0.5) * 0.7;
          const tiltZ = (hash2(tile.x, tile.y + i * 2) - 0.5) * 0.7;
          const spin = time * 0.15 + hash2(tile.x, tile.y) * Math.PI * 2;
          qI.setFromEuler(new THREE.Euler(tiltX, spin, tiltZ));
          sV.set(scale, scale, scale);
          mtx.compose(pV, qI, sV);
          const mesh = oreMeshes[variant];
          mesh.setMatrixAt(insts[variant], mtx);
          insts[variant]++;
        }
      }
      oreMeshes.forEach((mesh, vi) => {
        mesh.count = insts[vi];
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
  };
  update(0);

  const dispose = (): void => {
    groundGeo.dispose();
    groundMat.dispose();
    rockGeo.dispose();
    grassGeo.dispose();
    waterMat?.dispose();
    glowTex?.dispose();
  };

  return { group, heightAt: bilinear, update, dispose };
}
