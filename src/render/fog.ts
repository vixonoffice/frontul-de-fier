// Suprapunere de ceata de razboi: un plan peste teren, texturat cu fog[team],
// cu filtrare liniara ca marginile sa fie moi (DataTexture LinearFilter).
import * as THREE from 'three';
import type { MapData } from '../sim/types';
import { RELIEF_SCALE } from './terrain';

export class FogOverlay {
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly w: number;
  private readonly h: number;
  private readonly cur: Float32Array;
  private readonly tgt: Float32Array;
  private readonly tmp: Float32Array;
  private primed = false;

  constructor(map: MapData) {
    this.w = map.w; this.h = map.h;
    this.cur = new Float32Array(map.w * map.h);
    this.tgt = new Float32Array(map.w * map.h);
    this.tmp = new Float32Array(map.w * map.h);
    this.data = new Uint8Array(map.w * map.h);
    this.data.fill(0);
    const tex = new THREE.DataTexture(this.data, map.w, map.h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.flipY = false;
    tex.needsUpdate = true;
    this.texture = tex;

    const geo = new THREE.BufferGeometry();
    // planul depaseste harta cu M tile-uri, ca marginea lumii sa se piarda in intuneric
    const M = 60;
    const positions = new Float32Array([-M, 0, -M, map.w + M, 0, -M, -M, 0, map.h + M, map.w + M, 0, map.h + M]);
    const u0 = -M / map.w, u1 = 1 + M / map.w, v0 = -M / map.h, v1 = 1 + M / map.h;
    const uvs = new Float32Array([u0, v0, u1, v0, u0, v1, u1, v1]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    const mat = new THREE.ShaderMaterial({
      uniforms: { fogTex: { value: tex } },
      transparent: true,
      depthWrite: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform sampler2D fogTex; varying vec2 vUv;
        void main(){
          float f = texture2D(fogTex, vUv).r;
          vec2 e = step(vec2(0.0), vUv) * step(vUv, vec2(1.0));
          f *= e.x * e.y; // 0=nevazut 0.5=vazut 1=vizibil (normalizat la citire)
          float unseenA = 0.985;
          float seenA = 0.46;
          float a = mix(unseenA, mix(seenA, 0.0, clamp((f-0.5)*2.0,0.0,1.0)), clamp(f*2.0,0.0,1.0));
          vec3 unseenC = vec3(0.008,0.011,0.016);
          vec3 seenC = vec3(0.03,0.045,0.07);
          vec3 c = mix(unseenC, seenC, clamp(f*2.0,0.0,1.0));
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = RELIEF_SCALE + 0.08;
    this.mesh.renderOrder = 10;
  }

  /** actualizeaza textura din fog[localTeam] (0 nevazut / 1 vazut / 2 vizibil), netezita in spatiu si timp */
  update(fogTeam: Uint8Array, dt = 1): void {
    const { w, h, cur, tgt, tmp } = this;
    for (let i = 0; i < tgt.length; i++) {
      const v = fogTeam[i] ?? 0;
      tgt[i] = v === 0 ? 0 : v === 1 ? 0.5 : 1;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          tmp[i] = (tgt[y * w + Math.max(0, x - 1)] + 2 * tgt[i] + tgt[y * w + Math.min(w - 1, x + 1)]) / 4;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          tgt[i] = (tmp[Math.max(0, y - 1) * w + x] + 2 * tmp[i] + tmp[Math.min(h - 1, y + 1) * w + x]) / 4;
        }
      }
    }
    const a = this.primed ? Math.min(1, dt * 5) : 1;
    this.primed = true;
    for (let i = 0; i < cur.length; i++) {
      cur[i] += (tgt[i] - cur[i]) * a;
      this.data[i] = Math.round(cur[i] * 255);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
