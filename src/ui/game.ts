// Punctul central al UI-ului: bucla de joc cu tick fix, bufferul de comenzi, și asamblarea
// tuturor submodulelor (bară de sus, minihartă, panou de construcție, input, ecrane, toasturi).
import { TICK_RATE, type Command, type GameSetup, type SimAPI, type Team, type SimEvent } from '../sim/types';
import type { CreateRenderer } from '../render/api';
import type { UiContext, UiModule, GameStats } from './context';
import { el } from './dom';
import { initTopbar } from './topbar';
import { initMinimap } from './minimap';
import { initSelectionPanel } from './selectionPanel';
import { initBuildPanel } from './buildPanel';
import { initMobileToolbar } from './mobileToolbar';
import { initInput } from './input';
import { initScreens } from './screens';
import { initToasts } from './toasts';

export interface GameHandle {
  pause(): void;
  resume(): void;
  togglePause(): void;
  setSpeed(speed: 1 | 2): void;
  destroy(): void;
}

export interface StartGameOptions {
  root: HTMLElement;
  sim: SimAPI;
  createRenderer: CreateRenderer;
  setup: GameSetup;
  localTeam: Team;
}

const TICK_DT = 1 / TICK_RATE;

export function startGame(opts: StartGameOptions): GameHandle {
  const { root, sim, createRenderer, setup, localTeam } = opts;

  root.innerHTML = '';
  root.classList.add('fdf-root');

  const world = sim.createWorld(setup);

  const stage = el('div', { attrs: { id: 'stage' }, parent: root });
  const canvas = el('canvas', { attrs: { id: 'gamecanvas' }, parent: stage });
  const renderer = createRenderer(canvas);
  renderer.setLocalTeam(localTeam);
  for (const b of world.buildings.values()) {
    if (b.team === localTeam && b.type === 'hq') renderer.centerOn({ x: b.tx + 1.5, y: b.ty + 1.5 });
  }

  const isTouch = (matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

  let pendingCommands: Command[] = [];

  const stats: GameStats = { startTick: 0, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0, creditsEarned: 0 };

  const ctx: UiContext = {
    root,
    stageEl: stage,
    sim,
    renderer,
    localTeam,
    isTouch,
    world,
    stats,
    paused: true, // pornește pe ecranul de start; "Începe" îl dezactivează
    gameOver: false,
    speed: 1,
    attackMoveArmed: false,
    placing: null,
    pickingRally: false,
    selection: [],
    groups: new Map(),
    lastEventPos: null,

    queueCommand(cmd) {
      pendingCommands.push(cmd);
    },
    setSelection(ids) {
      ctx.selection = ids;
      renderer.setSelection(ids);
    },
    armAttackMove(v) {
      ctx.attackMoveArmed = v;
    },
    startPlacing(type) {
      ctx.placing = type;
      ctx.pickingRally = false;
    },
    cancelPlacing() {
      ctx.placing = null;
      renderer.setGhost(null);
    },
    tryPlaceAt(tx, ty) {
      const type = ctx.placing;
      if (!type) return;
      if (sim.canPlace(world, localTeam, type, tx, ty)) {
        ctx.queueCommand({ t: 'buildPlace', team: localTeam, tx, ty });
        ctx.placing = null;
        renderer.setGhost(null);
      } else {
        ctx.toast('Nu se poate plasa aici.', 'bad');
      }
    },
    startRallyPick() {
      ctx.pickingRally = true;
    },
    cancelRallyPick() {
      ctx.pickingRally = false;
    },
    setRallyAt(x, y) {
      ctx.queueCommand({ t: 'rally', team: localTeam, x, y });
      ctx.pickingRally = false;
      renderer.pulse({ x, y }, 'move');
    },
    toast() {
      /* suprascris mai jos, după crearea modulului de toasturi */
    },
    togglePause() {
      if (ctx.gameOver) return;
      ctx.paused = !ctx.paused;
    },
    setSpeed(s) {
      ctx.speed = s;
    },
  };

  if (import.meta.env.DEV) (window as unknown as { __fdf: UiContext }).__fdf = ctx;

  const toastsModule = initToasts(ctx);
  ctx.toast = (msg, kind) => toastsModule.push(msg, kind);

  const modules: UiModule[] = [
    toastsModule,
    initTopbar(ctx),
    initMinimap(ctx),
    initSelectionPanel(ctx),
    initBuildPanel(ctx),
    initMobileToolbar(ctx),
    initInput(ctx, canvas),
    initScreens(ctx),
  ];

  function pruneDeadSelection() {
    const before = ctx.selection.length;
    ctx.selection = ctx.selection.filter((id) => world.units.has(id) || world.buildings.has(id));
    if (ctx.selection.length !== before) renderer.setSelection(ctx.selection);
  }

  function trackStats(e: SimEvent) {
    switch (e.type) {
      case 'unitReady':
        if (e.team === localTeam) stats.unitsBuilt += 1;
        break;
      case 'destroyed':
        if (e.kind === 'unit' && e.team === localTeam) stats.unitsLost += 1;
        if (e.kind === 'building' && e.team !== localTeam) stats.buildingsDestroyed += 1;
        break;
      case 'unload':
        if (e.team === localTeam) stats.creditsEarned += e.amount;
        break;
      case 'underAttack':
        if (e.team === localTeam) ctx.lastEventPos = { x: e.x, y: e.y };
        break;
    }
  }

  function processTickEvents() {
    for (const e of world.events) {
      trackStats(e);
      if (e.type === 'gameOver') ctx.gameOver = true;
      for (const m of modules) m.handleEvent?.(e);
    }
  }

  const ro = new ResizeObserver(() => {
    const r = stage.getBoundingClientRect();
    renderer.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), Math.min(2, window.devicePixelRatio || 1));
  });
  ro.observe(stage);
  {
    const r = stage.getBoundingClientRect();
    renderer.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)), Math.min(2, window.devicePixelRatio || 1));
  }

  let acc = 0;
  let alpha = 0;
  let lastNow = performance.now();
  let rafId = 0;
  let destroyed = false;

  function frame(now: number) {
    if (destroyed) return;
    const dtSeconds = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;

    if (!ctx.paused && !ctx.gameOver) {
      acc += dtSeconds * ctx.speed;
      while (acc >= TICK_DT) {
        sim.step(world, pendingCommands);
        pendingCommands = [];
        pruneDeadSelection();
        processTickEvents();
        acc -= TICK_DT;
      }
      alpha = acc / TICK_DT;
    }

    for (const m of modules) m.update();
    renderer.render(world, alpha, dtSeconds);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    pause() {
      ctx.paused = true;
    },
    resume() {
      if (!ctx.gameOver) ctx.paused = false;
    },
    togglePause() {
      ctx.togglePause();
    },
    setSpeed(speed) {
      ctx.setSpeed(speed);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      for (const m of modules) m.dispose();
      renderer.dispose();
      root.innerHTML = '';
    },
  };
}
