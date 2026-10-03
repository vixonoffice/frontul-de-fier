// Fabrica de modele procedurale. Placeholder pana vin modelele GLB.
// Fiecare functie creeaza(team) -> Object3D, cu piese numite in userData pentru animatie
// (turret, barrel, dish, light, hopper, bayDoor, wheels[]). Cand vin modelele GLB,
// doar functiile de aici se schimba — restul randarii lucreaza cu aceleasi userData.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Team } from '../sim/types';

export const TEAM_COLORS: Record<Team, number> = {
  0: 0x3d9bff,
  1: 0xff4a3a,
  2: 0xffd23a,
  3: 0x54d17a,
};

// vopsea militara de nivel mediu (nu negru, nu stralucitoare) — se vede clar culoarea echipei
const HULL_MID: Record<Team, number> = {
  0: 0x4a6a86,
  1: 0x7a3a30,
  2: 0x8a7a3a,
  3: 0x3a6a52,
};
const HULL_BEVEL: Record<Team, number> = {
  0: 0x7fa0bd,
  1: 0xad6a58,
  2: 0xbdac66,
  3: 0x6aa084,
};

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(key: string, color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const k = key + ':' + color;
  let m = materialCache.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.4, ...opts });
    materialCache.set(k, m);
  }
  return m;
}

function hullMat(team: Team): THREE.MeshStandardMaterial {
  return mat('hull', HULL_MID[team], { roughness: 0.72, metalness: 0.25 });
}
/** fasie / bevel deschis la culoare, pentru muchii vizibile */
function bevelMat(team: Team): THREE.MeshStandardMaterial {
  return mat('bevel', HULL_BEVEL[team], { roughness: 0.55, metalness: 0.3 });
}
function teamMat(team: Team): THREE.MeshStandardMaterial {
  return mat('team', TEAM_COLORS[team], { roughness: 0.4, metalness: 0.35, emissive: TEAM_COLORS[team], emissiveIntensity: 0.1 });
}
function darkMetal(): THREE.MeshStandardMaterial {
  return mat('dark', 0x6b6860, { roughness: 0.5, metalness: 0.55 });
}
function trackMat(): THREE.MeshStandardMaterial {
  return mat('track', 0x2b2b2b, { roughness: 0.85, metalness: 0.2 });
}
function concreteMat(): THREE.MeshStandardMaterial {
  return mat('concrete', 0x8d8a80, { roughness: 0.9, metalness: 0.08 });
}
function concreteDarkMat(): THREE.MeshStandardMaterial {
  return mat('concreteDark', 0x6f6c63, { roughness: 0.9, metalness: 0.08 });
}
function accentMat(): THREE.MeshStandardMaterial {
  return mat('accent', 0xb8b3a5, { roughness: 0.5, metalness: 0.25 });
}
function windowMat(): THREE.MeshStandardMaterial {
  return mat('window', 0xffd9a0, { roughness: 0.3, metalness: 0.1, emissive: 0xffc988, emissiveIntensity: 1.4 });
}
function glassMat(): THREE.MeshStandardMaterial {
  return mat('glass', 0x101418, { roughness: 0.2, metalness: 0.8, emissive: 0x335577, emissiveIntensity: 0.3 });
}

function enableShadows(obj: THREE.Object3D): void {
  obj.traverse((c) => {
    if (c instanceof THREE.Mesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
}

function track(x: number, len: number, teamColor: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.2, len, 2, 0.05), trackMat());
  body.position.set(x, 0, 0);
  g.add(body);
  const wheelGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.24, 10);
  const wheelMatI = darkMetal();
  const nWheels = Math.max(3, Math.round(len * 1.6));
  for (let i = 0; i < nWheels; i++) {
    const w = new THREE.Mesh(wheelGeo, wheelMatI);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, -0.02, -len / 2 + 0.25 + (i * (len - 0.5)) / Math.max(1, nWheels - 1));
    g.add(w);
  }
  void teamColor;
  return g;
}

