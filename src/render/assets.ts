// Modele GLB reale (Quaternius / Kenney, CC0 — vezi docs/ASSETS.md).
// Se incarca o singura data, in fundal; pana atunci randarea foloseste placeholderele procedurale din models.ts.
// Fiecare model e normalizat: "fata" = +z local (ca in models.ts), originea pe sol, marime in tile-uri.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Team, UnitType, BuildingType } from '../sim/types';
import { BUILDINGS } from '../data/buildings';
import { TEAM_COLORS, procedural, oreMaterial } from './models';

export type ModelType = UnitType | BuildingType;

interface Spec {
  file: string;
  /** rotatie in jurul lui Y ca fata modelului sa devina +z */
  yaw: number;
  /** dimensiunea tinta (tile-uri): len = latura cea mai lunga, height = inaltime, span = anvergura, fit = incape in w x h */
  len?: number; height?: number; span?: number; fit?: boolean;
  /** pentru fit: fractiunea din latime/adancime ocupata si deplasarea (tile-uri) in footprint */
  fitFrac?: [number, number]; offset?: [number, number];
  /** materiale vopsite in culoarea echipei: nume -> luminozitate (1 = culoarea echipei) */
  paint?: Record<string, number>;
  /** texturi atlas (nu se pot selecta materiale): inmultire cu culoarea echipei, 0..1 */
  tintAll?: number;
  /** piesa care se roteste (tureta): nodurile + nodul dupa care se alege pivotul */
  turret?: { nodes: string[]; pivot: string };
  skinned?: boolean;
  kind: 'unit' | 'building' | 'air';
  /** inaltimea de la care iese din pamant cladirea cand e construita */
  rise?: number;
  extra?: (root: THREE.Group, team: Team, info: Info) => void;
}
interface Info { size: THREE.Vector3; w: number; h: number }

const SPECS: Partial<Record<ModelType, Spec>> = {
  tank: {
    file: 'tank.glb', kind: 'unit', yaw: Math.PI / 2, len: 1.0,
    paint: { Main: 1, Main_Light: 1.3, Main_Dark: 0.7 },
    turret: { nodes: ['Tank_Turret', 'Tank_Gun'], pivot: 'Tank_Turret' },
  },
  rocket: {
    file: 'rocket.glb', kind: 'unit', yaw: 0, len: 1.05, tintAll: 0.8,
    extra: (root, team, info) => addRocketRack(root, team, info),
  },
  harvester: {
    file: 'harvester.glb', kind: 'unit', yaw: 0, len: 1.1, tintAll: 0.85,
    extra: (root, _team, info) => addOrePile(root, info),
  },
  soldier: { file: 'soldier.glb', kind: 'unit', yaw: 0, height: 0.72, paint: { Swat: 1.1 }, skinned: true },
  bazooka: {
    file: 'soldier.glb', kind: 'unit', yaw: 0, height: 0.72, paint: { Swat: 1.1 }, skinned: true,
    extra: (root, _team, info) => addBazookaTube(root, info),
  },
  bomber: { file: 'bomber.glb', kind: 'air', yaw: 0, span: 1.7, paint: { White: 1.15 } },
  hq: { file: 'hq.glb', kind: 'building', yaw: 0, fit: true, tintAll: 0.75, rise: 3 },
  refinery: { file: 'refinery.glb', kind: 'building', yaw: 0, fit: true, paint: { Blue: 1 }, rise: 2.6 },
  factory: { file: 'factory.glb', kind: 'building', yaw: 0, fit: true, paint: { Cyan: 1 }, rise: 2.8 },
  barracks: { file: 'barracks.glb', kind: 'building', yaw: 0, fit: true, paint: { Green: 1 }, rise: 2.4 },
  airfield: {
    file: 'airfield.glb', kind: 'building', yaw: 0, fit: true, fitFrac: [0.6, 0.9], offset: [-0.72, 0], tintAll: 0.7, rise: 2.2,
    extra: (root) => addRunway(root),
  },
  turret: {
    file: 'turret.glb', kind: 'building', yaw: 0, len: 1.0, paint: { Orange: 1 }, rise: 1.0,
    turret: { nodes: ['Turret_Cannon_Top'], pivot: 'Turret_Cannon_Top' },
  },
  rocketTurret: {
    file: 'rocketturret.glb', kind: 'building', yaw: 0, len: 1.0, paint: { metalRed: 1 }, rise: 1.0,
    turret: { nodes: ['turret'], pivot: 'turret' },
  },
};

const SCENERY_FILES = ['rock1.glb', 'rock2.glb'];
export function getLoadedModel(file: string): GLTF | undefined {
  return loaded.get(file);
}

