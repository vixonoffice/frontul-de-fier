// Gardienii (Unit.role === 'guard'): fiecare are un post. Când o clădire sau un recoltor propriu e atacat, sau un inamic
// vine la ~10 tile-uri de o clădire proprie, cei mai apropiați gardieni liberi fac attack-move acolo; când pericolul
// trece se întorc la posturi. Nu urmăresc la mai mult de ~14 tile-uri de cea mai apropiată clădire. Funcționează
// cu sau fără asistent. Un ordin explicit al jucătorului e respectat; după ce se termină, unitatea revine la post.
import type { EntityId, Team, Unit, Vec, World } from './types';
import { UNITS } from '../data/units';
import type { Internal } from './internal';
import { getNav } from './internal';
import { isVisible } from './fog';
import { center, distCC, sortedBuildingIds, sortedUnitIds } from './entities';
import { issueMoveOrder } from './movement';
import { isFlying } from './air';

const CHECK_EVERY = 10;          // tick-uri între verificări (0,5 s)
const ALERT_RADIUS = 10;         // inamic la atât de o clădire proprie = alarmă
const LEASH = 14;                // gardienii nu se îndepărtează mai mult de o clădire proprie
const HIT_MEMORY_TICKS = 100;    // o lovitură e „proaspătă” 5 s
const POST_EPS = 2.5;

function nearestOwnBuildingDist(own: Vec[], p: Vec): number {
  let best = Infinity;
  for (const c of own) { const d = distCC(c, p); if (d < best) best = d; }
  return best;
}

export function updateGuards(world: World, internal: Internal, blocked: Uint8Array): void {
  if (world.tick % CHECK_EVERY !== 3) return;
  // gardienii fiecărei echipe, în ordinea id-urilor
  const byTeam = new Map<Team, Unit[]>();
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id) as Unit;
    if (u.role !== 'guard' || UNITS[u.type].cargoCap > 0 || UNITS[u.type].domain !== 'ground') continue;
    let arr = byTeam.get(u.team);
    if (!arr) { arr = []; byTeam.set(u.team, arr); }
    arr.push(u);
  }
  for (const [team, guards] of byTeam) {
    if (world.players[team].defeated) continue;
    const own: Vec[] = [];
    for (const id of sortedBuildingIds(world)) {
      const b = world.buildings.get(id);
      if (b && b.team === team) own.push(center(b));
    }
    if (own.length === 0) continue;

    // amenințare: inamici vizibili lângă o clădire proprie; altfel o lovitură proaspătă
    const enemies: Unit[] = [];
    for (const id of sortedUnitIds(world)) {
      const e = world.units.get(id) as Unit;
      if (e.team === team || world.players[e.team].defeated || isFlying(e)) continue;
      if (!isVisible(world, team, e.x, e.y)) continue;
      if (nearestOwnBuildingDist(own, e) < ALERT_RADIUS) enemies.push(e);
    }
    const hit = internal.lastHit.get(team);
    const freshHit = hit && world.tick - hit.tick < HIT_MEMORY_TICKS ? hit : null;
    let spot: Vec | null = null;
    let attackers = 0;
    if (enemies.length > 0) {
      spot = { x: enemies[0].x, y: enemies[0].y };
      for (const e of enemies) if (distCC(spot, e) <= 8) attackers++;
    } else if (freshHit) {
      spot = { x: freshHit.x, y: freshHit.y };
      attackers = 1;
    }

    // postul implicit: unde se afla când a devenit gardian
    for (const g of guards) if (!internal.guardPost.has(g.id)) internal.guardPost.set(g.id, { x: g.x, y: g.y });

    // lesa: nu urmăresc mai departe de LEASH de cea mai apropiată clădire
    const goHome: Unit[] = [];
    for (const g of guards) {
      const o = g.order.kind;
      if ((o === 'idle' || o === 'attackMove') && nearestOwnBuildingDist(own, g) > LEASH) goHome.push(g);
    }

    const responders: Unit[] = [];
    const free: Unit[] = [];
    for (const g of guards) {
      if (goHome.includes(g)) continue;
      if (internal.guardState.has(g.id)) {
        if (g.order.kind === 'idle' || g.order.kind === 'attackMove') responders.push(g);
        else internal.guardState.delete(g.id); // i s-a dat alt ordin (jucătorul): îl respectăm
      } else if (g.order.kind === 'idle') free.push(g);
    }

    if (spot) {
      const needed = Math.max(2, attackers + 1);
      const extra = needed - responders.length;
      if (extra > 0) {
        const sp = spot;
        const cands = free.slice().sort((a, b) => distCC(a, sp) - distCC(b, sp) || a.id - b.id).slice(0, extra);
        for (const g of cands) responders.push(g);
      }
      // cei care răspund (noi sau deja pe drum, dar inactivi) primesc attack-move spre locul alarmei
      const go: number[] = [];
      for (const g of responders) {
        const st = internal.guardState.get(g.id);
        if (st && g.order.kind === 'attackMove') continue;
        internal.guardState.set(g.id, { x: spot.x, y: spot.y });
        go.push(g.id);
      }
      if (go.length) issueMoveOrder(world, internal, blocked, go, spot.x, spot.y, 'attackMove'); // în formație
    } else {
      // pericolul a trecut: cei care răspundeau se întorc
      for (const g of responders) {
        internal.guardState.delete(g.id);
        goHome.push(g);
      }
    }

    // revenire la post: după alarmă, după un ordin al jucătorului terminat sau după lesă
    for (const g of free) {
      if (goHome.includes(g) || internal.guardState.has(g.id)) continue;
      const nav = getNav(internal, g.id);
      if (nav.engagedTarget !== null) continue; // încă se luptă
      const post = internal.guardPost.get(g.id)!;
      if (distCC(post, g) > POST_EPS) goHome.push(g);
    }
    for (const g of goHome) {
      const post = internal.guardPost.get(g.id)!;
      internal.guardState.delete(g.id);
      getNav(internal, g.id).engagedTarget = null;
      issueMoveOrder(world, internal, blocked, [g.id], post.x, post.y, 'move');
    }
  }
}

export function guardsOf(world: World, team: Team): EntityId[] {
  const out: EntityId[] = [];
  for (const id of sortedUnitIds(world)) {
    const u = world.units.get(id) as Unit;
    if (u.team === team && u.role === 'guard' && UNITS[u.type].cargoCap === 0) out.push(id);
  }
  return out;
}