export function createTank(team: Team): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.32, 1.3, 3, 0.07), hullMat(team));
  hull.position.y = 0.26;
  g.add(hull);

  // muchie deschisa la culoare pe creasta carenei — citeste bine silueta de sus
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.03, 1.32), bevelMat(team));
  ridge.position.set(0, 0.42, 0);
  g.add(ridge);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.08, 0.3), teamMat(team));
  stripe.position.set(0, 0.32, 0.25);
  g.add(stripe);

  // skirt-uri laterale — suprafata mare de culoare de echipa, vizibila din lateral/de sus
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 1.2), teamMat(team));
    skirt.position.set(side * 0.49, 0.2, 0);
    g.add(skirt);
  }

  g.add(track(-0.52, 1.4, TEAM_COLORS[team]));
  g.add(track(0.52, 1.4, TEAM_COLORS[team]));

  const turretPivot = new THREE.Group();
  turretPivot.position.set(0, 0.46, -0.05);
  g.add(turretPivot);
  const turret = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.3, 0.68, 3, 0.09), hullMat(team));
  turret.position.y = 0.15;
  turretPivot.add(turret);
  const turretTop = new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.05, 0.5, 2, 0.06), teamMat(team));
  turretTop.position.y = 0.31;
  turretPivot.add(turretTop);
  const turretBand = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 16), bevelMat(team));
  turretBand.position.y = 0.26;
  turretPivot.add(turretBand);

  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(0, 0.17, 0.1);
  turretPivot.add(barrelPivot);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 1.05, 10), darkMetal());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.6;
  barrelPivot.add(barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.z = 1.15;
  barrelPivot.add(muzzle);

  g.userData.turret = turretPivot;
  g.userData.barrel = barrelPivot;
  g.userData.muzzle = muzzle;
  g.userData.hullTop = 0.42;
  enableShadows(g);
  return g;
}

export function createRocket(team: Team): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new RoundedBoxGeometry(0.82, 0.26, 1.2, 3, 0.06), hullMat(team));
  hull.position.y = 0.24;
  g.add(hull);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.06, 0.26), teamMat(team));
  stripe.position.set(0, 0.29, 0.2);
  g.add(stripe);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.03, 1.22), bevelMat(team));
  ridge.position.set(0, 0.38, 0);
  g.add(ridge);
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 1.1), teamMat(team));
    skirt.position.set(side * 0.43, 0.18, 0);
    g.add(skirt);
  }
  g.add(track(-0.45, 1.3, TEAM_COLORS[team]));
  g.add(track(0.45, 1.3, TEAM_COLORS[team]));

  const podPivot = new THREE.Group();
  podPivot.position.set(0, 0.42, -0.1);
  g.add(podPivot);
  const pod = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.4, 0.8, 2, 0.05), darkMetal());
  pod.position.y = 0.2;
  podPivot.add(pod);
  const tubeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.5, 8);
  const tubeMat = teamMat(team);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const tube = new THREE.Mesh(tubeGeo, darkMetal());
      tube.rotation.x = Math.PI / 2;
      tube.position.set(-0.16 + c * 0.16, 0.3 + r * 0.14, 0.15);
      podPivot.add(tube);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.14, 8), tubeMat);
      tip.rotation.x = Math.PI / 2;
      tip.position.set(-0.16 + c * 0.16, 0.3 + r * 0.14, 0.42);
      podPivot.add(tip);
    }
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.32, 0.5);
  podPivot.add(muzzle);

  g.userData.turret = podPivot;
  g.userData.barrel = podPivot;
  g.userData.muzzle = muzzle;
  g.userData.hullTop = 0.4;
  enableShadows(g);
  return g;
}

export const HARVESTER_HOPPER_BOTTOM = 0.37;
export const HARVESTER_HOPPER_UNIT_H = 0.1;
export const HARVESTER_HOPPER_FULL_H = 0.42;

export function createHarvester(team: Team): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.34, 1.5, 3, 0.07), hullMat(team));
  hull.position.y = 0.28;
  g.add(hull);
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 1.4), teamMat(team));
    skirt.position.set(side * 0.57, 0.2, 0);
    g.add(skirt);
  }
  g.add(track(-0.6, 1.6, TEAM_COLORS[team]));
  g.add(track(0.6, 1.6, TEAM_COLORS[team]));

  const cab = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.4, 0.5, 2, 0.06), hullMat(team));
  cab.position.set(0, 0.62, -0.45);
  g.add(cab);
  const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.06), glassMat());
  cabGlass.position.set(0, 0.68, -0.21);
  g.add(cabGlass);
  const cabStripe = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.52), teamMat(team));
  cabStripe.position.set(0, 0.44, -0.45);
  g.add(cabStripe);

  const hopperFrame = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.5, 0.75, 2, 0.05), darkMetal());
  hopperFrame.position.set(0, 0.62, 0.3);
  g.add(hopperFrame);
  const oreMat = mat('ore-fill', 0xf0b13a, { emissive: 0xf0b13a, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.1 });
  const oreFill = new THREE.Mesh(new THREE.BoxGeometry(0.78, HARVESTER_HOPPER_UNIT_H, 0.62), oreMat);
  oreFill.position.set(0, HARVESTER_HOPPER_BOTTOM, 0.3);
  oreFill.scale.y = 0.01;
  oreFill.visible = false;
  g.add(oreFill);

  g.userData.hopper = oreFill;
  g.userData.hopperBaseY = HARVESTER_HOPPER_BOTTOM;
  g.userData.turret = cab;
  g.userData.hullTop = 0.45;
  enableShadows(g);
  return g;
}

