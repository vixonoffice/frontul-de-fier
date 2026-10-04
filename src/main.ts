// Punctul de intrare real al jocului. La integrare, src/sim/index.ts și src/render/index.ts
// (placeholder-ele din ramura `ui`) vor fi înlocuite de orchestrator cu implementările adevărate
// ale simulării și randării — restul acestui fișier nu se schimbă.
import './ui/style.css';
import { startGame, type GameHandle } from './ui/game';
import { sim } from './sim';
import { createRenderer } from './render';
import type { Difficulty, GameSetup } from './sim/types';

const root = document.getElementById('app');
if (!root) throw new Error('lipsește elementul #app din index.html');
const appRoot = root;

function makeSetup(difficulty: Difficulty): GameSetup {
  return {
    seed: (Date.now() & 0xffffffff) >>> 0,
    mapSize: { w: 80, h: 80 },
    players: [
      { team: 0, isAI: false, difficulty },
      { team: 1, isAI: true, difficulty },
    ],
  };
}

let handle: GameHandle | null = null;

/** Pornește un meci. "Joacă din nou" îl repornește aici, fără să reîncarce pagina. */
function launch(difficulty: Difficulty, autoStart: boolean) {
  handle?.destroy();
  handle = startGame({
    root: appRoot,
    sim,
    createRenderer,
    setup: makeSetup(difficulty),
    localTeam: 0,
    difficulty,
    autoStart,
    // la repornire: ținem dificultatea aleasă și sărim peste ecranul de start
    onRestart: (d) => launch(d, true),
  });
}

launch('easy', false);
