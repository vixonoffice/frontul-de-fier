// Punctul central al UI-ului: bucla de joc cu tick fix, bufferul de comenzi, și asamblarea
// tuturor submodulelor (bară de sus, minihartă, panou de construcție, input, ecrane, sfaturi).
import { TICK_RATE, type Command, type Difficulty, type GameSetup, type SimAPI, type Team, type SimEvent } from '../sim/types';
import type { CreateRenderer } from '../render/api';
import type { UiContext, UiModule, GameStats } from './context';
import { el } from './dom';
import { initTopbar } from './topbar';
import { initMinimap } from './minimap';
import { initCommandBar } from './commandBar';
import { initDock } from './dock';
import { BUILDINGS, SELL_REFUND } from '../data/buildings';
import { minimapBigPref, setMinimapBigPref } from './prefs';
import { initQuickBar } from './quickBar';
import { initInput } from './input';
import { initScreens } from './screens';
import { initToasts } from './toasts';
import { initAudio } from './audio';
import { initTips } from './tips';
import { initGuardMarks } from './guardMarks';
import { initHelp } from './help';

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
  /** Dificultatea afișată pe ecranul de final (implicit cea a primului AI). */
  difficulty?: Difficulty;
  /** Sare peste ecranul de start (la "Joacă din nou"). */
  autoStart?: boolean;
  /** Cere pornirea unui meci nou, fără reîncărcarea paginii. */
  onRestart?: (difficulty: Difficulty) => void;
}

const TICK_DT = 1 / TICK_RATE;