export function createHQ(team: Team): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new RoundedBoxGeometry(2.6, 1.1, 2.6, 3, 0.1), concreteMat());
  base.position.y = 0.55;
  g.add(base);
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.08, 2.64), accentMat());
  cornice.position.y = 1.09;
  g.add(cornice);
  const band = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.22, 2.62), teamMat(team));
  band.position.y = 0.3;
  g.add(band);
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.04), windowMat());
    win.position.set(s * 0.7, 0.6, 1.31);
    g.add(win);
  }
  const bunker = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.8, 1.5, 3, 0.08), concreteDarkMat());
  bunker.position.y = 1.35;
  g.add(bunker);
  const bunkerTrim = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.1, 1.52), teamMat(team));
  bunkerTrim.position.y = 1.0;
  g.add(bunkerTrim);
  const bunkerWin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.04), windowMat());
  bunkerWin.position.set(0, 1.4, 0.76);
  g.add(bunkerWin);

  const dishPivot = new THREE.Group();
  dishPivot.position.set(0, 2.0, 0);
  g.add(dishPivot);
  const dishArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), darkMetal());
  dishArm.position.y = 0.25;
  dishPivot.add(dishArm);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.1, 0.18, 16, 1, true), accentMat());
  dish.position.set(0.4, 0.55, 0);
  dish.rotation.z = Math.PI / 2.4;
  dishPivot.add(dish);
  const dishRim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 6, 16), teamMat(team));
  dishRim.position.copy(dish.position);
  dishRim.rotation.copy(dish.rotation);
  dishPivot.add(dishRim);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), darkMetal());
  antenna.position.set(-0.6, 2.3, 0.6);
  g.add(antenna);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mat('light-' + team, TEAM_COLORS[team], { emissive: TEAM_COLORS[team], emissiveIntensity: 1.5 }));
  light.position.set(-0.6, 2.76, 0.6);
  g.add(light);

  g.userData.dish = dishPivot;
  g.userData.blinkLight = light;
  g.userData.footprint = { w: 3, h: 3 };
  g.userData.riseHeight = 3;
  enableShadows(g);
  return g;
}

export function createRefinery(team: Team): THREE.Group {
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 2.8), concreteMat());
  pad.position.y = 0.04;
  g.add(pad);
  const dockMark = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 24), teamMat(team));
  dockMark.rotation.x = -Math.PI / 2;
  dockMark.position.set(0.9, 0.09, 0.9);
  g.add(dockMark);

  for (const sx of [-0.85, 0.85]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.5, 14), concreteMat());
    silo.position.set(sx, 0.85, -0.5);
    g.add(silo);
    const bandLow = new THREE.Mesh(new THREE.TorusGeometry(0.425, 0.035, 6, 16), accentMat());
    bandLow.rotation.x = Math.PI / 2;
    bandLow.position.set(sx, 0.55, -0.5);
    g.add(bandLow);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), accentMat());
    cap.position.set(sx, 1.6, -0.5);
    g.add(cap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.05, 6, 16), teamMat(team));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx, 1.3, -0.5);
    g.add(ring);
    const gaugeLight = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), windowMat());
    gaugeLight.position.set(sx + 0.3, 1.0, -0.15);
    g.add(gaugeLight);
  }
  const conveyor = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.2, 0.4, 2, 0.04), darkMetal());
  conveyor.position.set(0, 0.5, 0.6);
  conveyor.rotation.y = Math.PI / 10;
  g.add(conveyor);
  const conveyorTrim = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.04, 0.42), teamMat(team));
  conveyorTrim.position.copy(conveyor.position).setY(0.6);
  conveyorTrim.rotation.y = conveyor.rotation.y;
  g.add(conveyorTrim);

  g.userData.footprint = { w: 3, h: 3 };
  g.userData.dockPoint = new THREE.Vector3(0.9, 0.09, 0.9);
  g.userData.riseHeight = 2.2;
  enableShadows(g);
  return g;
}

