// Proiectile vizibile: bombe care cad, rachete cu dara de fum, obuze (punct luminos).
// Pozitiile vin din world.projectiles la fiecare tick si se interpoleaza intre tick-uri.
import * as THREE from 'three';
import type { Projectile, EntityId } from '../sim/types';
import { AIR_ALTITUDE } from '../data/units';
import type { EffectsSystem } from './effects';

interface Track { px: number; py: number; cx: number; cy: number; seen: number; smokeAcc: number }

const MAX_MESHES = 48;

export class ProjectileLayer {
  readonly group = new THREE.Group();
  private readonly tracks = new Map<EntityId, Track>();
  private readonly bombs: THREE.Object3D[] = [];
  private readonly rockets: THREE.Mesh[] = [];
  private readonly shells: THREE.Mesh[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private current: Projectile[] = [];
  private stamp = 0;

  constructor() {
    this.group.name = 'projectiles';
    // bomba: profil de revolutie, botul in jos
    const prof = [[0, -0.2], [0.05, -0.17], [0.09, -0.08], [0.1, 0.05], [0.07, 0.15], [0.04, 0.2], [0, 0.21]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const bombGeo = new THREE.LatheGeometry(prof, 10);
    const fin = new THREE.BoxGeometry(0.2, 0.1, 0.012);
    fin.translate(0, 0.17, 0);
    const finB = fin.clone();
    finB.rotateY(Math.PI / 2);
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x3b4033, roughness: 0.5, metalness: 0.5 });
    const rocketGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.34, 7);
    rocketGeo.rotateX(Math.PI / 2);
    const rocketMat = new THREE.MeshBasicMaterial({ color: 0xffb060, toneMapped: false });
    const shellGeo = new THREE.SphereGeometry(0.075, 6, 5);
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, toneMapped: false });
    this.geos.push(bombGeo, fin, finB, rocketGeo, shellGeo);
    this.mats.push(bombMat, rocketMat, shellMat);
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bombGeo, bombMat), new THREE.Mesh(fin, bombMat), new THREE.Mesh(finB, bombMat));
      g.scale.setScalar(1.45);
      g.visible = false;
      this.group.add(g);
      this.bombs.push(g);
    }
    for (let i = 0; i < MAX_MESHES / 2; i++) {
      const r = new THREE.Mesh(rocketGeo, rocketMat);
      r.visible = false;
      this.group.add(r);
      this.rockets.push(r);
      const s = new THREE.Mesh(shellGeo, shellMat);
      s.visible = false;
      this.group.add(s);
      this.shells.push(s);
    }
  }

  /** o data pe tick: preia lista curenta de proiectile */
  sync(list: Projectile[]): void {
    this.stamp++;
    this.current = list;
    for (const p of list) {
      let t = this.tracks.get(p.id);
      if (!t) {
        t = { px: p.x, py: p.y, cx: p.x, cy: p.y, seen: this.stamp, smokeAcc: 0 };
        this.tracks.set(p.id, t);
      } else {
        t.px = t.cx; t.py = t.cy; t.cx = p.x; t.cy = p.y; t.seen = this.stamp;
      }
    }
    for (const [id, t] of this.tracks) if (t.seen !== this.stamp) this.tracks.delete(id);
  }

  /** la fiecare cadru */
  update(alpha: number, dt: number, heightAt: (x: number, y: number) => number, effects: EffectsSystem, visible: (x: number, y: number) => boolean): void {
    let nb = 0, nr = 0, ns = 0;
    for (const p of this.current) {
      const t = this.tracks.get(p.id);
      if (!t) continue;
      const x = t.px + (t.cx - t.px) * alpha;
      const y = t.py + (t.cy - t.py) * alpha;
      if (!visible(x, y)) continue;
      const total = Math.hypot(p.tx - p.fromX, p.ty - p.fromY);
      const prog = total < 0.05 ? 1 : Math.min(1, Math.hypot(x - p.fromX, y - p.fromY) / total);
      const gh = heightAt(x, y);
      const dx = t.cx - t.px, dy = t.cy - t.py;
      const yaw = Math.atan2(dx, dy);
      if (p.kind === 'bomb') {
        if (nb >= this.bombs.length) continue;
        const m = this.bombs[nb++];
        const h = 0.15 + (AIR_ALTITUDE - 0.1) * (1 - prog * prog);
        m.position.set(x, gh + h, y);
        m.rotation.set(0, yaw, 0.12);
        m.visible = true;
        t.smokeAcc += dt;
        if (t.smokeAcc > 0.06) { t.smokeAcc = 0; effects.smokeTrail(x, gh + h + 0.25, y); }
      } else if (p.kind === 'rocket') {
        if (nr >= this.rockets.length) continue;
        const m = this.rockets[nr++];
        const h = 0.4 + Math.sin(prog * Math.PI) * 0.35;
        m.position.set(x, gh + h, y);
        m.rotation.set(0, yaw, 0);
        m.visible = true;
        t.smokeAcc += dt;
        if (t.smokeAcc > 0.045) { t.smokeAcc = 0; effects.smokeTrail(x - Math.sin(yaw) * 0.2, gh + h, y - Math.cos(yaw) * 0.2); }
      } else if (p.kind === 'shell') {
        if (ns >= this.shells.length) continue;
        const m = this.shells[ns++];
        m.position.set(x, gh + 0.42 + Math.sin(prog * Math.PI) * 0.15, y);
        m.visible = true;
      }
    }
    for (let i = nb; i < this.bombs.length; i++) this.bombs[i].visible = false;
    for (let i = nr; i < this.rockets.length; i++) this.rockets[i].visible = false;
    for (let i = ns; i < this.shells.length; i++) this.shells[i].visible = false;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}
