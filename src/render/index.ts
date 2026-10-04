// Implementarea RenderAPI (contract: ./api.ts). Three.js r186.
import { UNITS } from '../data/units';
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
import { MODEL_FACTORY, setLampLevel } from './models';
import { preloadAssets, instantiate, assetsVersion, isReady, sceneryLoaded, damagedMaterial, type Instance, type ModelType } from './assets';
import { ProjectileLayer } from './projectiles';
import { buildScenery, type Scenery } from './scenery';
import { BUILDINGS } from '../data/buildings';

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
  if (type === 'harvester' || type === 'warHarvester') return 0.95;
  if (type === 'rocket') return 0.75;
  if (type === 'soldier' || type === 'bazooka') return 0.42;
  if (type === 'bomber') return 0.95;
  return 0.78;
}
function buildingSize(type: BuildingType): { w: number; h: number } {
  const d = BUILDINGS[type];
  return d ? { w: d.w, h: d.h } : { w: 3, h: 3 };
}

/** caseta de selectie (tile-uri): mai generoasa pe soldati ca sa nimereasca degetul */
function unitPickBox(type: Unit['type']): { w: number; h: number; d: number } {
  switch (type) {
    case 'soldier': case 'bazooka': return { w: 0.75, h: 0.8, d: 0.75 };
    case 'bomber': return { w: 1.7, h: 0.9, d: 1.7 };
    case 'harvester': case 'warHarvester': return { w: 1.1, h: 0.9, d: 1.4 };
    default: return { w: 1.0, h: 0.8, d: 1.3 };
  }
}

