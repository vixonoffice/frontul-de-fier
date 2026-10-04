// Implementarea SimAPI. Punctul de intrare al simulării — orchestrează toate modulele din src/sim/**.
import type { BuildingType, Command, EntityId, GameSetup, SimAPI, Team, World } from './types';
import { TICK_RATE } from './types';
import { STARTING_CREDITS } from '../data/units';
import { BUILDINGS } from '../data/buildings';
import { generateMap } from './map';
import { buildBlockedGrid } from './path';
import { getInternal, getNav, getHarvestState } from './internal';
import { FOG_INTERVAL_TICKS, recomputeFog } from './fog';
import {
  canPlaceBuilding, handleBuildCancel, handleBuildPlace, handleBuildStart,
  handleRally, handleSell, handleTrain, handleTrainCancel, spawnBuilding, spawnUnit,
  updateHarvester, updateProduction, commandHarvest,
} from './economy';
import { canWeaponTarget, findTarget, updateProjectiles, updateTurretBuilding, updateUnitCombat } from './combat';
import { findPath } from './path';
import { issueMoveOrder, stepMovement } from './movement';
import { runAI } from './ai';
import { commandAir, isAir, updateAllBombers } from './air';
import { UNITS } from '../data/units';
import { center, sortedBuildingIds, sortedUnitIds } from './entities';

const DT = 1 / TICK_RATE;

export function createWorld(setup: GameSetup): World {
  const rngHolder = { rng: setup.seed | 0 };
  const map = generateMap(rngHolder, setup);

  const world: World = {
    tick: 0,
    map,
    units: new Map(),
    buildings: new Map(),
    projectiles: [],
    players: setup.players.map((pl) => ({
      team: pl.team,
      credits: STARTING_CREDITS,
      isAI: pl.isAI,
      difficulty: pl.difficulty,
      assist: { economy: false, defense: false, attack: false, allIn: false },
      production: { building: null, units: [], infantry: [], air: [], rally: null },
      defeated: false,
    })),
    fog: setup.players.map(() => new Uint8Array(map.w * map.h)),
    events: [],
    winner: null,
    nextId: 1,
    rng: rngHolder.rng,
    waveTimer: 0,
  };

  const internal = getInternal(world);

  setup.players.forEach((pl, idx) => {
    const start = map.starts[idx];
    const ax = Math.floor(start.x), ay = Math.floor(start.y);
    let blocked = buildBlockedGrid(world);
    spawnBuilding(world, internal, blocked, pl.team, 'hq', ax - 4, ay - 4);
    blocked = buildBlockedGrid(world);
    spawnBuilding(world, internal, blocked, pl.team, 'refinery', ax, ay - 5); // include recoltorul gratuit
    spawnUnit(world, internal, pl.team, 'tank', ax - 0.5, ay + 1.5, null);
    spawnUnit(world, internal, pl.team, 'tank', ax + 1.5, ay + 1.5, null);
    spawnUnit(world, internal, pl.team, 'rocket', ax + 0.5, ay + 3.5, null);
    if (pl.isAI) {
      blocked = buildBlockedGrid(world);
      spawnBuilding(world, internal, blocked, pl.team, 'turret', ax - 6, ay);
      blocked = buildBlockedGrid(world);
      spawnBuilding(world, internal, blocked, pl.team, 'turret', ax + 5, ay - 2);
    }
  });

  recomputeFog(world);
  return world;
}

function filterOwnIds(world: World, team: Team, ids: readonly EntityId[]): EntityId[] {
  return ids.filter((id) => {
    const u = world.units.get(id);
    return !!u && u.team === team;
  });
}

