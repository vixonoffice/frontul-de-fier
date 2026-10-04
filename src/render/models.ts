// Fabrica de modele procedurale. Placeholder pana vin modelele GLB.
// Fiecare functie creeaza(team) -> Object3D, cu piese numite in userData pentru animatie
// (turret, barrel, dish, light, hopper, bayDoor, wheels[]). Cand vin modelele GLB,
// doar functiile de aici se schimba — restul randarii lucreaza cu aceleasi userData.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Team, UnitType, BuildingType } from '../sim/types';

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

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function cyl(rTop: number, rBot: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 12): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  mesh.position.set(x, y, z);
  return mesh;
}
function lampMat(): THREE.MeshStandardMaterial {
  return mat('lamp', 0xfff2c8, { emissive: 0xffe9b0, emissiveIntensity: 2.2, roughness: 0.3, metalness: 0 });
}
function hazardMat(): THREE.MeshStandardMaterial {
  return mat('hazard', 0xf2b632, { roughness: 0.6, metalness: 0.15 });
}
function padMat(): THREE.MeshStandardMaterial {
  return mat('pad', 0x5d5a52, { roughness: 0.95, metalness: 0.02 });
}
/** platforma de beton pe care sta o cladire, cu margine si dungi de avertizare la colturi */
function foundation(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(w, 0.1, d, padMat(), 0, 0.02, 0));
  g.add(box(w - 0.24, 0.04, d - 0.24, concreteDarkMat(), 0, 0.085, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(box(0.34, 0.03, 0.1, hazardMat(), sx * (w / 2 - 0.25), 0.11, sz * (d / 2 - 0.1)));
    g.add(box(0.1, 0.03, 0.34, hazardMat(), sx * (w / 2 - 0.1), 0.11, sz * (d / 2 - 0.25)));
  }
  return g;
}
/** catarg cu steag in culoarea echipei */
function flag(team: Team, x: number, y: number, z: number, h = 1.3): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.025, 0.03, h, darkMetal(), 0, h / 2, 0, 6));
  g.add(box(0.5, 0.3, 0.02, teamMat(team), 0.27, h - 0.18, 0));
  g.position.set(x, y, z);
  return g;
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
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.2, len - 0.18, 2, 0.05), trackMat());
  body.position.set(x, 0.02, 0);
  g.add(body);
  // capete rotunjite (roata motoare / de intindere)
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.24, 12), trackMat());
    end.rotation.z = Math.PI / 2;
    end.position.set(x, 0.02, s * (len / 2 - 0.12));
    g.add(end);
  }
  // zale: nervuri transversale pe partea de sus a senilei
  const linkGeo = new THREE.BoxGeometry(0.26, 0.025, 0.05);
  const nLinks = Math.round(len / 0.14);
  for (let i = 0; i < nLinks; i++) {
    const l = new THREE.Mesh(linkGeo, darkMetal());
    l.position.set(x, 0.125, -len / 2 + 0.16 + (i * (len - 0.32)) / Math.max(1, nLinks - 1));
    g.add(l);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.27, 10);
  const nWheels = Math.max(3, Math.round(len * 2.2));
  for (let i = 0; i < nWheels; i++) {
    const w = new THREE.Mesh(wheelGeo, darkMetal());
    w.rotation.z = Math.PI / 2;
    w.position.set(x, -0.01, -len / 2 + 0.22 + (i * (len - 0.44)) / Math.max(1, nWheels - 1));
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

  // frana de gura, manta, trapa, mitraliera
  const brake = cyl(0.085, 0.085, 0.16, darkMetal(), 0, 0, 1.08, 10);
  brake.rotation.x = Math.PI / 2;
  barrelPivot.add(brake);
  const sleeve = cyl(0.08, 0.09, 0.3, bevelMat(team), 0, 0, 0.3, 10);
  sleeve.rotation.x = Math.PI / 2;
  barrelPivot.add(sleeve);
  barrelPivot.add(box(0.3, 0.2, 0.14, darkMetal(), 0, 0, 0.26));
  turretPivot.add(cyl(0.11, 0.12, 0.06, darkMetal(), -0.14, 0.36, -0.12, 10));
  turretPivot.add(box(0.2, 0.14, 0.22, hullMat(team), 0, 0.14, -0.42)); // cos spate turela
  const ant = cyl(0.008, 0.012, 0.7, darkMetal(), 0.22, 0.65, -0.25, 4);
  turretPivot.add(ant);
  // caroserie: glacis frontal inclinat, punte motor, esapamente, faruri
  const glacis = box(0.9, 0.05, 0.42, bevelMat(team), 0, 0.37, 0.52);
  glacis.rotation.x = 0.42;
  g.add(glacis);
  g.add(box(0.62, 0.07, 0.36, darkMetal(), 0, 0.45, -0.46));
  for (let k = -1; k <= 1; k++) g.add(box(0.5, 0.02, 0.04, bevelMat(team), 0, 0.495, -0.46 + k * 0.1));
  for (const side of [-1, 1]) {
    const ex = cyl(0.04, 0.04, 0.3, darkMetal(), side * 0.36, 0.42, -0.66, 8);
    ex.rotation.x = Math.PI / 2;
    g.add(ex);
    g.add(box(0.1, 0.07, 0.04, lampMat(), side * 0.33, 0.33, 0.67));
    g.add(box(0.26, 0.03, 1.46, hullMat(team), side * 0.52, 0.16, 0)); // aripi peste senile
  }

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

  // cabina in fata, cu parbriz; picioare de sprijin; faruri
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.26, 0.34, 2, 0.05), hullMat(team)).translateY(0.5).translateZ(0.42));
  g.add(box(0.6, 0.12, 0.03, glassMat(), 0, 0.53, 0.6));
  g.add(box(0.72, 0.03, 0.36, teamMat(team), 0, 0.64, 0.42));
  for (const side of [-1, 1]) {
    g.add(box(0.1, 0.06, 0.04, lampMat(), side * 0.28, 0.32, 0.62));
    g.add(box(0.24, 0.03, 1.36, hullMat(team), side * 0.45, 0.16, 0));
    podPivot.add(box(0.05, 0.3, 0.6, bevelMat(team), side * 0.31, 0.2, 0));
  }

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

  // lama de colectare in fata, cu dungi de avertizare; girofar; faruri
  const scoop = box(1.25, 0.24, 0.16, darkMetal(), 0, 0.2, -0.86);
  scoop.rotation.x = -0.35;
  g.add(scoop);
  for (let k = -2; k <= 2; k++) g.add(box(0.12, 0.25, 0.02, hazardMat(), k * 0.25, 0.2, -0.95).rotateX(-0.35));
  for (const side of [-1, 1]) {
    g.add(box(0.06, 0.12, 0.3, darkMetal(), side * 0.5, 0.3, -0.72));
    g.add(box(0.12, 0.07, 0.04, lampMat(), side * 0.2, 0.52, -0.71));
    g.add(box(0.3, 0.03, 1.66, hullMat(team), side * 0.6, 0.17, 0));
    g.add(box(0.04, 0.54, 0.79, hazardMat(), side * 0.46, 0.62, 0.3));
  }
  g.add(cyl(0.06, 0.06, 0.08, mat('beacon', 0xffa726, { emissive: 0xff9a1a, emissiveIntensity: 2.4 }), 0.18, 0.86, -0.5, 8));
  g.add(box(0.94, 0.05, 0.05, bevelMat(team), 0, 0.88, 0.66));
  g.add(box(0.94, 0.05, 0.05, bevelMat(team), 0, 0.88, -0.06));

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

  g.add(foundation(3.0, 3.0));
  // stalpi de colt, usa, scari, aparate pe acoperis, steag
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.22, 1.18, 0.22, concreteDarkMat(), sx * 1.24, 0.59, sz * 1.24));
  g.add(box(0.5, 0.62, 0.05, darkMetal(), 0, 0.42, 1.32));
  g.add(box(0.56, 0.04, 0.08, teamMat(team), 0, 0.75, 1.33));
  g.add(box(0.8, 0.08, 0.3, concreteDarkMat(), 0, 0.14, 1.45));
  for (const sx of [-1, 1]) {
    g.add(box(0.04, 0.3, 0.9, windowMat(), sx * 1.31, 0.6, 0.3));
    g.add(box(0.4, 0.2, 0.4, darkMetal(), sx * 0.95, 1.22, -0.9));
    g.add(cyl(0.13, 0.13, 0.03, accentMat(), sx * 0.95, 1.33, -0.9, 10));
  }
  g.add(box(1.0, 0.04, 1.0, hazardMat(), 0.0, 1.76, 0.0)); // platforma pe buncar
  g.add(box(0.9, 0.05, 0.9, concreteDarkMat(), 0.0, 1.77, 0.0));
  g.add(flag(team, 1.05, 1.12, 1.05, 1.5));

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

  g.add(foundation(3.0, 3.0));
  // conducta intre silozuri, cos de ardere cu flacara, hala mica de procesare, scara
  const pipe = cyl(0.07, 0.07, 1.7, accentMat(), 0, 1.15, -0.5, 8);
  pipe.rotation.z = Math.PI / 2;
  g.add(pipe);
  const pipe2 = cyl(0.05, 0.05, 1.1, accentMat(), -0.85, 0.55, 0.05, 8);
  pipe2.rotation.x = Math.PI / 2;
  g.add(pipe2);
  g.add(cyl(0.09, 0.13, 2.2, concreteDarkMat(), 0, 1.15, -1.05, 10));
  g.add(cyl(0.11, 0.11, 0.1, hazardMat(), 0, 2.1, -1.05, 10));
  g.add(cyl(0.02, 0.09, 0.22, mat('flare', 0xffb040, { emissive: 0xff8a20, emissiveIntensity: 3 }), 0, 2.36, -1.05, 8));
  g.add(new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.6, 0.7, 2, 0.05), concreteMat()).translateX(-0.85).translateY(0.4).translateZ(0.75));
  g.add(box(0.92, 0.07, 0.72, teamMat(team), -0.85, 0.72, 0.75));
  g.add(box(0.5, 0.2, 0.03, windowMat(), -0.85, 0.45, 1.11));
  for (const sx of [-0.85, 0.85]) for (let k = 0; k < 5; k++) g.add(box(0.2, 0.02, 0.03, darkMetal(), sx, 0.35 + k * 0.24, -0.07));
  g.add(flag(team, 1.25, 0.1, -1.25, 1.6));

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
  const arch = new THREE.Group();
  arch.position.y = 1.4;
  arch.scale.y = 0.42;
  g.add(arch);
  arch.add(roof);
  // ribs vizibile pe acoperis
  for (let i = -1; i <= 1; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.03, 5, 10, Math.PI), accentMat());
    rib.rotation.y = Math.PI / 2;
    rib.position.set(0, 0, i * 0.8);
    arch.add(rib);
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

  g.add(foundation(3.0, 3.0).translateZ(0.05));
  // cosuri de fum, luminatoare pe acoperis, proiectoare la poarta, benzi de avertizare
  for (const sx of [-1, 1]) {
    g.add(cyl(0.11, 0.14, 1.3, concreteDarkMat(), sx * 1.15, 1.9, -0.95, 10));
    g.add(cyl(0.13, 0.13, 0.1, hazardMat(), sx * 1.15, 2.5, -0.95, 10));
    g.add(box(0.14, 1.34, 0.14, hazardMat(), sx * 1.3, 0.68, 1.32));
    g.add(box(0.12, 0.08, 0.08, lampMat(), sx * 1.05, 1.5, 1.34));
    g.add(box(0.04, 0.3, 1.4, windowMat(), sx * 1.51, 0.85, 0));
  }
  for (let k = -1; k <= 1; k += 2) g.add(box(0.5, 0.05, 0.7, glassMat(), 0, 2.04, k * 0.45));
  g.add(box(2.3, 0.03, 0.5, hazardMat(), 0, 0.12, 1.2));
  g.add(flag(team, -1.38, 0.1, -1.38, 2.3));

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

  // soclu hexagonal cu saci de nisip, a doua teava, proiector
  g.add(cyl(0.72, 0.78, 0.14, padMat(), 0, 0.07, 0, 6));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const bag = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.14, 0.18, 2, 0.05), mat('sandbag', 0xa8966a, { roughness: 1, metalness: 0 }));
    bag.position.set(Math.cos(a) * 0.62, 0.2, Math.sin(a) * 0.62);
    bag.rotation.y = -a + Math.PI / 2;
    g.add(bag);
  }
  barrel.position.x = -0.09;
  const barrel2 = barrel.clone();
  barrel2.position.x = 0.09;
  barrelPivot.add(barrel2);
  barrelPivot.add(box(0.36, 0.2, 0.16, darkMetal(), 0, 0, 0.22));
  gunPivot.add(box(0.2, 0.06, 0.2, teamMat(team), 0, 0.37, -0.08));
  gunPivot.add(box(0.08, 0.08, 0.05, lampMat(), 0.2, 0.3, 0.25));

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
  // smoc din 5 fire evazate, intr-o singura geometrie
  const pos: number[] = [];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + k * 0.7;
    const lean = 0.09 + (k % 2) * 0.05;
    const hgt = 0.2 + (k % 3) * 0.07;
    const bx = Math.cos(a) * 0.04, bz = Math.sin(a) * 0.04;
    const px = -Math.sin(a) * 0.035, pz = Math.cos(a) * 0.035;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean, hgt, bz + Math.sin(a) * lean);
    pos.push(bx + px, 0, bz + pz, bx - px, 0, bz - pz, bx + Math.cos(a) * lean, hgt, bz + Math.sin(a) * lean);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1; // normale in sus: firele iau lumina ca solul
  geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return geo;
}

export function grassMaterial(variant: 0 | 1 = 0): THREE.MeshStandardMaterial {
  return mat('grass' + variant, variant === 0 ? 0x86a04e : 0xb3aa62, { roughness: 0.95, metalness: 0 });
}

// TODO etapa 2: modele proprii pentru unitățile și clădirile noi (deocamdată refolosesc ce există)
export const MODEL_FACTORY: Record<UnitType | BuildingType, (team: Team) => THREE.Group> = {
  soldier: createRocket,
  bazooka: createRocket,
  bomber: createTank,
  barracks: createFactory,
  airfield: createFactory,
  rocketTurret: createTurret,
  tank: createTank,
  rocket: createRocket,
  harvester: createHarvester,
  hq: createHQ,
  refinery: createRefinery,
  factory: createFactory,
  turret: createTurret,
};