interface AnimRecord {
  kind: 'unit' | 'building';
  type: ModelType;
  real: boolean;                 // true = model GLB, false = placeholder procedural
  inst: Instance | null;
  clip: string;                  // animatia curenta (soldati)
  lastFire: number;              // ultimul tick de tragere
  prevAlt: number; curAlt: number;
  bank: number; pitch: number;
  shadow: THREE.Mesh | null;
  contrailAcc: number;
  pickH: number;
  animAcc: number;
  rank: number;
  repairing: boolean;
  dmg: 0 | 1 | 2;                // stare de avarie: 0 intact, 1 sub 50%, 2 sub 25%
  repairFx: THREE.Group | null;
  repairAcc: number;
  steamAcc: number;
  onScreen: boolean;
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
  const projectiles = new ProjectileLayer();
  scene.add(projectiles.group);
  preloadAssets();
  let seenAssets = -1;
  let scenery: Scenery | null = null;

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
    if (kind === 'unit') {
      const b = unitPickBox(type as Unit['type']);
      return new THREE.BoxGeometry(b.w, b.h, b.d);
    }
    const size = buildingSize(type as BuildingType);
    return new THREE.BoxGeometry(size.w, buildingPickHeight(type as BuildingType), size.h);
  }
  function buildingPickHeight(type: BuildingType): number {
    return type === 'turret' || type === 'rocketTurret' ? 1.0 : type === 'barracks' ? 1.8 : 2.2;
  }

  // aglomerare: peste ~70 de unitati pe ecran nu mai proiecteaza umbra fiecare (cost de pasaj de umbre)
  let crowd = false;
  const smallNoShadow = (t: ModelType): boolean => t === 'soldier' || t === 'bazooka' || t === 'bomber';
  function applyUnitShadows(obj: THREE.Object3D, type: ModelType): void {
    const cast = !crowd && !smallNoShadow(type);
    obj.traverse((c) => { if (c instanceof THREE.Mesh && c.name !== 'teamRing') c.castShadow = cast; });
  }

  // stari de avarie: materiale intunecate (clonate o data per material si nivel)
  const damagedOrig = new Map<THREE.Object3D, Map<THREE.Mesh, THREE.Material>>();
  function applyDamageState(rec: AnimRecord, obj: THREE.Object3D): void {
    const frac = rec.maxHp > 0 ? rec.hp / rec.maxHp : 1;
    const st: 0 | 1 | 2 = frac < 0.25 ? 2 : frac < 0.5 ? 1 : 0;
    if (st === rec.dmg) return;
    rec.dmg = st;
    let orig = damagedOrig.get(obj);
    if (!orig) { orig = new Map(); damagedOrig.set(obj, orig); }
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.name === 'teamRing' || Array.isArray(m.material)) return;
      if (!orig!.has(m)) orig!.set(m, m.material as THREE.Material);
      const base = orig!.get(m)!;
      m.material = st === 0 ? base : damagedMaterial(base, st);
    });
  }

  const repairMat = new THREE.MeshBasicMaterial({ color: 0x6dff9a, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  function makeRepairFrame(w: number, h: number): THREE.Group {
    const g = new THREE.Group();
    const t = 0.09;
    const mk = (pw: number, ph: number, x: number, z: number): void => {
      const geo = new THREE.PlaneGeometry(pw, ph);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, repairMat);
      m.position.set(x, 0, z);
      m.renderOrder = 4;
      g.add(m);
    };
    mk(w, t, 0, h / 2 - t / 2); mk(w, t, 0, -h / 2 + t / 2); mk(t, h, w / 2 - t / 2, 0); mk(t, h, -w / 2 + t / 2, 0);
    return g;
  }

  /** model real daca e incarcat, altfel placeholderul procedural */
  function makeObject(type: ModelType, team: Team): { obj: THREE.Group; inst: Instance | null } {
    const inst = instantiate(type, team);
    if (inst) return { obj: inst.obj, inst };
    return { obj: MODEL_FACTORY[type](team), inst: null };
  }

  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);
  let shadowMat: THREE.MeshBasicMaterial | null = null;
  function makeShadowBlob(): THREE.Mesh {
    if (!shadowMat) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    }
    const m = new THREE.Mesh(shadowGeo, shadowMat.clone());
    m.renderOrder = 1;
    return m;
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
      if (c instanceof THREE.Mesh && !c.geometry.userData.shared) c.geometry.dispose();
    });
  }

  function removeEntity(id: EntityId): void {
    const obj = objects.get(id);
    const rec0 = anim.get(id);
    if (obj) {
      entityLayer.remove(obj);
      if (!rec0?.real) disposeObject3D(obj);   // geometria modelelor GLB e partajata, nu se elibereaza
      objects.delete(id);
    }
    if (rec0?.shadow) {
      entityLayer.remove(rec0.shadow);
      (rec0.shadow.material as THREE.Material).dispose();
    }
    rec0?.inst?.mixer?.stopAllAction();
    if (rec0?.repairFx) { entityLayer.remove(rec0.repairFx); rec0.repairFx.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); }); }
    damagedOrig.delete(obj as THREE.Object3D);
    const proxy = proxies.get(id);
    if (proxy) { pickLayer.remove(proxy); proxy.geometry.dispose(); proxies.delete(id); }
    anim.delete(id);
  }

  function upsertUnit(u: Unit): void {
    let rec = anim.get(u.id);
    if (!rec) {
      const made = makeObject(u.type, u.team);
      const obj = made.obj;
      if (crowd) applyUnitShadows(obj, u.type);
      entityLayer.add(obj);
      objects.set(u.id, obj);
      const proxy = new THREE.Mesh(proxyGeometryFor('unit', u.type), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData.entityId = u.id;
      pickLayer.add(proxy);
      proxies.set(u.id, proxy);
      rec = {
        kind: 'unit', type: u.type, real: !!made.inst, inst: made.inst, clip: '', lastFire: u.lastFireTick,
        prevAlt: u.alt, curAlt: u.alt, bank: 0, pitch: 0, shadow: null, contrailAcc: 0, pickH: unitPickBox(u.type).h, animAcc: 0, rank: 0, repairing: false, dmg: 0, repairFx: null, repairAcc: 0, steamAcc: 0, onScreen: true,
        team: u.team, maxHp: u.maxHp, hp: u.hp, radius: unitRadius(u.type),
        builtTick: -999999, riseHeight: 0,
        prevX: u.x, prevY: u.y, prevAngle: u.angle, prevTurret: u.turretAngle,
        curX: u.x, curY: u.y, curAngle: u.angle, curTurret: u.turretAngle,
        moving: u.moving, carry: u.carry, dustAcc: Math.random(), trackAcc: Math.random(), smokeAcc: Math.random(), visible: true,
      };
      anim.set(u.id, rec);
    } else {
      rec.prevX = rec.curX; rec.prevY = rec.curY; rec.prevAngle = rec.curAngle; rec.prevTurret = rec.curTurret;
      rec.curX = u.x; rec.curY = u.y; rec.curAngle = u.angle; rec.curTurret = u.turretAngle;
      rec.prevAlt = rec.curAlt; rec.curAlt = u.alt;
    }
    rec.lastFire = u.lastFireTick;
    rec.rank = u.rank ?? 0;
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
      const made = makeObject(b.type, b.team);
      const obj = made.obj;
      entityLayer.add(obj);
      objects.set(b.id, obj);
      const proxy = new THREE.Mesh(proxyGeometryFor('building', b.type), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData.entityId = b.id;
      pickLayer.add(proxy);
      proxies.set(b.id, proxy);
      const riseHeight = (obj.userData.riseHeight as number | undefined) ?? 2;
      rec = {
        kind: 'building', type: b.type, real: !!made.inst, inst: made.inst, clip: '', lastFire: 0,
        prevAlt: 0, curAlt: 0, bank: 0, pitch: 0, shadow: null, contrailAcc: 0, pickH: buildingPickHeight(b.type), animAcc: 0, rank: 0, repairing: false, dmg: 0, repairFx: null, repairAcc: 0, steamAcc: 0, onScreen: true,
        team: b.team, maxHp: b.maxHp, hp: b.hp, radius: Math.max(size.w, size.h) * 0.62,
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
    rec.repairing = !!b.repairing;
  }

  /** cand un GLB tocmai s-a incarcat: inlocuieste placeholderele de acel tip */
  function upgradePlaceholders(): void {
    for (const [id, rec] of anim) {
      if (rec.real || !isReady(rec.type)) continue;
      const made = makeObject(rec.type, rec.team);
      if (!made.inst) continue;
      const old = objects.get(id);
      if (old) { entityLayer.remove(old); disposeObject3D(old); }
      entityLayer.add(made.obj);
      objects.set(id, made.obj);
      rec.inst = made.inst;
      rec.real = true;
      rec.clip = '';
      rec.dmg = 0;
      damagedOrig.delete(old as THREE.Object3D);
      if (rec.kind === 'unit' && crowd) applyUnitShadows(made.obj, rec.type);
      if (rec.kind === 'building') rec.riseHeight = (made.obj.userData.riseHeight as number | undefined) ?? 2;
    }
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
        if (ev.weapon === 'bomb') continue; // bomba se vede cum cade (ProjectileLayer)
        const src = world.units.get(ev.sourceId);
        const inf = !!src && (src.type === 'soldier' || src.type === 'bazooka');
        const off = inf ? 0.32 : 0.85;
        const mx = ev.x + Math.cos(ev.angle) * off;
        const my = ev.y + Math.sin(ev.angle) * off;
        const h = heightAt(mx, my) + (inf ? 0.36 : 0.42);
        effects.muzzleFlash(mx, h, my, ev.weapon === 'artillery' || ev.weapon === 'tesla' ? 'shell' : ev.weapon);
        if (ev.weapon === 'shell') {
          effects.tracer(mx, h, my, mx + Math.cos(ev.angle) * 5, h, my + Math.sin(ev.angle) * 5);
        } else if (ev.weapon === 'bullet') {
          // tras subtire si rapid, scurt
          effects.tracer(mx, h, my, mx + Math.cos(ev.angle) * 3.2, h, my + Math.sin(ev.angle) * 3.2, 0.06);
        }
      } else if (ev.type === 'hit') {
        const hy = heightAt(ev.x, ev.y);
        if (ev.weapon === 'bomb') effects.bombBlast(ev.x, hy + 0.3, ev.y, camera.distance);
        else if (ev.weapon === 'bullet') effects.bulletSpark(ev.x, hy + 0.25, ev.y);
        else effects.hit(ev.x, hy + 0.3, ev.y, ev.weapon === 'rocket' ? 'rocket' : 'shell');
      } else if (ev.type === 'destroyed') {
        effects.explosion(ev.x, heightAt(ev.x, ev.y) + 0.15, ev.y, 0.7 + ev.size * 0.6, camera.distance);
      } else if (ev.type === 'crushed') {
        effects.crushPuff(ev.x, heightAt(ev.x, ev.y), ev.y);
      } else if (ev.type === 'promoted') {
        effects.promoteFlash(ev.x, heightAt(ev.x, ev.y), ev.y, ev.rank);
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

  /** bombardier: inaltime, inclinare in viraj, umbra pe sol, dara de condens */
  function updateAircraft(rec: AnimRecord, obj: THREE.Object3D, angle: number, x: number, y: number, groundY: number, alt: number, visible: boolean, dt: number): void {
    const tilt = (obj.userData.tilt as THREE.Object3D | undefined) ?? obj.getObjectByName('tilt');
    if (tilt) {
      const dA = lerpAngle(0, rec.curAngle - rec.prevAngle, 1);
      const bankT = THREE.MathUtils.clamp(dA * 8, -0.7, 0.7);
      const pitchT = THREE.MathUtils.clamp((rec.curAlt - rec.prevAlt) * 2.5, -0.35, 0.35);
      const k = Math.min(1, dt * 5);
      rec.bank += (bankT - rec.bank) * k;
      rec.pitch += (pitchT - rec.pitch) * k;
      tilt.rotation.set(-rec.pitch, 0, rec.bank);
    }
    if (!rec.shadow) {
      rec.shadow = makeShadowBlob();
      entityLayer.add(rec.shadow);
    }
    const sh = rec.shadow;
    sh.visible = visible;
    const sx = x + alt * 0.42, sy = y - alt * 0.3;
    sh.position.set(sx, heightAt(sx, sy) + 0.07, sy);
    sh.rotation.y = worldYaw(angle);
    const sc = 1 + alt * 0.05;
    sh.scale.set(1.15 * sc, 1, 1.7 * sc);
    (sh.material as THREE.MeshBasicMaterial).opacity = 0.65 * THREE.MathUtils.clamp(1 - alt / 9, 0.45, 1);
    if (visible && alt > 1) {
      rec.contrailAcc += dt;
      if (rec.contrailAcc > 0.045) {
        rec.contrailAcc = 0;
        effects.contrail(x - Math.cos(angle) * 0.75, groundY + alt + 0.02, y - Math.sin(angle) * 0.75);
      }
    }
  }

  let frameNo = 0;
  const frustum = new THREE.Frustum();
  const frustumMat = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  let frustumReady = false;
  const pickList: THREE.Object3D[] = [];
  let unitsOnScreen = 0;
  /** soldati: animatie scheletica (idle / alergare / tras); fara model real, doar un mic salt la mers */
  function updateInfantry(id: EntityId, rec: AnimRecord, obj: THREE.Object3D, world: World, dt: number): void {
    const inst = rec.inst;
    const firing = world.tick - rec.lastFire < 7;
    if (inst && inst.mixer && inst.clips) {
      const want = rec.moving ? (firing ? 'Run_Shoot' : 'Run') : (firing ? 'Idle_Gun_Shoot' : 'Idle_Gun');
      if (want !== rec.clip) {
        const next = inst.clips[want];
        if (next) {
          const prev = rec.clip ? inst.clips[rec.clip] : undefined;
          next.reset().fadeIn(0.15).play();
          if (!prev) next.time = (id * 0.37) % Math.max(0.1, next.getClip().duration);
          prev?.fadeOut(0.15);
          rec.clip = want;
        }
      }
      rec.animAcc += dt;
      // mixerul se actualizeaza rar pentru soldatii departe de camera si la fiecare al doilea cadru pe calitate redusa
      const dx = obj.position.x - camera.target.x, dz = obj.position.z - camera.target.z;
      const far = dx * dx + dz * dz > 18 * 18;
      const step = far ? 4 : quality === 0 ? 1 : 2;
      if (step === 1 || ((frameNo + id) % step) === 0) {
        inst.mixer.update(rec.animAcc);
        rec.animAcc = 0;
      }
    } else if (rec.moving) {
      obj.position.y += Math.abs(Math.sin(clock * 11 + id)) * 0.05;
    }
  }

  function updateVisuals(world: World, alpha: number, dt: number): void {
    frameNo++;
    pickableNow.clear();
    pickList.length = 0;
    unitsOnScreen = 0;
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
      // in afara ecranului (cu margine) nu se deseneaza si nu se anima: cost redus la armate mari
      const flying = rec.type === 'bomber';
      sphere.center.set(x, groundY + (flying ? 3.2 : 0.4), y);
      sphere.radius = rec.radius + 2.2 + (flying ? 3.5 : 0);
      const onScreen = visible && frustumReady && frustum.intersectsSphere(sphere) || (visible && !frustumReady);
      rec.onScreen = onScreen;
      obj.visible = onScreen;
      if (rec.shadow) rec.shadow.visible = onScreen;
      proxy.visible = false; // proxy e mereu invizibil vizual; serveste doar pick-ului
      if (visible) pickableNow.add(id);
      if (onScreen) { pickList.push(proxy); if (rec.kind === 'unit') unitsOnScreen++; }

      if (rec.kind === 'unit') {
        const angle = lerpAngle(rec.prevAngle, rec.curAngle, alpha);
        const alt = rec.type === 'bomber' ? THREE.MathUtils.lerp(rec.prevAlt, rec.curAlt, alpha) : 0;
        obj.position.set(x, groundY + alt, y);
        obj.rotation.set(0, worldYaw(angle), 0);
        if (rec.type === 'bomber') updateAircraft(rec, obj, angle, x, y, groundY, alt, visible, dt);
        else if ((rec.type === 'soldier' || rec.type === 'bazooka') && onScreen) updateInfantry(id, rec, obj, world, dt);
        const turretPivot = obj.userData.turret as THREE.Object3D | undefined;
        if (turretPivot) {
          const turretAngle = lerpAngle(rec.prevTurret, rec.curTurret, alpha);
          turretPivot.rotation.y = angle - turretAngle;
        }
        const hopper = obj.userData.hopper as THREE.Mesh | undefined;
        if (hopper) {
          const base = (obj.userData.hopperBaseY as number) ?? 0.37;
          const fill = Math.max(0, Math.min(1, rec.carry / UNITS.harvester.cargoCap));
          const h = 0.08 + fill * 0.42;
          hopper.visible = fill > 0.02;
          hopper.scale.y = Math.max(0.05, h / 0.1);
          hopper.position.y = base + h / 2;
        }
        if (onScreen && rec.moving && (rec.type === 'tank' || rec.type === 'rocket' || rec.type === 'harvester' || rec.type === 'warHarvester')) {
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
      proxy.position.set(obj.position.x, obj.position.y + (rec.type === 'bomber' ? 0 : rec.pickH / 2), obj.position.z);

      applyDamageState(rec, obj);
      if (onScreen && rec.maxHp > 0 && rec.hp < rec.maxHp * 0.5) {
        rec.smokeAcc += dt;
        const crit = rec.hp < rec.maxHp * 0.25;
        if (rec.smokeAcc > (crit ? 0.09 : 0.25)) {
          rec.smokeAcc = 0;
          const spread = rec.kind === 'building' ? rec.radius * 0.5 : 0.12;
          const ox = (Math.random() - 0.5) * 2 * spread, oz = (Math.random() - 0.5) * 2 * spread;
          effects.damageSmoke(obj.position.x + ox, obj.position.y + rec.radius * 0.8, obj.position.z + oz, crit);
          if (crit && rec.kind === 'building') effects.fireBurst(obj.position.x - oz, obj.position.y + rec.radius * 0.5, obj.position.z + ox);
        }
      }
      if (rec.kind === 'building') {
        if (rec.repairing && visible) {
          const sz = buildingSize(rec.type as BuildingType);
          if (!rec.repairFx) { rec.repairFx = makeRepairFrame(sz.w + 0.1, sz.h + 0.1); entityLayer.add(rec.repairFx); }
          rec.repairFx.position.set(x, groundY + 0.09, y);
          rec.repairFx.visible = onScreen;
          if (onScreen) {
            rec.repairAcc += dt;
            if (rec.repairAcc > 0.07) {
              rec.repairAcc = 0;
              effects.repairSpark(x + (Math.random() - 0.5) * sz.w * 0.9, groundY + 0.15 + Math.random() * 0.4, y + (Math.random() - 0.5) * sz.h * 0.9);
            }
          }
        } else if (rec.repairFx) {
          entityLayer.remove(rec.repairFx);
          rec.repairFx.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); });
          rec.repairFx = null;
        }
        const steam = obj.userData.steam as [number, number, number][] | undefined;
        if (steam && onScreen && t01(world, rec) >= 1) {
          rec.steamAcc += dt;
          if (rec.steamAcc > 0.3) {
            rec.steamAcc = 0;
            for (const sp of steam) effects.steam(obj.position.x + sp[0], obj.position.y + sp[1], obj.position.z + sp[2]);
          }
        }
      }
    }
    repairMat.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(clock * 6));
    // aglomerare: cu peste 70 de unitati pe ecran umbrele lor se opresc (revin sub 50)
    const wantCrowd = crowd ? unitsOnScreen > 50 : unitsOnScreen > 70;
    if (wantCrowd !== crowd) {
      crowd = wantCrowd;
      for (const [id, rec] of anim) if (rec.kind === 'unit') { const o = objects.get(id); if (o) applyUnitShadows(o, rec.type); }
    }
  }

  /** 0..1 cat de construita e cladirea (pentru efecte care incep dupa ce s-a ridicat) */
  function t01(world: World, rec: AnimRecord): number {
    return Math.max(0, Math.min(1, (world.tick - (rec.builtTick - RISE_TICKS)) / RISE_TICKS));
  }

  function buildSyncEntries(): EntitySyncEntry[] {
    const out: EntitySyncEntry[] = [];
    for (const [id, rec] of anim) {
      if (!rec.visible || !rec.onScreen) continue;
      const obj = objects.get(id);
      if (!obj) continue;
      out.push({
        id, x: obj.position.x, y: obj.position.z, z: obj.position.y,
        radius: rec.radius, hp: rec.hp, maxHp: rec.maxHp, team: rec.team, selected: selection.has(id), rank: rec.kind === 'unit' ? rec.rank : 0,
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
    if (assetsVersion !== seenAssets) {
      seenAssets = assetsVersion;
      upgradePlaceholders();
      if (!scenery && terrain && sceneryLoaded()) {
        scenery = buildScenery(world.map, heightAt);
        if (scenery) {
          scene.add(scenery.group);
          const proc = terrain.group.getObjectByName('rocks');   // stancile procedurale cedeaza locul celor GLB
          if (proc) proc.visible = false;
        }
      }
    }
    if (world.tick !== lastTick) {
      syncEntities(world);
      projectiles.sync(world.projectiles);
      processEvents(world);
      lastTick = world.tick;
    }
    if (fogOverlay) fogOverlay.update(world.fog[localTeam] ?? new Uint8Array(mapW * mapH), dtSeconds);
    camera.camera.updateMatrixWorld();
    frustumMat.multiplyMatrices(camera.camera.projectionMatrix, camera.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(frustumMat);
    frustumReady = true;
    // lipsa de curent: luminile cladirilor proprii se estompeaza si palpaie
    const pw = world.players[localTeam]?.power;
    let lamp = 1;
    if (pw && pw.used > pw.made) lamp = 0.1 + (Math.sin(clock * 19) * Math.sin(clock * 7.3) > 0.15 ? 0.5 : 0);
    setLampLevel(localTeam, lamp);
    updateVisuals(world, alpha, dtSeconds);
    projectiles.update(alpha, dtSeconds, heightAt, effects, (px, py) => fogValueAt(world, px, py) >= 2);
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
    if (pickList.length > 0) {
      const hits = ray.intersectObjects(pickList, false);
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
      projectiles.dispose();
      scenery?.dispose();
      composer?.dispose();
      renderer.dispose();
    },
  };
  return api;
};

export default createRenderer;