function applyCommand(world: World, cmd: Command, blocked: Uint8Array): void {
  const internal = getInternal(world);
  switch (cmd.t) {
    case 'move': {
      const ids = filterOwnIds(world, cmd.team, cmd.ids);
      const air = ids.filter((id) => isAir(world.units.get(id)!));
      if (air.length) commandAir(world, internal, air, 'move', cmd.x, cmd.y);
      const ground = air.length ? ids.filter((id) => !air.includes(id)) : ids;
      if (ground.length) issueMoveOrder(world, internal, blocked, ground, cmd.x, cmd.y, 'move');
      break;
    }
    case 'attackMove': {
      const ids = filterOwnIds(world, cmd.team, cmd.ids);
      const air = ids.filter((id) => isAir(world.units.get(id)!));
      // avioanele nu fac attack-move: zboară la punct și se întorc
      if (air.length) commandAir(world, internal, air, 'move', cmd.x, cmd.y);
      const ground = air.length ? ids.filter((id) => !air.includes(id)) : ids;
      if (ground.length) issueMoveOrder(world, internal, blocked, ground, cmd.x, cmd.y, 'attackMove');
      break;
    }
    case 'bomb': {
      const ids = filterOwnIds(world, cmd.team, cmd.ids);
      commandAir(world, internal, ids, 'bomb', cmd.x, cmd.y);
      break;
    }
    case 'attack': {
      const ids = filterOwnIds(world, cmd.team, cmd.ids);
      const target = world.units.get(cmd.targetId) ?? world.buildings.get(cmd.targetId);
      for (const id of ids) {
        const u = world.units.get(id);
        if (!u || u.type === 'harvester') continue;
        if (isAir(u)) {
          // atac cu avion = raid de bombardament pe poziția țintei (doar ținte la sol)
          if (target && !(target.kind === 'unit' && target.alt > 0.25)) {
            const tc = center(target);
            commandAir(world, internal, [id], 'bomb', tc.x, tc.y);
          }
          continue;
        }
        const w = UNITS[u.type].weapon;
        if (!w || (target && !canWeaponTarget(w, target))) continue; // arma nu poate lovi ținta (ex. tanc vs avion)
        const nav = getNav(internal, id);
        nav.flow = null;
        nav.engagedTarget = cmd.targetId;
        u.order = { kind: 'attack', targetId: cmd.targetId };
        if (target) {
          const tc = center(target);
          const p = findPath(blocked, world.map.w, world.map.h, Math.floor(u.x), Math.floor(u.y), Math.floor(tc.x), Math.floor(tc.y));
          u.path = p ?? [];
        } else {
          u.path = [];
        }
      }
      break;
    }
    case 'stop': {
      const ids = filterOwnIds(world, cmd.team, cmd.ids);
      commandAir(world, internal, ids, 'stop', 0, 0);
      for (const id of ids) {
        const u = world.units.get(id);
        if (!u || isAir(u)) continue;
        const nav = getNav(internal, id);
        nav.flow = null;
        nav.engagedTarget = null;
        u.path = [];
        u.order = { kind: 'idle' };
        const hs = getHarvestState(internal, id);
        if (hs.oreTile >= 0) {
          const cur = internal.oreReserved.get(hs.oreTile) ?? 0;
          if (cur <= 1) internal.oreReserved.delete(hs.oreTile); else internal.oreReserved.set(hs.oreTile, cur - 1);
          hs.oreTile = -1;
        }
      }
      break;
    }
    case 'harvest': {
      const ids = filterOwnIds(world, cmd.team, cmd.ids);
      for (const id of ids) {
        const u = world.units.get(id);
        if (!u || u.type !== 'harvester') continue;
        commandHarvest(world, internal, blocked, u, cmd.x, cmd.y);
      }
      break;
    }
    case 'buildStart':
      handleBuildStart(world, cmd.team, cmd.building);
      break;
    case 'buildPlace':
      handleBuildPlace(world, internal, blocked, cmd.team, cmd.tx, cmd.ty);
      break;
    case 'buildCancel':
      handleBuildCancel(world, cmd.team);
      break;
    case 'train':
      handleTrain(world, cmd.team, cmd.unit);
      break;
    case 'trainCancel':
      handleTrainCancel(world, cmd.team, cmd.unit);
      break;
    case 'sell':
      handleSell(world, cmd.team, cmd.id);
      break;
    case 'rally':
      handleRally(world, cmd.team, cmd.x, cmd.y);
      break;
  }
}

