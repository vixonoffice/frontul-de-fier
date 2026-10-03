// Punct de intrare DOAR pentru dezvoltare — ui-dev.html îl încarcă direct, fără să treacă prin
// placeholder-ele din src/sim și src/render. Folosește simularea și randarea false din stubs.ts,
// ca UI-ul să poată fi construit și testat independent de celelalte echipe.
import './style.css';
import { startGame } from './game';
import { createStubSim, createStubRenderer } from './stubs';
import type { GameSetup } from '../sim/types';

const root = document.getElementById('app');
if (!root) throw new Error('lipsește elementul #app din ui-dev.html');

const setup: GameSetup = {
  seed: 1337,
  mapSize: { w: 64, h: 48 },
  players: [
    { team: 0, isAI: false, difficulty: 'normal' },
    { team: 1, isAI: true, difficulty: 'normal' },
  ],
};

startGame({
  root,
  sim: createStubSim(),
  createRenderer: (canvas) => createStubRenderer(canvas),
  setup,
  localTeam: 0,
});

// Comoditate doar pentru capturi de ecran automate: ?autostart sare peste ecranul de start și
// simulează o selecție cu chenar + pornirea unei construcții, ca ecranul să nu fie gol.
if (new URLSearchParams(location.search).has('autostart')) {
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>('#startScreen .btn-primary')?.click();
  }, 80);
  setTimeout(() => {
    const canvas = document.getElementById('gamecanvas');
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const from = { x: r.left + 90, y: r.top + 90 };
    const to = { x: r.left + 420, y: r.top + 330 };
    const fire = (type: string, p: { x: number; y: number }) =>
      canvas.dispatchEvent(
        new PointerEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true, isPrimary: true })
      );
    fire('pointerdown', from);
    fire('pointermove', to);
    fire('pointerup', to);
  }, 400);
  setTimeout(() => {
    document.querySelector<HTMLButtonElement>('#buildPanel .card')?.click();
  }, 650);
}