const FILE_CLIPS = ['Idle_Gun', 'Run', 'Run_Shoot', 'Idle_Gun_Shoot'];

const loaded = new Map<string, GLTF>();
const failed = new Set<string>();
const templates = new Map<string, THREE.Group>();
export let assetsVersion = 0;
let started = false;

function baseUrl(file: string): string {
  return new URL('models/' + file, document.baseURI).href;
}

/** porneste incarcarea tuturor modelelor (o singura data); jocul porneste imediat cu placeholdere */
export function preloadAssets(): void {
  if (started) return;
  started = true;
  (window as unknown as { __fdfAssets?: unknown }).__fdfAssets = { loaded, templates, failed }; // pentru depanare in dev
  const loader = new GLTFLoader();
  const files = new Set<string>();
  for (const s of Object.values(SPECS)) if (s) files.add(s.file);
  for (const f of SCENERY_FILES) files.add(f);
  for (const f of files) {
    loader.load(
      baseUrl(f),
      (gltf) => { loaded.set(f, gltf); assetsVersion++; },
      undefined,
      () => { failed.add(f); },
    );
  }
}

/** toate fisierele de decor sunt incarcate (sau au esuat) */
export function sceneryLoaded(): boolean {
  return SCENERY_FILES.every((f) => loaded.has(f) || failed.has(f));
}

export function isReady(type: ModelType): boolean {
  const s = SPECS[type];
  return !!s && loaded.has(s.file);
}

function teamColor(team: Team): THREE.Color {
  return new THREE.Color(TEAM_COLORS[team]);
}

/** cache de materiale clonate per (fisier, echipa) */
const matCache = new Map<string, THREE.Material>();
function teamMaterial(spec: Spec, m: THREE.Material, team: Team): THREE.Material {
  const std = m as THREE.MeshStandardMaterial;
  const shade = spec.paint?.[m.name];
  const tint = spec.tintAll !== undefined && std.map ? spec.tintAll : undefined;
  if (shade === undefined && tint === undefined) return m;
  const key = spec.file + '|' + m.uuid + '|' + team;
  let out = matCache.get(key);
  if (!out) {
    const c = std.clone();
    if (shade !== undefined) {
      const col = teamColor(team);
      if (shade >= 1) col.lerp(new THREE.Color(1, 1, 1), Math.min(1, (shade - 1) * 0.35));
      else col.multiplyScalar(shade);
      c.color.copy(col);
    } else if (tint !== undefined) {
      c.color.set(0xffffff).lerp(teamColor(team), tint);
    }
    c.roughness = Math.min(0.85, c.roughness ?? 0.6);
    c.metalness = 0.15;
    out = c;
    matCache.set(key, c);
  }
  return out;
}

function meshBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateWorldMatrix(true, true);
  const b = new THREE.Box3();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as THREE.BufferGeometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox!.clone();
    const sk = m as THREE.SkinnedMesh;
    if (sk.isSkinnedMesh) { sk.skeleton.update(); sk.computeBoundingBox(); }
    b.union(sk.isSkinnedMesh && sk.boundingBox ? sk.boundingBox.clone().applyMatrix4(m.matrixWorld) : bb.applyMatrix4(m.matrixWorld));
  });
  return b;
}

