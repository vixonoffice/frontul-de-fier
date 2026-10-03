import { describe, expect, it } from 'vitest';
import { createWorld, step } from './index';
import type { GameSetup } from './types';

describe('AI vs AI', () => {
  it('a normal-difficulty AI vs AI match makes meaningful progress within 20 game-minutes', () => {
    // simulează 20 minute de joc (24000 tick-uri); durata reală de test ține de viteza mașinii, nu de sim

    const setup: GameSetup = {
      seed: 777,
      mapSize: { w: 80, h: 80 },
      players: [
        { team: 0, isAI: true, difficulty: 'normal' },
        { team: 1, isAI: true, difficulty: 'normal' },
      ],
    };
    const world = createWorld(setup);
    const startBuildings0 = [...world.buildings.values()].filter((b) => b.team === 0).length;
    const startBuildings1 = [...world.buildings.values()].filter((b) => b.team === 1).length;

    const TICKS_20MIN = 20 * 60 * 20; // 20 tick-uri/secundă
    let destroyedAny = false;
    let gameOverTick = -1;
    for (let t = 1; t <= TICKS_20MIN; t++) {
      step(world, []);
      if (world.events.some((e) => e.type === 'destroyed' && e.kind === 'building')) destroyedAny = true;
      if (world.winner !== null && gameOverTick < 0) gameOverTick = t;
      if (gameOverTick >= 0) break;
    }

    const endBuildings0 = [...world.buildings.values()].filter((b) => b.team === 0).length;
    const endBuildings1 = [...world.buildings.values()].filter((b) => b.team === 1).length;

    // Raportăm rezultatul în loc să presupunem un singur rezultat posibil.
    // eslint-disable-next-line no-console
    console.log(
      `AI vs AI (seed 777, normal): winner=${world.winner} atTick=${gameOverTick} ` +
      `buildings team0 ${startBuildings0}->${endBuildings0} team1 ${startBuildings1}->${endBuildings1} ` +
      `destroyedAnyBuilding=${destroyedAny}`,
    );

    // cerință minimă: fie s-a terminat jocul cu un câștigător, fie cel puțin s-a distrus o clădire
    expect(world.winner !== null || destroyedAny).toBe(true);
  }, 60000);

  it('a hard-difficulty AI vs AI match reaches an outright winner within 20 game-minutes', () => {
    const setup: GameSetup = {
      seed: 1,
      mapSize: { w: 80, h: 80 },
      players: [
        { team: 0, isAI: true, difficulty: 'hard' },
        { team: 1, isAI: true, difficulty: 'hard' },
      ],
    };
    const world = createWorld(setup);
    const TICKS_20MIN = 20 * 60 * 20;
    let gameOverTick = -1;
    for (let t = 1; t <= TICKS_20MIN; t++) {
      step(world, []);
      if (world.winner !== null) { gameOverTick = t; break; }
    }
    // eslint-disable-next-line no-console
    console.log(`AI vs AI (seed 1, hard): winner=${world.winner} at ${(gameOverTick / 20 / 60).toFixed(1)} min`);
    expect(world.winner).not.toBeNull();
    expect(gameOverTick).toBeLessThanOrEqual(TICKS_20MIN);
  }, 60000);
});
