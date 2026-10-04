// Punctul de intrare real al jocului. Meciul se construiește din alegerile de pe ecranul de start
// (adversari, dificultate, hartă, mărime); fiecare meci primește o sămânță proaspătă.
import './ui/style.css';
import { startGame, type GameHandle } from './ui/game';
import { sim } from './sim';
import { createRenderer } from './render';
import type { GameSetup, Team } from './sim/types';
import { matchPrefs, setMatchPrefs, type MatchPrefs } from './ui/prefs';

const root = document.getElementById('app');
if (!root) throw new Error('lipsește elementul #app din index.html');
const appRoot = root;

function newSeed(): number {
  return 1 + Math.floor(Math.random() * 99999);
}

function makeSetup(m: MatchPrefs, seed: number): GameSetup {
  const players: GameSetup['players'] = [{ team: 0, isAI: false, difficulty: m.difficulty }];
  for (let i = 1; i <= m.opponents; i++) players.push({ team: i as Team, isAI: true, difficulty: m.difficulty });
  return { seed, mapSize: { w: m.size, h: m.size }, players, mapStyle: m.map };
}

let handle: GameHandle | null = null;

/** Pornește un meci. Repornirile se fac aici, fără să reîncarce pagina. */
function launch(m: MatchPrefs, seed: number, autoStart: boolean, assist = false) {
  handle?.destroy();
  handle = startGame({
    root: appRoot,
    sim,
    createRenderer,
    setup: makeSetup(m, seed),
    localTeam: 0,
    difficulty: m.difficulty,
    match: m,
    seed,
    autoStart,
    startAssist: assist,
    onStart: (choice, o) => {
      setMatchPrefs(choice);
      launch(choice, newSeed(), true, o.assist);
    },
    onRestart: (mode, match, oldSeed) => {
      if (mode === 'setup') launch(matchPrefs(), newSeed(), false);
      else launch(match, mode === 'same' ? oldSeed : newSeed(), true);
    },
  });
}

launch(matchPrefs(), newSeed(), false);
