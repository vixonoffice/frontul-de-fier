// Implementarea RenderAPI (contract: ./api.ts). Three.js r186.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import type { World, EntityId, Team, Vec, Unit, Building, BuildingType } from '../sim/types';
import type { RenderAPI, PickResult, Ghost, CreateRenderer } from './api';
import { buildTerrain, type TerrainBuild } from './terrain';
import { FogOverlay } from './fog';
import { CameraRig, cameraDirConstant } from './camera';
import { EffectsSystem } from './effects';
import { UILayer, type EntitySyncEntry } from './uiLayer';
import { MODEL_FACTORY } from './models';

const RISE_TICKS = 60;
const TAU = Math.PI * 2;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return a + d * t;
}
function worldYaw(angle: number): number {
  return Math.PI / 2 - angle;
}

function unitRadius(type: Unit['type']): number {
  if (type === 'harvester') return 0.95;
  if (type === 'rocket') return 0.75;
  return 0.78;
}
function buildingSize(type: BuildingType): { w: number; h: number } {
  return type === 'turret' ? { w: 1, h: 1 } : { w: 3, h: 3 };
}

interface AnimRecord {
  kind: 'unit' | 'building';
  team: Team;
  maxHp: number;
  hp: number;
  radius: number;
  builtTick: number;
  riseHeight: number;
  prevX: number; prevY: number; prevAngle: number; prevTurret: number;
  curX: number; curY: number; curAngle: number; curTurret: number;
  moving: boolean;
  carry: number;
  dustAcc: number;
  trackAcc: number;
  smokeAcc: number;
  visible: boolean;
}