function checkVictory(world: World): void {
  if (world.winner !== null) return;
  for (const p of world.players) {
    if (p.defeated) continue;
    let hasBuilding = false;
    for (const b of world.buildings.values()) {
      if (b.team === p.team) { hasBuilding = true; break; }
    }
    if (!hasBuilding) p.defeated = true;
  }
  const alive = world.players.filter((p) => !p.defeated);
  if (alive.length === 1 && world.players.length > 1) {
    world.winner = alive[0].team;
    world.events.push({ type: 'gameOver', winner: alive[0].team });
  }
}

export function step(world: World, commands: Command[]): void {
  world.tick += 1;
  world.events = [];
  const internal = getInternal(world);
  const blocked = buildBlockedGrid(world);

  for (const cmd of commands) applyCommand(world, cmd, blocked);
  if (world.winner === null) {
    const aiCommands = runAI(world, internal, DT);
    for (const cmd of aiCommands) applyCommand(world, cmd, blocked);
  }

  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (u && u.type === 'harvester') updateHarvester(world, internal, blocked, u, DT);
  }
  updateProduction(world, internal, blocked, DT);
  updateAllBombers(world, internal, DT);

  const unitIds = sortedUnitIds(world);
  const buildingIds = sortedBuildingIds(world);
  for (const id of unitIds) {
    const u = world.units.get(id);
    if (u) updateUnitCombat(world, internal, blocked, u, DT, unitIds, buildingIds);
  }
  for (const id of buildingIds) {
    const b = world.buildings.get(id);
    if (b && BUILDINGS[b.type].weapon) updateTurretBuilding(world, internal, b, DT, unitIds, buildingIds);
  }
  updateProjectiles(world, internal, DT);

  stepMovement(world, internal, blocked, DT);

  if (world.tick % FOG_INTERVAL_TICKS === 0) recomputeFog(world);

  checkVictory(world);
}

export function canPlace(world: World, team: Team, type: BuildingType, tx: number, ty: number): boolean {
  return canPlaceBuilding(world, team, type, tx, ty);
}

const ORDER_CODE: Record<string, number> = { idle: 1, move: 2, attack: 3, attackMove: 4, bombRun: 5, returnToBase: 6, harvest: 7 };

function mix(h: number, v: number): number {
  let x = (h ^ v) | 0;
  x = Math.imul(x, 0x01000193);
  return x | 0;
}

export function hash(world: World): number {
  let h = 0x811c9dc5 | 0;
  h = mix(h, world.tick);
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id);
    if (!u) continue;
    h = mix(h, id);
    h = mix(h, Math.round(u.x * 1000));
    h = mix(h, Math.round(u.y * 1000));
    h = mix(h, Math.round(u.hp * 1000));
    h = mix(h, Math.round(u.carry * 1000));
    h = mix(h, Math.round(u.angle * 1000));
    h = mix(h, Math.round(u.turretAngle * 1000));
    h = mix(h, Math.round(u.alt * 1000));
    h = mix(h, u.ammo);
    h = mix(h, ORDER_CODE[u.order.kind]);
  }
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id);
    if (!b) continue;
    h = mix(h, id);
    h = mix(h, Math.round(b.hp * 1000));
    h = mix(h, Math.round(b.turretAngle * 1000));
  }
  for (const p of world.players) {
    h = mix(h, Math.round(p.credits * 1000));
    h = mix(h, p.production.units.length * 100 + p.production.infantry.length * 10 + p.production.air.length);
    for (const q of [p.production.units, p.production.infantry, p.production.air]) {
      if (q[0]) h = mix(h, Math.round(q[0].progress * 1000));
    }
    h = mix(h, p.defeated ? 1 : 0);
  }
  h = mix(h, world.winner === null ? -1 : world.winner);
  return h >>> 0;
}

export const sim: SimAPI = { createWorld, step, canPlace, hash };
export { findTarget };