/** construieste sablonul (per tip si echipa): normalizat, cu materiale de echipa, platforma/steag/inel */
function buildTemplate(type: ModelType, team: Team): THREE.Group | null {
  const spec = SPECS[type];
  if (!spec) return null;
  const gltf = loaded.get(spec.file);
  if (!gltf) return null;
  const key = type + '|' + team;
  const cached = templates.get(key);
  if (cached) return cached;

  const model = (spec.skinned ? SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true)) as THREE.Group;
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material)
      ? m.material.map((x) => teamMaterial(spec, x, team))
      : teamMaterial(spec, m.material, team);
    m.castShadow = type !== 'soldier' && type !== 'bazooka' && type !== 'bomber';
    m.receiveShadow = true;
    m.frustumCulled = !(m as THREE.SkinnedMesh).isSkinnedMesh;
  });

  const root = new THREE.Group();
  root.name = 'root';
  const norm = new THREE.Group();
  norm.name = 'norm';
  norm.add(model);
  norm.rotation.y = spec.yaw;
  if (spec.kind === 'air') {
    // avionul se inclina (viraj / urcare) in jurul centrului sau
    const tilt = new THREE.Group();
    tilt.name = 'tilt';
    tilt.add(norm);
    root.add(tilt);
  } else root.add(norm);
  // caseta limitelor: pentru modele cu schelet caseta calculata e nesigura, folosim marimea naturala cunoscuta (1.8 m, picioarele pe y=0)
  const box = spec.skinned ? new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.8, 0.5)) : meshBox(norm);
  const size = box.getSize(new THREE.Vector3());
  const bdef = BUILDINGS[type as BuildingType];
  let s = 1;
  const ff = spec.fitFrac ?? [0.94, 0.94];
  if (spec.fit && bdef) s = Math.min((bdef.w * ff[0]) / size.x, (bdef.h * ff[1]) / size.z);
  else if (spec.len) s = spec.len / Math.max(size.x, size.z);
  else if (spec.height) s = spec.height / size.y;
  else if (spec.span) s = spec.span / Math.max(size.x, size.z);
  const c = box.getCenter(new THREE.Vector3());
  norm.scale.setScalar(s);
  norm.position.set(-c.x * s + (spec.offset?.[0] ?? 0), spec.kind === 'air' ? -c.y * s : -box.min.y * s, -c.z * s + (spec.offset?.[1] ?? 0));
  root.updateMatrixWorld(true);
  const info: Info = { size: size.clone().multiplyScalar(s), w: bdef?.w ?? 1, h: bdef?.h ?? 1 };

  // piesa mobila (tureta): pivot propriu, in spatiul radacinii, fata = +z
  if (spec.turret) {
    const pivotNode = model.getObjectByName(spec.turret.pivot);
    if (pivotNode) {
      const pb = meshBox(pivotNode);
      const pc = pb.getCenter(new THREE.Vector3());
      const pivot = new THREE.Group();
      pivot.name = 'turretPivot';
      root.add(pivot);
      pivot.position.set(pc.x, 0, pc.z);
      pivot.updateMatrixWorld(true);
      for (const n of spec.turret.nodes) {
        const node = model.getObjectByName(n);
        if (node) pivot.attach(node);
      }
    }
  }
  if (spec.extra) spec.extra(root, team, info);
  if (spec.kind === 'air') {
    // luminile motoarelor, in coada (emisive: prinde bloom-ul)
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffa04a, toneMapped: false }),
    );
    glow.position.set(0, 0, -info.size.z * 0.5);
    glow.scale.set(1, 1, 1.8);
    (root.getObjectByName('tilt') ?? root).add(glow);
  }

  // identificare echipa: platforma + steag (cladiri), inel (unitati)
  if (spec.kind === 'building') {
    const fw = bdef.w, fh = bdef.h;
    const plate = procedural.foundation(fw - 0.06, fh - 0.06);
    plate.position.y = 0;
    root.add(plate);
    root.add(teamTrim(fw, fh, team));
    const fl = procedural.flag(team, fw / 2 - 0.22, 0.1, fh / 2 - 0.22, type === 'turret' || type === 'rocketTurret' ? 0.9 : 1.5);
    fl.scale.setScalar(1.35);
    root.add(fl);
  } else if (spec.kind === 'unit') {
    root.add(teamRing(type, team));
  }
  root.userData.riseHeight = spec.rise ?? 1;
  root.userData.height = info.size.y;
  root.userData.real = true;
  root.userData.kind = spec.kind;
  root.userData.skinned = !!spec.skinned;
  templates.set(key, root);
  return root;
}

const ringGeoCache = new Map<number, THREE.BufferGeometry>();
const ringMatCache = new Map<number, THREE.Material>();
function teamRing(type: ModelType, team: Team): THREE.Mesh {
  const r = type === 'soldier' || type === 'bazooka' ? 0.27 : type === 'harvester' ? 0.62 : 0.55;
  let geo = ringGeoCache.get(r);
  if (!geo) {
    geo = new THREE.RingGeometry(r * 0.74, r, 28);
    geo.rotateX(-Math.PI / 2);
    ringGeoCache.set(r, geo);
  }
  let m = ringMatCache.get(team);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: TEAM_COLORS[team], transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    ringMatCache.set(team, m);
  }
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.y = 0.05;
  mesh.renderOrder = 2;
  mesh.name = 'teamRing';
  return mesh;
}

/** chenar colorat in jurul platformei cladirii */
function teamTrim(w: number, h: number, team: Team): THREE.Group {
  const g = new THREE.Group();
  const m = procedural.teamMat(team);
  const t = 0.07;
  const y = 0.125;
  g.add(procedural.box(w - 0.1, 0.03, t, m, 0, y, h / 2 - 0.08));
  g.add(procedural.box(w - 0.1, 0.03, t, m, 0, y, -h / 2 + 0.08));
  g.add(procedural.box(t, 0.03, h - 0.1, m, w / 2 - 0.08, y, 0));
  g.add(procedural.box(t, 0.03, h - 0.1, m, -w / 2 + 0.08, y, 0));
  return g;
}