export const createRenderer: CreateRenderer = (canvas: HTMLCanvasElement): RenderAPI => {
  const initialW = canvas.clientWidth || canvas.width || 800;
  const initialH = canvas.clientHeight || canvas.height || 600;
  const narrow = initialW < 820;
  const highDpr = (window.devicePixelRatio || 1) > 1.5;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const bloomEnabled = !(narrow && highDpr) && !coarse;
  let dprCap = coarse ? 1.5 : 2;
  // treapta de calitate: 0 = tot, 1 = fara bloom + umbre mici, 2 = fara umbre, rezolutie redusa
  let quality = coarse ? 1 : 0;
  let frameAvg = 1 / 60;
  let slowFrames = 0;
  let lastDpr = window.devicePixelRatio || 1;
  let lastW = initialW, lastH = initialH;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
  renderer.setSize(initialW, initialH, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e12);
  scene.fog = new THREE.Fog(0x1a2026, 70, 190);

  const camera = new CameraRig(initialW / Math.max(1, initialH));

  const hemi = new THREE.HemisphereLight(0xc4d6e8, 0x6a5c3e, 1.15);
  scene.add(hemi);
  const sunDir = new THREE.Vector3(-0.45, 1, 0.35).normalize();
  const sun = new THREE.DirectionalLight(0xffe4bc, 2.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(narrow || coarse ? 1024 : 2048, narrow || coarse ? 1024 : 2048);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  const sunTarget = new THREE.Object3D();
  scene.add(sunTarget);
  sun.target = sunTarget;
  scene.add(sun);

  let terrain: TerrainBuild | null = null;
  let fogOverlay: FogOverlay | null = null;
  let mapW = 80, mapH = 80;

  const effects = new EffectsSystem(cameraDirConstant());
  scene.add(effects.group);
  const ui = new UILayer();
  scene.add(ui.group);

  const entityLayer = new THREE.Group();
  scene.add(entityLayer);
  const pickLayer = new THREE.Group();
  scene.add(pickLayer);

  const objects = new Map<EntityId, THREE.Object3D>();
  const proxies = new Map<EntityId, THREE.Mesh>();
  const anim = new Map<EntityId, AnimRecord>();
  const pickableNow = new Set<EntityId>();

  let selection = new Set<EntityId>();
  let localTeam: Team = 0;
  let lastTick = -1;
  let clock = 0;

  let composer: EffectComposer | null = null;
  let bloomPass: UnrealBloomPass | null = null;
  if (bloomEnabled) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera.camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(initialW, initialH), 0.38, 0.45, 0.93);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  function heightAt(x: number, y: number): number {
    return terrain ? terrain.heightAt(x, y) : 0;
  }

  function proxyGeometryFor(kind: 'unit' | 'building', type: string): THREE.BufferGeometry {
    if (kind === 'unit') return new THREE.BoxGeometry(1.1, 0.9, 1.4);
    const size = buildingSize(type as BuildingType);
    return new THREE.BoxGeometry(size.w, 2, size.h);
  }

  function ensureWorldSetup(world: World): void {
    if (terrain) return;
    mapW = world.map.w; mapH = world.map.h;
    terrain = buildTerrain(world.map);
    scene.add(terrain.group);
    fogOverlay = new FogOverlay(world.map);
    scene.add(fogOverlay.mesh);
    camera.setMapBounds(mapW, mapH);
    let cx = mapW / 2, cy = mapH / 2;
    for (const b of world.buildings.values()) {
      if (b.team === localTeam && b.type === 'hq') { cx = b.tx + 1.5; cy = b.ty + 1.5; }
    }
    camera.centerOn(cx, heightAt(cx, cy), cy);
  }

  function disposeObject3D(obj: THREE.Object3D): void {
    obj.traverse((c) => {
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    });
  }

  function removeEntity(id: EntityId): void {
    const obj = objects.get(id);
    if (obj) { entityLayer.remove(obj); disposeObject3D(obj); objects.delete(id); }
    const proxy = proxies.get(id);
    if (proxy) { pickLayer.remove(proxy); proxy.geometry.dispose(); proxies.delete(id); }
    anim.delete(id);
  }

  function upsertUnit(u: Unit): void {
    let rec = anim.get(u.id);
    if (!rec) {
      const obj = MODEL_FACTORY[u.type](u.team);
      entityLayer.add(obj);
      objects.set(u.id, obj);
      const proxy = new THREE.Mesh(proxyGeometryFor('unit', u.type), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData.entityId = u.id;
      pickLayer.add(proxy);
      proxies.set(u.id, proxy);
      rec = {
        kind: 'unit', team: u.team, maxHp: u.maxHp, hp: u.hp, radius: unitRadius(u.type),
        builtTick: -999999, riseHeight: 0,
        prevX: u.x, prevY: u.y, prevAngle: u.angle, prevTurret: u.turretAngle,
        curX: u.x, curY: u.y, curAngle: u.angle, curTurret: u.turretAngle,
        moving: u.moving, carry: u.carry, dustAcc: Math.random(), trackAcc: Math.random(), smokeAcc: Math.random(), visible: true,
      };
      anim.set(u.id, rec);
    } else {
      rec.prevX = rec.curX; rec.prevY = rec.curY; rec.prevAngle = rec.curAngle; rec.prevTurret = rec.curTurret;
      rec.curX = u.x; rec.curY = u.y; rec.curAngle = u.angle; rec.curTurret = u.turretAngle;
    }
    rec.hp = u.hp;
    rec.maxHp = u.maxHp;
    rec.moving = u.moving;
    rec.carry = u.carry;
  }

  function upsertBuilding(b: Building): void {
    let rec = anim.get(b.id);
    const size = buildingSize(b.type);
    const cx = b.tx + size.w / 2, cy = b.ty + size.h / 2;
    if (!rec) {
      const obj = MODEL_FACTORY[b.type](b.team);
      entityLayer.add(obj);
      objects.set(b.id, obj);
      const proxy = new THREE.Mesh(proxyGeometryFor('building', b.type), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData.entityId = b.id;
      pickLayer.add(proxy);
      proxies.set(b.id, proxy);
      const riseHeight = (obj.userData.riseHeight as number | undefined) ?? 2;
      rec = {
        kind: 'building', team: b.team, maxHp: b.maxHp, hp: b.hp, radius: Math.max(size.w, size.h) * 0.62,
        builtTick: b.builtTick, riseHeight,
        prevX: cx, prevY: cy, prevAngle: 0, prevTurret: b.turretAngle,
        curX: cx, curY: cy, curAngle: 0, curTurret: b.turretAngle,
        moving: false, carry: 0, dustAcc: 0, trackAcc: 0, smokeAcc: Math.random(), visible: true,
      };
      anim.set(b.id, rec);
    } else {
      rec.prevTurret = rec.curTurret;
      rec.curTurret = b.turretAngle;
      rec.curX = cx; rec.curY = cy;
    }
    rec.hp = b.hp;
    rec.maxHp = b.maxHp;
  }

  function syncEntities(world: World): void {
    const present = new Set<EntityId>();
    for (const u of world.units.values()) { present.add(u.id); upsertUnit(u); }
    for (const b of world.buildings.values()) { present.add(b.id); upsertBuilding(b); }
    for (const id of Array.from(anim.keys())) {
      if (!present.has(id)) removeEntity(id);
    }
  }

  function processEvents(world: World): void {
    for (const ev of world.events) {
      if (ev.type === 'fire') {
        const mx = ev.x + Math.cos(ev.angle) * 0.85;
        const my = ev.y + Math.sin(ev.angle) * 0.85;
        const h = heightAt(mx, my) + 0.42;
        effects.muzzleFlash(mx, h, my, ev.weapon === 'rocket' ? 'rocket' : 'shell');
        if (ev.weapon === 'shell') {
          effects.tracer(mx, h, my, mx + Math.cos(ev.angle) * 5, h, my + Math.sin(ev.angle) * 5);
        }
      } else if (ev.type === 'hit') {
        effects.hit(ev.x, heightAt(ev.x, ev.y) + 0.3, ev.y, ev.weapon === 'rocket' || ev.weapon === 'bomb' ? 'rocket' : 'shell');
      } else if (ev.type === 'destroyed') {
        effects.explosion(ev.x, heightAt(ev.x, ev.y) + 0.15, ev.y, 0.7 + ev.size * 0.6, camera.distance);
      } else if (ev.type === 'unload') {
        effects.dustKick(ev.x, heightAt(ev.x, ev.y) + 0.1, ev.y);
      }
    }
  }

  function fogValueAt(world: World, x: number, y: number): number {
    const tx = Math.max(0, Math.min(mapW - 1, Math.floor(x)));
    const ty = Math.max(0, Math.min(mapH - 1, Math.floor(y)));
    return world.fog[localTeam]?.[ty * mapW + tx] ?? 2;
  }

  function updateVisuals(world: World, alpha: number, dt: number): void {
    pickableNow.clear();
    for (const [id, rec] of anim) {
      const obj = objects.get(id);
      const proxy = proxies.get(id);
      if (!obj || !proxy) continue;
      const x = THREE.MathUtils.lerp(rec.prevX, rec.curX, alpha);
      const y = THREE.MathUtils.lerp(rec.prevY, rec.curY, alpha);
      const groundY = heightAt(x, y);

      let visible: boolean;
      if (rec.team === localTeam) visible = true;
      else if (rec.kind === 'unit') visible = fogValueAt(world, x, y) >= 2;
      else visible = fogValueAt(world, x, y) >= 1;
      rec.visible = visible;
      obj.visible = visible;
      proxy.visible = false; // proxy e mereu invizibil vizual; serveste doar pick-ului
      if (visible) pickableNow.add(id);

      if (rec.kind === 'unit') {
        const angle = lerpAngle(rec.prevAngle, rec.curAngle, alpha);
        obj.position.set(x, groundY, y);
        obj.rotation.set(0, worldYaw(angle), 0);
        const turretPivot = obj.userData.turret as THREE.Object3D | undefined;
        if (turretPivot) {
          const turretAngle = lerpAngle(rec.prevTurret, rec.curTurret, alpha);
          turretPivot.rotation.y = angle - turretAngle;
        }
        const hopper = obj.userData.hopper as THREE.Mesh | undefined;
        if (hopper) {
          const base = (obj.userData.hopperBaseY as number) ?? 0.37;
          const fill = Math.max(0, Math.min(1, rec.carry / 300));
          const h = 0.08 + fill * 0.42;
          hopper.visible = fill > 0.02;
          hopper.scale.y = Math.max(0.05, h / 0.1);
          hopper.position.y = base + h / 2;
        }
        if (visible && rec.moving) {
          rec.dustAcc += dt;
          rec.trackAcc += dt;
          if (rec.dustAcc > 0.1) {
            rec.dustAcc = 0;
            const back = angle + Math.PI;
            effects.dustKick(x + Math.cos(back) * 0.6, groundY + 0.08, y + Math.sin(back) * 0.6);
          }
          if (rec.trackAcc > 0.16) {
            rec.trackAcc = 0;
            const perp = angle + Math.PI / 2;
            for (const side of [-1, 1]) {
              effects.trackMark(x + Math.cos(perp) * 0.4 * side, groundY, y + Math.sin(perp) * 0.4 * side, worldYaw(angle));
            }
          }
        }
      } else {
        const t = Math.max(0, Math.min(1, (world.tick - (rec.builtTick - RISE_TICKS)) / RISE_TICKS));
        obj.position.set(x, groundY - (1 - t) * rec.riseHeight, y);
        obj.rotation.set(0, 0, 0);
        const turretPivot = obj.userData.turret as THREE.Object3D | undefined;
        if (turretPivot) {
          const turretAngle = lerpAngle(rec.prevTurret, rec.curTurret, alpha);
          turretPivot.rotation.y = worldYaw(turretAngle);
        }
        const dish = obj.userData.dish as THREE.Object3D | undefined;
        if (dish) dish.rotation.y = clock * 0.6;
        const blink = obj.userData.blinkLight as THREE.Mesh | undefined;
        if (blink) {
          const mat = blink.material as THREE.MeshStandardMaterial;
          mat.emissiveIntensity = Math.sin(clock * 3) > 0.6 ? 2.2 : 0.1;
        }
        const bay = obj.userData.bayDoor as THREE.Object3D | undefined;
        if (bay) bay.rotation.x = -0.3 + Math.sin(clock * 0.5) * 0.3;
      }
      proxy.position.copy(obj.position);

      if (visible && rec.maxHp > 0 && rec.hp < rec.maxHp * 0.5) {
        rec.smokeAcc += dt;
        const thresh = rec.hp < rec.maxHp * 0.25 ? 0.18 : 0.4;
        if (rec.smokeAcc > thresh) {
          rec.smokeAcc = 0;
          effects.damageSmoke(obj.position.x, obj.position.y + rec.radius * 0.8, obj.position.z, rec.hp < rec.maxHp * 0.25);
        }
      }
    }
  }

  function buildSyncEntries(): EntitySyncEntry[] {
    const out: EntitySyncEntry[] = [];
    for (const [id, rec] of anim) {
      if (!rec.visible) continue;
      const obj = objects.get(id);
      if (!obj) continue;
      out.push({
        id, x: obj.position.x, y: obj.position.z, z: obj.position.y,
        radius: rec.radius, hp: rec.hp, maxHp: rec.maxHp, team: rec.team, selected: selection.has(id),
      });
    }
    return out;
  }

  function updateSunAndShadow(): void {
    const t = camera.target;
    sun.position.set(t.x + sunDir.x * 30, t.y + sunDir.y * 30, t.z + sunDir.z * 30);
    sunTarget.position.copy(t);
    const half = Math.max(10, camera.distance * 1.3);
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1; cam.far = 90;
    cam.updateProjectionMatrix();
  }

  function applyQuality(): void {
    if (quality >= 2) {
      sun.castShadow = false;
      renderer.shadowMap.enabled = false;
      scene.traverse((o) => { if (o instanceof THREE.Mesh && o.material) (o.material as THREE.Material).needsUpdate = true; });
      dprCap = 1;
    } else if (quality === 1) {
      dprCap = Math.min(dprCap, 1.5);
    }
    renderer.setPixelRatio(Math.min(lastDpr, dprCap));
    renderer.setSize(lastW, lastH, false);
    composer?.setSize(lastW, lastH);
  }

  function watchFrameRate(dtSeconds: number): void {
    if (quality >= 2 || dtSeconds <= 0 || dtSeconds >= 0.1) return;
    frameAvg += (dtSeconds - frameAvg) * 0.05;
    slowFrames = frameAvg > 1 / 40 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
    if (slowFrames > 90) {
      quality += 1;
      slowFrames = 0;
      frameAvg = 1 / 60;
      applyQuality();
    }
  }

  function render(world: World, alpha: number, dtSeconds: number): void {
    ensureWorldSetup(world);
    watchFrameRate(dtSeconds);
    clock += dtSeconds;
    if (world.tick !== lastTick) {
      syncEntities(world);
      processEvents(world);
      lastTick = world.tick;
    }
    if (fogOverlay) fogOverlay.update(world.fog[localTeam] ?? new Uint8Array(mapW * mapH), dtSeconds);
    updateVisuals(world, alpha, dtSeconds);
    terrain?.update(clock);
    effects.update(dtSeconds);
    ui.update(dtSeconds);
    camera.update(dtSeconds);
    updateSunAndShadow();
    const shakeOffset = new THREE.Vector3();
    effects.cameraShakeOffset(shakeOffset);
    camera.camera.position.add(shakeOffset);
    ui.sync(buildSyncEntries(), clock);

    if (composer && quality === 0) composer.render();
    else renderer.render(scene, camera.camera);
  }

  function resize(width: number, height: number, dpr: number): void {
    lastDpr = dpr; lastW = width; lastH = height;
    renderer.setPixelRatio(Math.min(dpr, dprCap));
    renderer.setSize(width, height, false);
    camera.resize(width, height);
    composer?.setSize(width, height);
    bloomPass?.setSize(width, height);
  }

  function pick(screenX: number, screenY: number): PickResult {
    const ray = camera.raycastFromScreen(screenX, screenY);
    let entityId: EntityId | null = null;
    if (pickLayer.children.length > 0) {
      const hits = ray.intersectObjects(pickLayer.children, false);
      for (const h of hits) {
        const id = h.object.userData.entityId as EntityId | undefined;
        if (id !== undefined && pickableNow.has(id)) { entityId = id; break; }
      }
    }
    let world: Vec | null = null;
    if (terrain) {
      const hits = ray.intersectObject(terrain.group.children[0], false);
      if (hits.length > 0) world = { x: hits[0].point.x, y: hits[0].point.z };
      else {
        const g = camera.raycastGround(screenX, screenY);
        if (g) world = { x: g.x, y: g.z };
      }
    }
    return { world, entityId };
  }

  function pickBox(x0: number, y0: number, x1: number, y1: number, team: Team): EntityId[] {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const out: EntityId[] = [];
    for (const [id, rec] of anim) {
      if (rec.team !== team || !rec.visible) continue;
      const obj = objects.get(id);
      if (!obj) continue;
      const s = camera.worldToScreen(obj.position);
      if (!s) continue;
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) out.push(id);
    }
    return out;
  }

  function worldToScreen(p: Vec): Vec | null {
    const y = heightAt(p.x, p.y);
    const s = camera.worldToScreen(new THREE.Vector3(p.x, y, p.y));
    return s ? { x: s.x, y: s.y } : null;
  }

  const api: RenderAPI = {
    render,
    resize,
    pick,
    pickBox,
    worldToScreen,
    panBy(dx: number, dy: number): void { camera.panBy(dx, dy); },
    zoomBy(factor: number, sx: number, sy: number): void { camera.zoomBy(factor, sx, sy); },
    centerOn(p: Vec): void { camera.centerOn(p.x, heightAt(p.x, p.y), p.y); },
    viewQuad(): Vec[] { return camera.viewQuad().map((v) => ({ x: v.x, y: v.z })); },
    setLocalTeam(team: Team): void { localTeam = team; },
    setSelection(ids: EntityId[]): void { selection = new Set(ids); },
    setGhost(ghost: Ghost | null): void { ui.setGhost(ghost, localTeam, heightAt); },
    pulse(p: Vec, kind: 'move' | 'attack'): void { ui.pulseAt(p.x, heightAt(p.x, p.y), p.y, kind); },
    dispose(): void {
      for (const id of Array.from(anim.keys())) removeEntity(id);
      terrain?.dispose();
      fogOverlay?.dispose();
      effects.dispose();
      ui.dispose();
      composer?.dispose();
      renderer.dispose();
    },
  };
  return api;
};

export default createRenderer;
