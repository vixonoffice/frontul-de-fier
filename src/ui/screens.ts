import type { UiContext, UiModule } from './context';
import { el, formatTime } from './dom';
import { iconSvg } from './icons';
import { TICK_RATE, type Difficulty, type SimEvent, type Team } from '../sim/types';
import { tipsEnabled, setTipsEnabled } from './prefs';

export const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Ușor', normal: 'Normal', hard: 'Greu' };
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

export function initScreens(ctx: UiContext): UiModule {
  let ended = false;

  // ---------------- ecran de start ----------------
  const startScreen = el('div', { className: 'screen', attrs: { id: 'startScreen' }, parent: ctx.root });
  if (!ctx.started) startScreen.classList.add('show');
  const startCard = el('div', { className: 'screen-card', parent: startScreen });
  el('div', { className: 'plate', html: `${iconSvg('hq')}<span>Comandament · Echipa albastră</span>`, parent: startCard });
  el('h1', { html: 'FRONTUL <span>DE FIER</span>', parent: startCard });
  el('p', {
    text: 'Calculatorul te atacă în valuri. Construiește o economie, fă o armată și distruge toate clădirile inamicului.',
    parent: startCard,
  });

  el('div', { className: 'field-label', text: 'Dificultate', parent: startCard });
  const diffRow = el('div', { className: 'diff-row', attrs: { role: 'radiogroup' }, parent: startCard });
  const diffBtns = {} as Record<Difficulty, HTMLButtonElement>;
  for (const d of DIFFS) {
    const b = el('button', { className: 'diff-btn', text: DIFF_LABEL[d], attrs: { type: 'button', role: 'radio' }, parent: diffRow }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      ctx.sfx('click');
      ctx.setDifficulty(d);
      for (const k of DIFFS) {
        diffBtns[k].classList.toggle('sel', k === d);
        diffBtns[k].setAttribute('aria-checked', k === d ? 'true' : 'false');
      }
    });
    diffBtns[d] = b;
  }
  for (const k of DIFFS) {
    diffBtns[k].classList.toggle('sel', k === ctx.difficulty);
    diffBtns[k].setAttribute('aria-checked', k === ctx.difficulty ? 'true' : 'false');
  }

  const tipsSwitch = el('button', { className: 'switch', attrs: { type: 'button', role: 'switch', id: 'startTips' }, parent: startCard }) as HTMLButtonElement;
  tipsSwitch.innerHTML = '<i class="knob"></i><span>Arată-mi cum se joacă</span><b></b>';
  let wantTips = tipsEnabled();
  const syncTips = () => {
    tipsSwitch.classList.toggle('on', wantTips);
    tipsSwitch.setAttribute('aria-checked', wantTips ? 'true' : 'false');
    (tipsSwitch.querySelector('b') as HTMLElement).textContent = wantTips ? 'Da' : 'Nu';
  };
  syncTips();
  tipsSwitch.addEventListener('click', () => {
    ctx.sfx('click');
    wantTips = !wantTips;
    syncTips();
  });

  const startBtn = el('button', { className: 'btn-primary', attrs: { type: 'button', id: 'startBtn' }, parent: startCard }) as HTMLButtonElement;
  startBtn.innerHTML = `${iconSvg('play')}<span>Începe</span>`;
  startBtn.addEventListener('click', () => {
    ctx.sfx('ok');
    if (wantTips !== tipsEnabled()) setTipsEnabled(wantTips);
    ctx.started = true;
    startScreen.classList.remove('show');
    ctx.paused = false;
  });

  // ---------------- ecran de pauză ----------------
  const pauseScreen = el('div', { className: 'screen', attrs: { id: 'pauseScreen' }, parent: ctx.root });
  const pauseCard = el('div', { className: 'screen-card', parent: pauseScreen });
  el('h1', { text: 'Pauză', parent: pauseCard });
  el('p', { text: 'Jocul e oprit. Apasă Reluare sau tasta P / F10.', parent: pauseCard });
  const resumeBtn = el('button', { className: 'btn-primary', attrs: { type: 'button', id: 'resumeBtn' }, parent: pauseCard }) as HTMLButtonElement;
  resumeBtn.innerHTML = `${iconSvg('play')}<span>Reluare</span>`;
  resumeBtn.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.togglePause();
  });

  // ---------------- ecran de final ----------------
  const endScreen = el('div', { className: 'screen', attrs: { id: 'endScreen' }, parent: ctx.root });
  const endCard = el('div', { className: 'screen-card', parent: endScreen });
  const endTitle = el('h1', { parent: endCard });
  const endText = el('p', { parent: endCard });
  const statGrid = el('div', { className: 'stat-grid', parent: endCard });
  const again = el('button', { className: 'btn-primary', attrs: { type: 'button', id: 'againBtn' }, parent: endCard }) as HTMLButtonElement;
  again.innerHTML = `${iconSvg('play')}<span>Joacă din nou</span>`;
  again.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.restart();
  });

  function stat(label: string, value: string): string {
    return `<div class="st"><div class="v tabular">${value}</div><div class="k">${label}</div></div>`;
  }

  function showEnd(winner: Team) {
    ended = true;
    ctx.paused = true;
    const won = winner === ctx.localTeam;
    endTitle.className = won ? '' : 'defeat';
    endTitle.innerHTML = won ? 'VICTORIE' : 'BAZA <span>A CĂZUT</span>';
    endText.textContent = won
      ? `Ai distrus toate clădirile inamice în ${formatTime(ctx.world.tick / TICK_RATE)}.`
      : 'Inamicul ți-a distrus toate clădirile.';
    statGrid.innerHTML =
      stat('Dificultate', DIFF_LABEL[ctx.difficulty]) +
      stat('Timp', formatTime(ctx.world.tick / TICK_RATE)) +
      stat('Unități produse', String(ctx.stats.unitsBuilt)) +
      stat('Unități pierdute', String(ctx.stats.unitsLost)) +
      stat('Clădiri distruse', String(ctx.stats.buildingsDestroyed)) +
      stat('Credite câștigate', String(Math.round(ctx.stats.creditsEarned)));
    endScreen.classList.add('show');
  }

  function handleEvent(e: SimEvent) {
    if (e.type === 'gameOver' && !ended) showEnd(e.winner);
  }

  function update() {
    if (!ctx.started) return;
    pauseScreen.classList.toggle('show', ctx.paused && !ended && !ctx.helpOpen);
  }

  function dispose() {
    startScreen.remove();
    pauseScreen.remove();
    endScreen.remove();
  }

  return { update, dispose, handleEvent };
}
