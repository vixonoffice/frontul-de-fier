// Mecanici de etapa 3 rulate o dată pe tick: curent (power), reparații, regenerarea elitei.
import type { Building, EntityId, Team, World } from './types';
import { BUILDINGS } from '../data/buildings';
import { REPAIR_COST_FACTOR, REPAIR_HP_PER_SEC, VETERANCY } from '../data/units';
import type { Internal } from './internal';
import { sortedBuildingIds, sortedUnitIds } from './entities';

/** Curentul echipei: centralele produc proporțional cu viața lor (ca în RA2), restul clădirilor consumă. */
export function powerOf(world: World, team: Team): { made: number; used: number } {
  let made = 0, used = 0;
  for (const b of world.buildings.values()) {
    if (b.team !== team) continue;
    const pw = BUILDINGS[b.type].power;
    if (pw > 0) made += b.type === 'power' ? pw * Math.max(0, Math.min(1, b.hp / b.maxHp)) : pw;
    else used -= pw;
  }
  return { made, used };
}

/** Ar intra jucătorul în lipsă de curent dacă ar adăuga o clădire de acest tip? (folosit de AI și asistent) */
export function wouldBeLowPower(world: World, team: Team, type: Building['type']): boolean {
  const { made, used } = powerOf(world, team);
  const pw = BUILDINGS[type].power;
  return pw < 0 && used - pw > made;
}

function teamHas(world: World, team: Team, type: Building['type']): boolean {
  for (const b of world.buildings.values()) if (b.team === team && b.type === type) return true;
  return false;
}

export function updatePower(world: World, internal: Internal): void {
  for (const p of world.players) {
    const pw = powerOf(world, p.team);
    p.power.made = Math.round(pw.made * 100) / 100;
    p.power.used = pw.used;
    const low = !p.defeated && pw.used > pw.made;
    p.radar = !low && !p.defeated && teamHas(world, p.team, 'radar');
    if ((internal.lowPower.get(p.team) ?? false) !== low) {
      internal.lowPower.set(p.team, low);
      world.events.push({ type: 'lowPower', team: p.team, on: low });
    }
  }
}

/** Reparații: clădirea cu `repairing` recuperează viață pe secundă și costă proporțional; fără bani se oprește pe loc. */
export function updateRepairs(world: World, dt: number): void {
  for (const id of sortedBuildingIds(world)) {
    const b = world.buildings.get(id)!;
    if (!b.repairing) continue;
    if (b.hp >= b.maxHp) { b.repairing = false; continue; }
    const dhp = Math.min(REPAIR_HP_PER_SEC * dt, b.maxHp - b.hp);
    const cost = REPAIR_COST_FACTOR * BUILDINGS[b.type].cost * (dhp / b.maxHp);
    const pl = world.players[b.team];
    if (pl.credits < cost) continue; // așteaptă bani
    pl.credits -= cost;
    b.hp += dhp;
    if (b.hp >= b.maxHp - 1e-6) { b.hp = b.maxHp; b.repairing = false; }
  }
}

/** Unitățile de elită se repară singure încet. */
export function updateVeterancy(world: World, dt: number): void {
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id)!;
    if (u.rank === 2 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + VETERANCY.eliteRegenPerSec * dt);
  }
}

export function handleRepair(world: World, team: Team, id: EntityId, on: boolean): void {
  const b = world.buildings.get(id);
  if (!b || b.team !== team) return;
  if (!on) { b.repairing = false; return; }
  if (b.hp < b.maxHp) b.repairing = true;
}
