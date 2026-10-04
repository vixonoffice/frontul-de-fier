import { expect, test } from 'vitest';
import { sim } from './index';
import { BUILDINGS, SELL_REFUND } from '../data/buildings';

function fresh() {
  return sim.createWorld({ seed: 3, mapSize: { w: 80, h: 80 }, players: [{ team: 0, isAI: false, difficulty: 'easy' }, { team: 1, isAI: true, difficulty: 'easy' }] });
}

test('vânzarea unei rafinării dă înapoi jumătate din cost și clădirea dispare', () => {
  const w = fresh();
  const ref = [...w.buildings.values()].find((b) => b.team === 0 && b.type === 'refinery')!;
  const before = w.players[0].credits;
  sim.step(w, [{ t: 'sell', team: 0, id: ref.id }]);
  expect(w.buildings.has(ref.id)).toBe(false);
  expect(w.players[0].credits).toBe(before + Math.floor(BUILDINGS.refinery.cost * SELL_REFUND));
  expect(w.events.some((e) => e.type === 'sold' && e.id === ref.id)).toBe(true);
});

test('HQ-ul și clădirile inamicului nu pot fi vândute', () => {
  const w = fresh();
  const hq = [...w.buildings.values()].find((b) => b.team === 0 && b.type === 'hq')!;
  const enemy = [...w.buildings.values()].find((b) => b.team === 1)!;
  const before = w.players[0].credits;
  sim.step(w, [{ t: 'sell', team: 0, id: hq.id }, { t: 'sell', team: 0, id: enemy.id }]);
  expect(w.buildings.has(hq.id)).toBe(true);
  expect(w.buildings.has(enemy.id)).toBe(true);
  expect(w.players[0].credits).toBe(before);
});