export function startGame(opts: StartGameOptions): GameHandle {
  const { root, sim, createRenderer, setup, localTeam } = opts;

  root.innerHTML = '';
  root.classList.add('fdf-root');

  const world = sim.createWorld(setup);

  const stage = el('div', { attrs: { id: 'stage' }, parent: root });
  const canvas = el('canvas', { attrs: { id: 'gamecanvas' }, parent: stage });
  const bottom = el('div', { attrs: { id: 'hudBottom' }, parent: stage });
  const renderer = createRenderer(canvas);
  renderer.setLocalTeam(localTeam);
  for (const b of world.buildings.values()) {
    if (b.team === localTeam && b.type === 'hq') renderer.centerOn({ x: b.tx + 1.5, y: b.ty + 1.5 });
  }

  const isTouch = (matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

  let pendingCommands: Command[] = [];
  const cmdListeners: ((c: Command) => void)[] = [];

  const stats: GameStats = { startTick: 0, unitsBuilt: 0, unitsLost: 0, buildingsDestroyed: 0, creditsEarned: 0 };
  const aiDiff = world.players.find((p) => p.isAI)?.difficulty ?? 'easy';

  function myBuildings() {
    return Array.from(world.buildings.values()).filter((b) => b.team === localTeam);
  }

  const ctx: UiContext = {
    root,
    stageEl: stage,
    bottomEl: bottom,
    sim,
    renderer,
    localTeam,
    isTouch,
    world,
    stats,
    paused: !opts.autoStart, // pornește pe ecranul de start; "Începe" îl dezactivează
    gameOver: false,
    started: !!opts.autoStart,
    helpOpen: false,
    difficulty: opts.difficulty ?? aiDiff,
    speed: 1,
    tool: null,
    placing: null,
    trayTab: null,
    trainCount: 1,
    minimapBig: minimapBigPref(),
    ghostFlash: null,
    selection: [],
    groups: new Map(),
    lastEventPos: null,

    queueCommand(cmd) {
      pendingCommands.push(cmd);
      for (const cb of cmdListeners) cb(cmd);
    },
    onCommand(cb) {
      cmdListeners.push(cb);
    },
    setSelection(ids) {
      ctx.selection = ids;
      renderer.setSelection(ids);
    },
    setTool(t) {
      ctx.tool = t;
      if (t) ctx.cancelPlacing();
    },
    startPlacing(type) {
      ctx.placing = type;
      ctx.tool = null;
      ctx.trayTab = null;
    },
    cancelPlacing() {
      ctx.placing = null;
      ctx.ghostFlash = null;
      renderer.setGhost(null);
    },
    tryPlaceAt(tx, ty) {
      const type = ctx.placing;
      if (!type) return false;
      if (sim.canPlace(world, localTeam, type, tx, ty)) {
        ctx.queueCommand({ t: 'buildPlace', team: localTeam, tx, ty });
        ctx.cancelPlacing();
        ctx.sfx('ok');
        return true;
      }
      ctx.sfx('error');
      ctx.toast('Nu se poate aici.', 'bad');
      ctx.ghostFlash = { tx, ty, until: performance.now() + 700 };
      return false;
    },
    openTray(t) {
      ctx.trayTab = t;
    },
    closeTray() {
      ctx.trayTab = null;
    },
    setMinimapBig(b) {
      ctx.minimapBig = b;
      setMinimapBigPref(b);
    },
    sellValue(id) {
      const b = world.buildings.get(id);
      if (!b || b.type === 'hq') return 0;
      return Math.floor(BUILDINGS[b.type].cost * SELL_REFUND * Math.max(0, Math.min(1, b.hp / b.maxHp)));
    },
    sell(id) {
      const b = world.buildings.get(id);
      if (!b || b.team !== localTeam || b.type === 'hq') return;
      ctx.queueCommand({ t: 'sell', team: localTeam, id });
    },
    selectArmy() {
      const ids = Array.from(world.units.values())
        .filter((u) => u.team === localTeam && u.type !== 'harvester')
        .map((u) => u.id);
      if (!ids.length) {
        ctx.toast('Încă n-ai trupe. Antrenează soldați sau tancuri.', 'bad');
        ctx.sfx('error');
        return;
      }
      ctx.setSelection(ids);
    },
    idleHarvesters() {
      return Array.from(world.units.values())
        .filter((u) => u.team === localTeam && u.type === 'harvester' && u.order.kind === 'idle')
        .map((u) => u.id);
    },
    selectIdleHarvesters() {
      const ids = ctx.idleHarvesters();
      if (!ids.length) return;
      ctx.setSelection(ids);
      const u = world.units.get(ids[0]);
      if (u) renderer.centerOn({ x: u.x, y: u.y });
    },
    centerBase() {
      const mine = myBuildings();
      const hq = mine.find((b) => b.type === 'hq') ?? mine[0];
      if (hq) renderer.centerOn({ x: hq.tx + hq.w / 2, y: hq.ty + hq.h / 2 });
    },
    toast() {
      /* suprascris mai jos, după crearea modulului de toasturi */
    },
    sfx() {
      /* suprascris de modulul audio */
    },
    togglePause() {
      if (ctx.gameOver) return;
      ctx.paused = !ctx.paused;
    },
    setSpeed(s) {
      ctx.speed = s;
    },
    setDifficulty(d) {
      ctx.difficulty = d;
      for (const p of world.players) if (p.isAI) p.difficulty = d;
    },
    restart() {
      if (opts.onRestart) opts.onRestart(ctx.difficulty);
      else location.reload();
    },
  };

  if (import.meta.env.DEV) (window as unknown as { __fdf: UiContext }).__fdf = ctx;

  const toastsModule = initToasts(ctx);
  ctx.toast = (msg, kind) => toastsModule.push(msg, kind);

  const audio = initAudio(ctx);

  const modules: UiModule[] = [
    toastsModule,
    audio,
    initTopbar(ctx),
    initMinimap(ctx),
    initQuickBar(ctx),
    initCommandBar(ctx),
    initDock(ctx),
    initGuardMarks(ctx),
    initInput(ctx, canvas),
    initHelp(ctx),
    initTips(ctx),
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
      for (const m of modules) {
        try { m.handleEvent?.(e); } catch (err) { console.error(err); }
      }
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

    for (const m of modules) {
      try { m.update(); } catch (err) { console.error(err); }
    }
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
