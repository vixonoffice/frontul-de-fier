// Camera RTS: perspectiva, FOV mic, inclinata ~55 grade, un mic yaw fix (stil izometric).
// Pan si zoom cu easing; zoom spre cursor; pan limitat la marginile hartii.
import * as THREE from 'three';

const FOV_DEG = 32;
const PITCH = THREE.MathUtils.degToRad(55);
const YAW = THREE.MathUtils.degToRad(28);
const EASE = 10; // viteza de interpolare (mai mare = mai rapid)

/** directia camera<-target; fixa (doar distanta variaza), folosita si pentru billboard-uri. */
export function cameraDirConstant(): THREE.Vector3 {
  const x = Math.sin(YAW) * Math.cos(PITCH);
  const z = Math.cos(YAW) * Math.cos(PITCH);
  const y = Math.sin(PITCH);
  return new THREE.Vector3(x, y, z).normalize();
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();
  readonly desiredTarget = new THREE.Vector3();
  distance = 30;
  desiredDistance = 30;
  minDistance = 8;
  maxDistance = 48;
  private mapW = 80;
  private mapH = 80;
  private viewW = 1;
  private viewH = 1;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, aspect, 0.5, 220);
    this.applyImmediate();
  }

  setMapBounds(w: number, h: number): void {
    this.mapW = w;
    this.mapH = h;
  }

  resize(width: number, height: number): void {
    this.viewW = width;
    this.viewH = height;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private dir(): THREE.Vector3 {
    return cameraDirConstant();
  }

  private clampTarget(t: THREE.Vector3): void {
    const margin = this.distance * 0.25;
    t.x = THREE.MathUtils.clamp(t.x, -margin, this.mapW + margin);
    t.z = THREE.MathUtils.clamp(t.z, -margin, this.mapH + margin);
  }

  private applyImmediate(): void {
    this.target.copy(this.desiredTarget);
    this.distance = this.desiredDistance;
    const d = this.dir().multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(d);
    this.camera.lookAt(this.target);
  }

  centerOn(x: number, y: number, z: number): void {
    this.desiredTarget.set(x, y, z);
    this.clampTarget(this.desiredTarget);
    this.applyImmediate();
  }

  panBy(dxPixels: number, dyPixels: number): void {
    // pan in planul orizontal, relativ la orientarea camerei (doar componenta pe orizontala)
    const speed = (this.distance / this.viewH) * 1.6;
    const fwd = new THREE.Vector3(Math.sin(YAW), 0, Math.cos(YAW)).normalize();
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    this.desiredTarget.addScaledVector(right, dxPixels * speed);
    this.desiredTarget.addScaledVector(fwd, dyPixels * speed);
    this.clampTarget(this.desiredTarget);
  }

  zoomBy(factor: number, screenX: number, screenY: number): void {
    const before = this.desiredDistance;
    this.desiredDistance = THREE.MathUtils.clamp(this.desiredDistance / factor, this.minDistance, this.maxDistance);
    const actualFactor = this.desiredDistance / before;
    // zoom spre cursor: deplaseaza target-ul spre punctul de pe teren de sub cursor
    const groundPoint = this.raycastGround(screenX, screenY);
    if (groundPoint) {
      this.desiredTarget.lerp(groundPoint, 1 - actualFactor);
      this.clampTarget(this.desiredTarget);
    }
  }

  update(dt: number): void {
    const a = 1 - Math.exp(-EASE * dt);
    this.target.lerp(this.desiredTarget, a);
    this.distance = THREE.MathUtils.lerp(this.distance, this.desiredDistance, a);
    const d = this.dir().multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(d);
    this.camera.lookAt(this.target);
  }

  /** raycaster pornit din coordonate de ecran (pixeli, origine stanga-sus) */
  raycastFromScreen(screenX: number, screenY: number): THREE.Raycaster {
    const nx = (screenX / this.viewW) * 2 - 1;
    const ny = -(screenY / this.viewH) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    return this.raycaster;
  }

  raycastGround(screenX: number, screenY: number): THREE.Vector3 | null {
    this.groundPlane.constant = -this.target.y;
    const ray = this.raycastFromScreen(screenX, screenY);
    const out = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(this.groundPlane, out);
    return hit;
  }

  worldToScreen(p: THREE.Vector3): { x: number; y: number } | null {
    const v = p.clone().project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * this.viewW, y: ((1 - v.y) / 2) * this.viewH };
  }

  viewQuad(): THREE.Vector3[] {
    const corners: [number, number][] = [[0, 0], [this.viewW, 0], [this.viewW, this.viewH], [0, this.viewH]];
    return corners.map(([sx, sy]) => this.raycastGround(sx, sy) ?? this.target.clone());
  }
}