export function createFactory(team: Team): THREE.Group {
  const g = new THREE.Group();
  const hangar = new THREE.Mesh(new RoundedBoxGeometry(3, 1.4, 2.6, 3, 0.08), concreteMat());
  hangar.position.y = 0.7;
  g.add(hangar);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.6, 10, 1, true, 0, Math.PI), concreteDarkMat());
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.position.y = 1.4;
  g.add(roof);
  // ribs vizibile pe acoperis
  for (let i = -1; i <= 1; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.03, 5, 10, Math.PI), accentMat());
    rib.rotation.y = Math.PI / 2;
    rib.position.set(0, 1.4, i * 0.8);
    g.add(rib);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.02, 0.25, 2.62), teamMat(team));
  stripe.position.y = 0.3;
  g.add(stripe);
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(3.04, 0.06, 2.64), accentMat());
  cornice.position.y = 1.39;
  g.add(cornice);

  const doorPivot = new THREE.Group();
  doorPivot.position.set(0, 1.35, 1.3);
  g.add(doorPivot);
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 0.1), concreteDarkMat());
  door.position.y = -0.65;
  doorPivot.add(door);
  const doorGlow = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.14, 0.04), windowMat());
  doorGlow.position.set(0, -0.2, 0.06);
  doorPivot.add(doorGlow);
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.46, 1.36, 0.06), teamMat(team));
  doorFrame.position.set(0, -0.65, -0.03);
  doorPivot.add(doorFrame);

  g.userData.bayDoor = doorPivot;
  g.userData.footprint = { w: 3, h: 3 };
  g.userData.riseHeight = 2.8;
  enableShadows(g);
  return g;
}

export function createTurret(team: Team): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.5, 12), concreteMat());
  base.position.y = 0.25;
  g.add(base);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.12, 12), teamMat(team));
  band.position.y = 0.46;
  g.add(band);

  const gunPivot = new THREE.Group();
  gunPivot.position.set(0, 0.6, 0);
  g.add(gunPivot);
  const gunBody = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.35, 0.5, 2, 0.06), hullMat(team));
  gunBody.position.y = 0.15;
  gunPivot.add(gunBody);
  const gunTrim = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.52), bevelMat(team));
  gunTrim.position.y = 0.33;
  gunPivot.add(gunTrim);
  const barrelPivot = new THREE.Group();
  barrelPivot.position.set(0, 0.2, 0);
  gunPivot.add(barrelPivot);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 8), darkMetal());
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.5;
  barrelPivot.add(barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.z = 1.0;
  barrelPivot.add(muzzle);

  g.userData.turret = gunPivot;
  g.userData.barrel = barrelPivot;
  g.userData.muzzle = muzzle;
  g.userData.footprint = { w: 1, h: 1 };
  g.userData.riseHeight = 1.1;
  enableShadows(g);
  return g;
}

// --- decor ---
export function createRock(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const jitter = 0.18;
    pos.setXYZ(
      i,
      pos.getX(i) + (Math.sin(i * 12.9898) * 0.5) * jitter,
      pos.getY(i) + (Math.sin(i * 78.233) * 0.5) * jitter,
      pos.getZ(i) + (Math.sin(i * 37.719) * 0.5) * jitter,
    );
    // varf mai deschis, baza mai inchisa — citeste volumul de sus
    const t = Math.max(0, Math.min(1, pos.getY(i) / 0.5 + 0.5));
    const shade = 0.72 + t * 0.5;
    colors[i * 3] = shade; colors[i * 3 + 1] = shade; colors[i * 3 + 2] = shade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function rockMaterial(): THREE.MeshStandardMaterial {
  return mat('rock', 0xffffff, { roughness: 0.92, metalness: 0.06, vertexColors: true });
}
export const ROCK_TINTS = [0x7a756a, 0x5f5b52, 0x6e695f];

/** 3 variante de cristale alungite/inclinate, ca grupul sa nu arate ca un patrat plat vazut de sus */
export function oreCrystalGeometries(): THREE.BufferGeometry[] {
  const a = new THREE.OctahedronGeometry(0.22, 0);
  a.scale(1, 2.1, 1);
  const b = new THREE.ConeGeometry(0.14, 0.62, 5);
  b.translate(0, 0.31, 0);
  const c = new THREE.OctahedronGeometry(0.16, 0);
  c.scale(1, 1.6, 1);
  return [a, b, c];
}

export function oreMaterial(): THREE.MeshStandardMaterial {
  return mat('ore-crystal', 0xf0b13a, { emissive: 0xf0b13a, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.15 });
}

export function grassGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.045, 0.22, 3);
  geo.translate(0, 0.11, 0);
  return geo;
}

export function grassMaterial(variant: 0 | 1 = 0): THREE.MeshStandardMaterial {
  return mat('grass' + variant, variant === 0 ? 0x6e6b3f : 0x8a8650, { roughness: 0.95, metalness: 0 });
}

export const MODEL_FACTORY = {
  tank: createTank,
  rocket: createRocket,
  harvester: createHarvester,
  hq: createHQ,
  refinery: createRefinery,
  factory: createFactory,
  turret: createTurret,
};