// --- piese procedurale adaugate pe modelele GLB ---
function addRocketRack(root: THREE.Group, team: Team, info: Info): void {
  const pivot = new THREE.Group();
  pivot.name = 'turretPivot';
  const topY = info.size.y * 0.78;
  pivot.position.set(0, topY, -info.size.z * 0.16);
  const base = procedural.box(0.34, 0.07, 0.42, procedural.darkMetal(), 0, 0.03, 0);
  pivot.add(base);
  const rack = new THREE.Group();
  rack.rotation.x = -0.55;
  rack.position.y = 0.1;
  const tubeMat = procedural.mat('rocketTube', 0x6b6f66, { roughness: 0.5, metalness: 0.5 });
  const tipMat = procedural.mat('rocketTip', 0xd24a2a, { roughness: 0.5, metalness: 0.2 });
  for (const x of [-0.09, 0.09]) for (const y of [0, 0.15]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.62, 8), tubeMat);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(x, y, 0.12);
    rack.add(tube);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.1, 8), tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.set(x, y, 0.45);
    rack.add(tip);
  }
  rack.add(procedural.box(0.32, 0.05, 0.5, procedural.teamMat(team), 0, -0.07, 0.05));
  pivot.add(rack);
  procedural.enableShadows(pivot);
  root.add(pivot);
}

/** pista de decolare: asfalt cu marcaje, in dreapta hangarului */
function addRunway(root: THREE.Group): void {
  const asphalt = procedural.mat('asphalt', 0x2c2e31, { roughness: 0.95, metalness: 0.05 });
  const paint = procedural.mat('runwayPaint', 0xe8e4d4, { roughness: 0.8, metalness: 0 });
  root.add(procedural.box(1.3, 0.03, 2.7, asphalt, 1.2, 0.12, 0));
  for (let i = -3; i <= 3; i++) root.add(procedural.box(0.07, 0.01, 0.22, paint, 1.2, 0.14, i * 0.38));
  root.add(procedural.box(0.05, 0.01, 2.6, paint, 0.6, 0.14, 0));
  root.add(procedural.box(0.05, 0.01, 2.6, paint, 1.8, 0.14, 0));
}

function addOrePile(root: THREE.Group, info: Info): void {
  const hopper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), oreMaterial());
  hopper.name = 'hopper';
  hopper.position.set(0, info.size.y, -info.size.z * 0.22);
  hopper.visible = false;
  root.userData.hopperBaseY = info.size.y;
  root.add(hopper);
}

function addBazookaTube(root: THREE.Group, info: Info): void {
  const g = new THREE.Group();
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.46, 8),
    procedural.mat('bazTube', 0x4d5a3c, { roughness: 0.6, metalness: 0.3 }),
  );
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 8), procedural.mat('bazTip', 0xd24a2a, { roughness: 0.5 }));
  tip.rotation.x = Math.PI / 2;
  tip.position.z = 0.3;
  g.add(tip);
  g.position.set(-0.07, info.size.y * 0.74, 0.12);
  g.rotation.y = 0.06;
  root.add(g);
}

// --- instantiere ---
export interface Instance {
  obj: THREE.Group;
  mixer?: THREE.AnimationMixer;
  clips?: Record<string, THREE.AnimationAction>;
}

/** creeaza o instanta a modelului real; null daca inca nu s-a incarcat */
export function instantiate(type: ModelType, team: Team): Instance | null {
  const tpl = buildTemplate(type, team);
  if (!tpl) return null;
  const spec = SPECS[type]!;
  const obj = (tpl.userData.skinned ? SkeletonUtils.clone(tpl) : tpl.clone(true)) as THREE.Group;
  obj.userData = { ...tpl.userData };
  const tiltNode = obj.getObjectByName('tilt');
  if (tiltNode) obj.userData.tilt = tiltNode;
  const turret = obj.getObjectByName('turretPivot');
  if (turret) obj.userData.turret = turret;
  const hopper = obj.getObjectByName('hopper');
  if (hopper) obj.userData.hopper = hopper;
  const inst: Instance = { obj };
  if (spec.skinned) {
    const gltf = loaded.get(spec.file)!;
    const mixer = new THREE.AnimationMixer(obj);
    const clips: Record<string, THREE.AnimationAction> = {};
    for (const name of FILE_CLIPS) {
      const clip = gltf.animations.find((a) => a.name.endsWith('|' + name));
      if (clip) clips[name] = mixer.clipAction(clip);
    }
    inst.mixer = mixer;
    inst.clips = clips;
  }
  return inst;
}

export function modelHeight(obj: THREE.Object3D): number | undefined {
  return obj.userData.height as number | undefined;
}
