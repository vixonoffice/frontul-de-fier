// UI-in-world: cerc de selectie, bare de viata, fantoma de plasare, pulsuri de ordin.
// Billboard-urile folosesc o rotatie FIXA (camera are yaw/pitch constante, doar zoom-ul variaza),
// deci nu trebuie recalculata orientarea spre camera in fiecare cadru.
import * as THREE from 'three';
import type { EntityId, Team, BuildingType } from '../sim/types';
import type { Ghost } from './api';
import { cameraDirConstant } from './camera';
import { MODEL_FACTORY, TEAM_COLORS } from './models';

function billboardQuat(): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), cameraDirConstant());
}
function flatQuat(): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
}

export interface EntitySyncEntry {
  id: EntityId;
  x: number; y: number; z: number; // pozitie lume (z = inaltime deasupra)
  radius: number;
  hp: number; maxHp: number;
  team: Team;
  selected: boolean;
}

class RingPool {
  private readonly items: THREE.Mesh[] = [];
  private used = 0;
  constructor(private readonly group: THREE.Group, private readonly max: number) {
    const geo = new THREE.RingGeometry(0.85, 1, 28);
    geo.applyQuaternion(flatQuat());
    for (let i = 0; i < max; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 5;
      group.add(mesh);
      this.items.push(mesh);
    }
  }
  reset(): void { this.used = 0; }
  next(): THREE.Mesh | null {
    if (this.used >= this.max) return null;
    return this.items[this.used++];
  }
  hideRest(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
  dispose(): void {
    for (const m of this.items) { (m.material as THREE.Material).dispose(); this.group.remove(m); }
    this.items[0]?.geometry.dispose();
  }
}

class HealthBarPool {
  private readonly items: { group: THREE.Group; fill: THREE.Mesh; fillMat: THREE.MeshBasicMaterial }[] = [];
  private used = 0;
  constructor(private readonly group: THREE.Group, private readonly max: number) {
    const bq = billboardQuat();
    for (let i = 0; i < max; i++) {
      const g = new THREE.Group();
      g.quaternion.copy(bq);
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.12), new THREE.MeshBasicMaterial({ color: 0x0a0a08, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
      g.add(bg);
      const fillMat = new THREE.MeshBasicMaterial({ color: 0x7bd88f, depthWrite: false, toneMapped: false });
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.1), fillMat);
      fill.position.z = 0.001;
      g.add(fill);
      g.visible = false;
      g.renderOrder = 6;
      group.add(g);
      this.items.push({ group: g, fill, fillMat });
    }
  }
  reset(): void { this.used = 0; }
  next(): { group: THREE.Group; fill: THREE.Mesh; fillMat: THREE.MeshBasicMaterial } | null {
    if (this.used >= this.max) return null;
    return this.items[this.used++];
  }
  hideRest(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].group.visible = false;
  }
  dispose(): void {
    for (const it of this.items) {
      it.group.traverse((c) => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); } });
      this.group.remove(it.group);
    }
  }
}

interface PulseSlot { mesh: THREE.Mesh; life: number; maxLife: number }

export class UILayer {
  readonly group = new THREE.Group();
  private readonly selectionRings: RingPool;
  private readonly healthBars: HealthBarPool;
  private readonly pulses: PulseSlot[] = [];
  private ghostObj: THREE.Group | null = null;
  private ghostType: BuildingType | null = null;
  private ghostFootprint: THREE.Mesh | null = null;

  constructor() {
    this.group.name = 'ui3d';
    this.selectionRings = new RingPool(this.group, 48);
    this.healthBars = new HealthBarPool(this.group, 64);
    const pulseGeo = new THREE.RingGeometry(0.4, 0.6, 24);
    pulseGeo.applyQuaternion(flatQuat());
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x7bd88f, transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
      const mesh = new THREE.Mesh(pulseGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.pulses.push({ mesh, life: 0, maxLife: 0.6 });
    }
  }

  sync(entries: EntitySyncEntry[], time: number): void {
    this.selectionRings.reset();
    this.healthBars.reset();
    const pulse = 1 + Math.sin(time * 4) * 0.06;
    for (const e of entries) {
      const damaged = e.hp < e.maxHp;
      if (e.selected) {
        const ring = this.selectionRings.next();
        if (ring) {
          ring.visible = true;
          ring.position.set(e.x, e.z + 0.03, e.y);
          ring.scale.setScalar(e.radius * pulse);
          (ring.material as THREE.MeshBasicMaterial).color.setHex(TEAM_COLORS[e.team]);
        }
      }
      if (e.selected || damaged) {
        const bar = this.healthBars.next();
        if (bar) {
          bar.group.visible = true;
          bar.group.position.set(e.x, e.z + e.radius + 0.9, e.y);
          bar.group.scale.setScalar(Math.max(0.8, e.radius * 0.9));
          const frac = Math.max(0, e.hp / e.maxHp);
          bar.fill.scale.x = Math.max(0.02, frac);
          bar.fill.position.x = -(1 - frac) / 2;
          const color = frac > 0.5 ? 0x7bd88f : frac > 0.25 ? 0xe0ad3a : 0xff5a4a;
          bar.fillMat.color.setHex(color);
        }
      }
    }
    this.selectionRings.hideRest();
    this.healthBars.hideRest();
  }

