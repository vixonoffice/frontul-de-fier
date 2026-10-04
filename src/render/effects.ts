// Sistem de efecte: flash-uri, trasoare, fum, praf, scantei, explozii, resturi,
// urme de senile si arsuri pe teren, shake de camera. Totul pe pool-uri instantiate,
// fara alocari in hot-path (arrays tipizate, ring-buffer de sloturi).
import * as THREE from 'three';

function softTexture(dark: boolean): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (dark) {
    grad.addColorStop(0, 'rgba(10,10,10,0.9)');
    grad.addColorStop(0.6, 'rgba(10,10,10,0.5)');
    grad.addColorStop(1, 'rgba(10,10,10,0)');
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export type BillboardMode = 'billboard' | 'decal';

interface PoolOpts {
  mode: BillboardMode;
  blending: THREE.Blending;
  texture: THREE.Texture;
  gravity?: number;
}

/** pool generic de particule instantiate: billboard (vertical, spre camera) sau decal (plat pe teren) */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly yaw: Float32Array;
  private readonly color: Float32Array;
  private cursor = 0;
  private readonly gravity: number;
  private readonly billboardQuat: THREE.Quaternion;
  private readonly flatQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
  private readonly mode: BillboardMode;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly colAttr: THREE.InstancedBufferAttribute;

  constructor(maxCount: number, opts: PoolOpts, camDir: THREE.Vector3) {
    this.n = maxCount;
    this.mode = opts.mode;
    this.gravity = opts.gravity ?? 0;
    this.billboardQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), camDir.clone().normalize());
    this.px = new Float32Array(maxCount);
    this.py = new Float32Array(maxCount);
    this.pz = new Float32Array(maxCount);
    this.vx = new Float32Array(maxCount);
    this.vy = new Float32Array(maxCount);
    this.vz = new Float32Array(maxCount);
    this.life = new Float32Array(maxCount);
    this.maxLife = new Float32Array(maxCount);
    this.size0 = new Float32Array(maxCount);
    this.size1 = new Float32Array(maxCount);
    this.yaw = new Float32Array(maxCount);
    this.color = new Float32Array(maxCount * 3);

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: opts.texture,
      transparent: true,
      depthWrite: false,
      blending: opts.blending,
      toneMapped: opts.blending !== THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    this.mesh.frustumCulled = false;
    this.colAttr = new THREE.InstancedBufferAttribute(this.color, 3);
    this.mesh.instanceColor = this.colAttr;
    for (let i = 0; i < maxCount; i++) {
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(x: number, y: number, z: number, opt: {
    vx?: number; vy?: number; vz?: number; life: number; size0: number; size1?: number;
    color?: THREE.ColorRepresentation; yaw?: number;
  }): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = opt.vx ?? 0; this.vy[i] = opt.vy ?? 0; this.vz[i] = opt.vz ?? 0;
    this.life[i] = opt.life; this.maxLife[i] = opt.life;
    this.size0[i] = opt.size0; this.size1[i] = opt.size1 ?? opt.size0;
    this.yaw[i] = opt.yaw ?? Math.random() * Math.PI * 2;
    const c = new THREE.Color(opt.color ?? 0xffffff);
    this.color[i * 3] = c.r; this.color[i * 3 + 1] = c.g; this.color[i * 3 + 2] = c.b;
    this.colAttr.needsUpdate = true;
  }

  get activeCount(): number {
    return this.n;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      this.vy[i] -= this.gravity * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.mode === 'decal' && this.py[i] < 0.02) this.py[i] = 0.02;
      const t = 1 - this.life[i] / this.maxLife[i];
      let sz = THREE.MathUtils.lerp(this.size0[i], this.size1[i], t);
      const endFade = Math.min(1, this.life[i] / (this.maxLife[i] * 0.25));
      sz *= endFade;
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      if (this.mode === 'billboard') {
        this.q.copy(this.billboardQuat);
      } else {
        this.q.copy(this.flatQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.yaw[i]));
      }
      this.s.set(sz, sz, sz);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/** resturi (debris) cu gravitatie si rotatie, pentru explozii */
class DebrisPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  private readonly px: Float32Array; private readonly py: Float32Array; private readonly pz: Float32Array;
  private readonly vx: Float32Array; private readonly vy: Float32Array; private readonly vz: Float32Array;
  private readonly rx: Float32Array; private readonly ry: Float32Array; private readonly rz: Float32Array;
  private readonly wx: Float32Array; private readonly wy: Float32Array; private readonly wz: Float32Array;
  private readonly life: Float32Array; private readonly maxLife: Float32Array; private readonly scale: Float32Array;
  private cursor = 0;
  private readonly m = new THREE.Matrix4(); private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(); private readonly p = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor(maxCount: number) {
    this.n = maxCount;
    this.px = new Float32Array(maxCount); this.py = new Float32Array(maxCount); this.pz = new Float32Array(maxCount);
    this.vx = new Float32Array(maxCount); this.vy = new Float32Array(maxCount); this.vz = new Float32Array(maxCount);
    this.rx = new Float32Array(maxCount); this.ry = new Float32Array(maxCount); this.rz = new Float32Array(maxCount);
    this.wx = new Float32Array(maxCount); this.wy = new Float32Array(maxCount); this.wz = new Float32Array(maxCount);
    this.life = new Float32Array(maxCount); this.maxLife = new Float32Array(maxCount); this.scale = new Float32Array(maxCount);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2822, roughness: 0.9, metalness: 0.2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    for (let i = 0; i < maxCount; i++) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  spawn(x: number, y: number, z: number, speed: number, scale: number, life: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    const ang = Math.random() * Math.PI * 2;
    const up = 0.5 + Math.random() * 0.8;
    this.vx[i] = Math.cos(ang) * speed * (0.4 + Math.random() * 0.6);
    this.vz[i] = Math.sin(ang) * speed * (0.4 + Math.random() * 0.6);
    this.vy[i] = speed * up;
    this.rx[i] = Math.random() * Math.PI; this.ry[i] = Math.random() * Math.PI; this.rz[i] = Math.random() * Math.PI;
    this.wx[i] = (Math.random() - 0.5) * 10; this.wy[i] = (Math.random() - 0.5) * 10; this.wz[i] = (Math.random() - 0.5) * 10;
    this.life[i] = life; this.maxLife[i] = life; this.scale[i] = scale;
  }

  update(dt: number): void {
    let any = false;
    const g = 9;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      this.vy[i] -= g * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) { this.py[i] = 0.05; this.vy[i] *= -0.3; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
      this.rx[i] += this.wx[i] * dt; this.ry[i] += this.wy[i] * dt; this.rz[i] += this.wz[i] * dt;
      const fade = Math.min(1, this.life[i] / (this.maxLife[i] * 0.4));
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      this.e.set(this.rx[i], this.ry[i], this.rz[i]);
      this.q.setFromEuler(this.e);
      const sc = this.scale[i] * fade;
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

class ShakeState {
  time = 0;
  duration = 0;
  magnitude = 0;
  trigger(magnitude: number, duration: number): void {
    if (magnitude < this.magnitude) return;
    this.magnitude = magnitude;
    this.duration = duration;
    this.time = duration;
  }
  update(dt: number): void {
    if (this.time > 0) this.time = Math.max(0, this.time - dt);
    if (this.time <= 0) this.magnitude = 0;
  }
  offset(out: THREE.Vector3): void {
    if (this.time <= 0) { out.set(0, 0, 0); return; }
    const k = (this.time / this.duration) * this.magnitude;
    out.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k * 0.6, (Math.random() - 0.5) * k);
  }
}

export class EffectsSystem {
  readonly group = new THREE.Group();
  private readonly flash: ParticlePool;
  private readonly spark: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly fire: ParticlePool;
  private readonly dust: ParticlePool;
  private readonly trail: ParticlePool;
  private readonly scorch: ParticlePool;
  private readonly track: ParticlePool;
  private readonly debris: DebrisPool;
  private readonly lights: { light: THREE.PointLight; life: number }[] = [];
  private readonly shake = new ShakeState();
  private readonly tracerGeo: THREE.BufferGeometry;
  private readonly tracerPos: Float32Array;
  private readonly tracerLife: Float32Array;
  private readonly tracerMax = 48;
  private tracerCursor = 0;
  readonly tracerMesh: THREE.LineSegments;

  constructor(camDir: THREE.Vector3) {
    this.group.name = 'effects';
    const glow = softTexture(false);
    const dark = softTexture(true);
    this.flash = new ParticlePool(24, { mode: 'billboard', blending: THREE.AdditiveBlending, texture: glow }, camDir);
    this.spark = new ParticlePool(80, { mode: 'billboard', blending: THREE.AdditiveBlending, texture: glow, gravity: 4 }, camDir);
    this.fire = new ParticlePool(40, { mode: 'billboard', blending: THREE.AdditiveBlending, texture: glow }, camDir);
    this.smoke = new ParticlePool(140, { mode: 'billboard', blending: THREE.NormalBlending, texture: dark, gravity: -1.2 }, camDir);
    this.dust = new ParticlePool(80, { mode: 'billboard', blending: THREE.NormalBlending, texture: dark, gravity: -0.4 }, camDir);
    this.trail = new ParticlePool(90, { mode: 'billboard', blending: THREE.AdditiveBlending, texture: glow }, camDir);
    this.scorch = new ParticlePool(40, { mode: 'decal', blending: THREE.NormalBlending, texture: dark }, camDir);
    this.track = new ParticlePool(220, { mode: 'decal', blending: THREE.NormalBlending, texture: dark }, camDir);
    this.debris = new DebrisPool(60);

    for (const p of [this.flash, this.spark, this.fire, this.smoke, this.dust, this.trail]) this.group.add(p.mesh);
    this.scorch.mesh.renderOrder = 1;
    this.track.mesh.renderOrder = 1;
    this.group.add(this.scorch.mesh, this.track.mesh, this.debris.mesh);

    this.tracerPos = new Float32Array(this.tracerMax * 2 * 3);
    this.tracerLife = new Float32Array(this.tracerMax);
    this.tracerGeo = new THREE.BufferGeometry();
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.9, toneMapped: false });
    this.tracerMesh = new THREE.LineSegments(this.tracerGeo, tracerMat);
    this.tracerMesh.frustumCulled = false;
    this.group.add(this.tracerMesh);

    for (let i = 0; i < 8; i++) {
      const light = new THREE.PointLight(0xffb24a, 0, 6, 2);
      this.group.add(light);
      this.lights.push({ light, life: 0 });
    }
  }

  muzzleFlash(x: number, y: number, z: number, weapon: 'shell' | 'rocket' | 'bullet'): void {
    if (weapon === 'bullet') {
      this.flash.spawn(x, y, z, { life: 0.06, size0: 0.28, size1: 0.05, color: 0xffe9a8 });
      return;
    }
    const color = weapon === 'shell' ? 0xffd38a : 0xffac5a;
    this.flash.spawn(x, y, z, { life: 0.09, size0: 0.9, size1: 0.1, color });
    this.spark.spawn(x, y, z, { life: 0.25, size0: 0.15, size1: 0.02, color: 0xffe3a0, vx: (Math.random() - 0.5) * 2, vy: 1.5, vz: (Math.random() - 0.5) * 2 });
    const slot = this.lights[Math.floor(Math.random() * this.lights.length)];
    slot.light.position.set(x, y + 0.2, z);
    slot.light.intensity = 6;
    slot.life = 0.08;
  }

  tracer(fromX: number, fromY: number, fromZ: number, toX: number, toY: number, toZ: number, life = 0.12): void {
    const i = this.tracerCursor;
    this.tracerCursor = (this.tracerCursor + 1) % this.tracerMax;
    const o = i * 6;
    this.tracerPos[o] = fromX; this.tracerPos[o + 1] = fromY; this.tracerPos[o + 2] = fromZ;
    this.tracerPos[o + 3] = toX; this.tracerPos[o + 4] = toY; this.tracerPos[o + 5] = toZ;
    this.tracerLife[i] = life;
    this.tracerGeo.attributes.position.needsUpdate = true;
  }

  /** scantei minuscule la impactul unui glont */
  bulletSpark(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i++) {
      const ang = Math.random() * Math.PI * 2;
      this.spark.spawn(x, y, z, {
        life: 0.14 + Math.random() * 0.08, size0: 0.07, size1: 0.01, color: 0xffe6a0,
        vx: Math.cos(ang) * 1.4, vy: 0.9 + Math.random() * 0.6, vz: Math.sin(ang) * 1.4,
      });
    }
    this.dust.spawn(x, y, z, { life: 0.3, size0: 0.08, size1: 0.2, color: 0x9c9470, vy: 0.2 });
  }

  /** dara de condens / fum subtire in spatele avionului */
  contrail(x: number, y: number, z: number): void {
    this.trail.spawn(x, y, z, { life: 0.7, size0: 0.16, size1: 0.5, color: 0x9fb4c8, vy: 0.04 });
  }

  /** explozie mare de bomba: bila de foc, coloana de fum, unda de soc si zguduire de camera */
  bombBlast(x: number, y: number, z: number, cameraDistance: number): void {
    this.explosion(x, y, z, 1.9, cameraDistance);
    this.flash.spawn(x, y + 0.5, z, { life: 0.18, size0: 4.2, size1: 1.2, color: 0xfff2c0 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.fire.spawn(x + Math.cos(a) * 0.7, y + 0.3, z + Math.sin(a) * 0.7, {
        life: 0.5, size0: 1.0, size1: 0.3, color: 0xff7a2a, vx: Math.cos(a) * 1.6, vy: 1.2, vz: Math.sin(a) * 1.6,
      });
    }
    for (let i = 0; i < 2; i++) {
      this.smoke.spawn(x, y + 0.6 + i * 0.5, z, { life: 1.4, size0: 0.7, size1: 1.9, color: 0x2a2825, vy: 1.0 + Math.random() * 0.5 });
    }
    this.spawnShockwave(x, y, z, 2.8);
    this.shake.trigger(Math.min(0.9, 0.5 + 2 / Math.max(4, cameraDistance * 0.2)), 0.55);
  }

  /** unitate avansata in grad: coloana scurta de scantei aurii in sus + sclipire */
  promoteFlash(x: number, y: number, z: number, rank: number): void {
    this.flash.spawn(x, y + 0.5, z, { life: 0.35, size0: 0.4, size1: 1.7, color: 0xffd84a });
    const n = rank >= 2 ? 9 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spark.spawn(x + Math.cos(a) * 0.25, y + 0.2, z + Math.sin(a) * 0.25, {
        life: 0.7, size0: 0.14, size1: 0.03, color: 0xffd84a, vx: Math.cos(a) * 0.3, vy: 3.2 + (i % 3) * 0.6, vz: Math.sin(a) * 0.3,
      });
    }
    for (let i = 0; i < 4; i++) this.trail.spawn(x, y + 0.3 + i * 0.35, z, { life: 0.55, size0: 0.32, size1: 0.1, color: 0xffcf3a, vy: 1.6 });
  }

  /** reparatie in curs: scantei mici verzi/albe care urca */
  repairSpark(x: number, y: number, z: number): void {
    const green = Math.random() < 0.6;
    this.spark.spawn(x, y, z, {
      life: 0.7, size0: 0.11, size1: 0.02, color: green ? 0x6dff9a : 0xe8fff0,
      vx: (Math.random() - 0.5) * 0.4, vy: 1.6 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.4,
    });
  }

  /** infanterist strivit: nor de praf si urma turtita */
  crushPuff(x: number, y: number, z: number): void {
    for (let i = 0; i < 4; i++) {
      this.dust.spawn(x + (Math.random() - 0.5) * 0.3, y + 0.05, z + (Math.random() - 0.5) * 0.3, {
        life: 0.6, size0: 0.15, size1: 0.55, color: 0xa89c78, vy: 0.3, vx: (Math.random() - 0.5) * 0.8, vz: (Math.random() - 0.5) * 0.8,
      });
    }
    this.track.spawn(x, y + 0.012, z, { life: 7, size0: 0.5, size1: 0.5, color: 0x2a1c14 });
  }

  /** abur la turnurile de racire */
  steam(x: number, y: number, z: number): void {
    this.trail.spawn(x, y, z, { life: 1.4, size0: 0.3, size1: 0.9, color: 0xcfd9e2, vy: 0.55, vx: 0.08 });
  }

  /** foc la cladiri sub 25% viata */
  fireBurst(x: number, y: number, z: number): void {
    this.fire.spawn(x, y, z, { life: 0.3, size0: 0.4, size1: 0.1, color: 0xff7a2a, vy: 0.7 });
  }

  smokeTrail(x: number, y: number, z: number): void {
    this.smoke.spawn(x, y, z, { life: 0.8, size0: 0.25, size1: 0.6, color: 0xcfcac0, vy: 0.3 });
  }

  dustKick(x: number, y: number, z: number): void {
    this.dust.spawn(x, y, z, { life: 0.5, size0: 0.15, size1: 0.45, color: 0x9c9470, vy: 0.2, vx: (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.3 });
  }

  damageSmoke(x: number, y: number, z: number, heavy: boolean): void {
    this.smoke.spawn(x, y, z, { life: 1.2, size0: 0.3, size1: 0.9, color: 0x3a3a38, vy: 0.5 + Math.random() * 0.3 });
    if (heavy) this.fire.spawn(x, y, z, { life: 0.25, size0: 0.35, size1: 0.1, color: 0xff7a2a, vy: 0.4 });
  }

  hit(x: number, y: number, z: number, weapon: 'shell' | 'rocket'): void {
    const n = weapon === 'shell' ? 6 : 10;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      this.spark.spawn(x, y, z, {
        life: 0.22 + Math.random() * 0.15, size0: 0.14, size1: 0.02, color: 0xffd080,
        vx: Math.cos(ang) * 2.2, vy: 1.4 + Math.random(), vz: Math.sin(ang) * 2.2,
      });
    }
    this.smoke.spawn(x, y, z, { life: 0.5, size0: 0.2, size1: 0.45, color: 0x565248, vy: 0.4 });
  }

  explosion(x: number, y: number, z: number, size: number, cameraDistance: number): void {
    this.fire.spawn(x, y + size * 0.2, z, { life: 0.35, size0: size * 1.6, size1: size * 0.3, color: 0xffb24a });
    this.fire.spawn(x, y + size * 0.1, z, { life: 0.22, size0: size * 0.9, size1: size * 1.8, color: 0xfff0b0 });
    for (let i = 0; i < 4; i++) {
      this.smoke.spawn(x, y + size * 0.1, z, {
        life: 1.4 + Math.random(), size0: size * 0.6, size1: size * 2.4, color: 0x2e2c28,
        vy: 0.6 + Math.random() * 0.4, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6,
      });
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * size * 0.5;
      this.fire.spawn(x + Math.cos(a) * d, y + size * 0.15 + Math.random() * size * 0.3, z + Math.sin(a) * d, {
        life: 0.35 + Math.random() * 0.4, size0: size * (0.5 + Math.random() * 0.5), size1: size * 0.15,
        color: i % 2 ? 0xff8a2a : 0xffc24a, vy: 0.8 + Math.random() * 0.8,
      });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, v = 2.5 + Math.random() * 3;
      this.spark.spawn(x, y + 0.2, z, { life: 0.4 + Math.random() * 0.35, size0: 0.16, size1: 0.02, color: 0xffe0a0, vx: Math.cos(a) * v, vy: 2 + Math.random() * 2.5, vz: Math.sin(a) * v });
    }
    const debrisN = Math.round(5 + size * 4);
    for (let i = 0; i < debrisN; i++) this.debris.spawn(x, y + 0.1, z, 2.5 + size * 1.5, 0.08 + Math.random() * 0.14 * size, 1.6 + Math.random());
    this.scorch.spawn(x, 0, z, { life: 14, size0: size * 2.2, size1: size * 2.2, color: 0x0a0a0a });
    // unda de soc: inel individual (rar, mesh propriu)
    this.spawnShockwave(x, y, z, size);
    const shakeMag = Math.min(0.55, (size * 1.6) / Math.max(4, cameraDistance * 0.3));
    this.shake.trigger(shakeMag, 0.35 + size * 0.1);
  }

  private shockwaves: { mesh: THREE.Mesh; life: number; maxLife: number; size: number }[] = [];
  private spawnShockwave(x: number, y: number, z: number, size: number): void {
    let slot = this.shockwaves.find((s) => s.life <= 0);
    if (!slot) {
      const geo = new THREE.RingGeometry(0.86, 1, 40);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.4, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      this.group.add(mesh);
      slot = { mesh, life: 0, maxLife: 1, size: 1 };
      this.shockwaves.push(slot);
    }
    slot.mesh.position.set(x, y + 0.05, z);
    slot.mesh.scale.set(0.1, 0.1, 0.1);
    slot.life = slot.maxLife = 0.5;
    slot.size = size;
    slot.mesh.visible = true;
  }

  trackMark(x: number, y: number, z: number, yaw: number): void {
    this.track.spawn(x, y + 0.01, z, { life: 3.5, size0: 0.3, size1: 0.3, color: 0x15130f, yaw });
  }

  cameraShakeOffset(out: THREE.Vector3): void {
    this.shake.offset(out);
  }

  update(dt: number): void {
    this.flash.update(dt); this.spark.update(dt); this.fire.update(dt);
    this.smoke.update(dt); this.dust.update(dt); this.trail.update(dt); this.scorch.update(dt); this.track.update(dt);
    this.debris.update(dt);
    this.shake.update(dt);
    for (const slot of this.lights) {
      if (slot.life > 0) {
        slot.life -= dt;
        slot.light.intensity = Math.max(0, slot.life / 0.08) * 6;
      } else slot.light.intensity = 0;
    }
    for (let i = 0; i < this.tracerLife.length; i++) {
      if (this.tracerLife[i] <= 0) continue;
      this.tracerLife[i] -= dt;
      if (this.tracerLife[i] <= 0) {
        const o = i * 6;
        this.tracerPos[o] = this.tracerPos[o + 3]; this.tracerPos[o + 1] = this.tracerPos[o + 4]; this.tracerPos[o + 2] = this.tracerPos[o + 5];
        this.tracerGeo.attributes.position.needsUpdate = true;
      }
    }
    for (const s of this.shockwaves) {
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.life -= dt;
      const t = 1 - s.life / s.maxLife;
      const r = s.size * (0.4 + t * 1.9);
      s.mesh.scale.set(r, 1, r);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - t) * (1 - t) * 0.4);
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const p of [this.flash, this.spark, this.fire, this.smoke, this.dust, this.trail, this.scorch, this.track]) {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.debris.mesh.geometry.dispose();
    (this.debris.mesh.material as THREE.Material).dispose();
    this.tracerGeo.dispose();
    (this.tracerMesh.material as THREE.Material).dispose();
    for (const s of this.shockwaves) { s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); }
  }
}
