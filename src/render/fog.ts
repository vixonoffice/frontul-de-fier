// Suprapunere de ceata de razboi: un plan peste teren, texturat cu fog[team],
// cu filtrare liniara ca marginile sa fie moi (DataTexture LinearFilter).
import * as THREE from 'three';
import type { MapData } from '../sim/types';
import { RELIEF_SCALE } from './terrain';

export class FogOverlay {
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly data: Uint8Array;

  constructor(map: MapData) {
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
    const positions = new Float32Array([0, 0, 0, map.w, 0, 0, 0, 0, map.h, map.w, 0, map.h]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
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
          float f = texture2D(fogTex, vUv).r; // 0=nevazut 0.5=vazut 1=vizibil (normalizat la citire)
          float unseenA = 0.94;
          float seenA = 0.5;
          float a = mix(unseenA, mix(seenA, 0.0, clamp((f-0.5)*2.0,0.0,1.0)), clamp(f*2.0,0.0,1.0));
          vec3 unseenC = vec3(0.01,0.01,0.015);
          vec3 seenC = vec3(0.09,0.095,0.08);
          vec3 c = mix(unseenC, seenC, clamp(f*2.0,0.0,1.0));
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = RELIEF_SCALE + 0.08;
    this.mesh.renderOrder = 10;
  }

  /** actualizeaza textura din fog[localTeam] (0 nevazut / 1 vazut / 2 vizibil) */
  update(fogTeam: Uint8Array): void {
    for (let i = 0; i < this.data.length; i++) {
      const v = fogTeam[i] ?? 0;
      this.data[i] = v === 0 ? 0 : v === 1 ? 128 : 255;
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
