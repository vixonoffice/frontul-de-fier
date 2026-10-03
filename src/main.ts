// Punctul de intrare real al jocului. La integrare, src/sim/index.ts și src/render/index.ts
// (placeholder-ele din ramura `ui`) vor fi înlocuite de orchestrator cu implementările adevărate
// ale simulării și randării — restul acestui fișier nu se schimbă.
import './ui/style.css';
import { startGame } from './ui/game';
import { sim } from './sim';
import { createRenderer } from './render';
import type { GameSetup } from './sim/types';

const root = document.getElementById('app');
if (!root) throw new Error('lipsește elementul #app din index.html');

const setup: GameSetup = {
  seed: (Date.now() & 0xffffffff) >>> 0,
  mapSize: { w: 80, h: 80 },
  players: [
    { team: 0, isAI: false, difficulty: 'normal' },
    { team: 1, isAI: true, difficulty: 'normal' },
  ],
};

startGame({ root, sim, createRenderer, setup, localTeam: 0 });