  pulseAt(x: number, y: number, z: number, kind: 'move' | 'attack'): void {
    const slot = this.pulses.reduce((a, b) => (a.life < b.life ? a : b));
    slot.mesh.position.set(x, z + 0.04, y);
    slot.mesh.scale.setScalar(1);
    slot.life = slot.maxLife;
    slot.mesh.visible = true;
    (slot.mesh.material as THREE.MeshBasicMaterial).color.setHex(kind === 'move' ? 0x7bd88f : 0xff5a4a);
  }

  setGhost(ghost: Ghost | null, team: Team, heightAt: (x: number, y: number) => number): void {
    if (!ghost) {
      if (this.ghostObj) this.ghostObj.visible = false;
      if (this.ghostFootprint) this.ghostFootprint.visible = false;
      return;
    }
    if (this.ghostType !== ghost.type) {
      if (this.ghostObj) { this.group.remove(this.ghostObj); this.disposeGhostModel(this.ghostObj); }
      const model = MODEL_FACTORY[ghost.type](team);
      model.traverse((c) => {
        if (c instanceof THREE.Mesh) {
          const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false, toneMapped: false });
          c.material = m;
          c.castShadow = false; c.receiveShadow = false;
        }
      });
      this.ghostObj = model;
      this.ghostType = ghost.type;
      this.group.add(model);
      if (!this.ghostFootprint) {
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.applyQuaternion(flatQuat());
        const mat = new THREE.MeshBasicMaterial({ color: 0x7bd88f, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
        this.ghostFootprint = new THREE.Mesh(geo, mat);
        this.group.add(this.ghostFootprint);
      }
    }
    const fp = this.sizeFor(ghost.type);
    const cx = ghost.tx + fp.w / 2, cy = ghost.ty + fp.h / 2;
    const hv = heightAt(cx, cy);
    if (this.ghostObj) {
      this.ghostObj.visible = true;
      this.ghostObj.position.set(cx, hv, cy);
      this.tintGhost(this.ghostObj, ghost.valid);
    }
    if (this.ghostFootprint) {
      this.ghostFootprint.visible = true;
      this.ghostFootprint.position.set(cx, hv + 0.02, cy);
      this.ghostFootprint.scale.set(fp.w, fp.h, 1);
      (this.ghostFootprint.material as THREE.MeshBasicMaterial).color.setHex(ghost.valid ? 0x7bd88f : 0xff5a4a);
    }
  }

  private sizeFor(type: BuildingType): { w: number; h: number } {
    return type === 'turret' ? { w: 1, h: 1 } : { w: 3, h: 3 };
  }

  private tintGhost(obj: THREE.Group, valid: boolean): void {
    const color = valid ? 0x7bd88f : 0xff5a4a;
    obj.traverse((c) => {
      if (c instanceof THREE.Mesh) (c.material as THREE.MeshBasicMaterial).color.setHex(color);
    });
  }

  private disposeGhostModel(obj: THREE.Group): void {
    obj.traverse((c) => { if (c instanceof THREE.Mesh) { c.geometry.dispose(); (c.material as THREE.Material).dispose(); } });
  }

  update(dt: number): void {
    for (const slot of this.pulses) {
      if (slot.life <= 0) { slot.mesh.visible = false; continue; }
      slot.life -= dt;
      const t = 1 - slot.life / slot.maxLife;
      slot.mesh.scale.setScalar(1 + t * 3);
      (slot.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - t)) * 0.9;
      if (slot.life <= 0) slot.mesh.visible = false;
    }
  }

  dispose(): void {
    this.selectionRings.dispose();
    this.healthBars.dispose();
    if (this.ghostObj) this.disposeGhostModel(this.ghostObj);
    if (this.ghostFootprint) { this.ghostFootprint.geometry.dispose(); (this.ghostFootprint.material as THREE.Material).dispose(); }
    for (const p of this.pulses) { (p.mesh.material as THREE.Material).dispose(); }
    this.pulses[0]?.mesh.geometry.dispose();
  }
}
