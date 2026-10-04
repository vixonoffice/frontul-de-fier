import type { UiContext, UiModule } from './context';
import { el, formatTime } from './dom';
import { iconSvg } from './icons';
import { TICK_RATE, type Difficulty, type SimEvent, type Team } from '../sim/types';
import { tipsEnabled, setTipsEnabled, matchPrefs, type MatchPrefs, type MapChoice } from './prefs';

export const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Ușor', normal: 'Normal', hard: 'Greu' };
export const TEAM_NAME: Record<number, string> = { 0: 'Albastru', 1: 'Roșu', 2: 'Galben', 3: 'Verde' };
const MAP_LABEL: Record<MapChoice, string> = { random: 'La întâmplare', open: 'Câmpie', passes: 'Trecători', lakes: 'Lacuri', islands: 'Insule' };
const MAPS: MapChoice[] = ['random', 'open', 'passes', 'lakes', 'islands'];

export function initScreens(ctx: UiContext): UiModule {
  let ended = false;
  const sel: MatchPrefs = { ...matchPrefs() };

  // ---------------- ecran de start: "Meci nou" ----------------
  const startScreen = el('div', { className: 'screen', attrs: { id: 'startScreen' }, parent: ctx.root });
  if (!ctx.started) startScreen.classList.add('show');
  const startCard = el('div', { className: 'screen-card setup', parent: startScreen });
  el('h1', { html: 'FRONTUL <span>DE FIER</span>', parent: startCard });
  el('div', { className: 'plate', html: `${iconSvg('hq')}<span>Meci nou · tu ești albastru</span>`, parent: startCard });

  /** Un rând cu butoane mari, dintre care unul e ales. */
  function segment<T extends string | number>(label: string, items: { v: T; text: string }[], get: () => T, set: (v: T) => void, id: string, wrap = false) {
    el('div', { className: 'field-label', text: label, parent: startCard });
    const row = el('div', { className: wrap ? 'seg wrap' : 'seg', attrs: { role: 'radiogroup', id }, parent: startCard });
    const btns: HTMLButtonElement[] = [];
    const paint = () => items.forEach((it, i) => {
      btns[i].classList.toggle('sel', it.v === get());
      btns[i].setAttribute('aria-checked', it.v === get() ? 'true' : 'false');
    });
    items.forEach((it) => {
      const b = el('button', { className: 'seg-btn', text: it.text, attrs: { type: 'button', role: 'radio', 'data-v': String(it.v) }, parent: row }) as HTMLButtonElement;
      b.addEventListener('click', () => {
        ctx.sfx('click');
        set(it.v);
        paint();
      });
      btns.push(b);
    });
    paint();
  }
  segment('Adversari', [1, 2, 3].map((n) => ({ v: n as 1 | 2 | 3, text: String(n) })), () => sel.opponents, (v) => (sel.opponents = v), 'segOpp');
  segment('Dificultate', (['easy', 'normal', 'hard'] as Difficulty[]).map((d) => ({ v: d, text: DIFF_LABEL[d] })), () => sel.difficulty, (v) => (sel.difficulty = v), 'segDiff');
  segment('Hartă', MAPS.map((m) => ({ v: m, text: MAP_LABEL[m] })), () => sel.map, (v) => (sel.map = v), 'segMap', true);
  segment('Mărime', ([[64, 'Mică'], [80, 'Medie'], [96, 'Mare']] as [64 | 80 | 96, string][]).map(([v, text]) => ({ v, text })), () => sel.size, (v) => (sel.size = v), 'segSize');

  function toggle(label: string, id: string, init: boolean, onChange: (v: boolean) => void): () => boolean {
    const sw = el('button', { className: 'switch', attrs: { type: 'button', role: 'switch', id }, parent: startCard }) as HTMLButtonElement;
    sw.innerHTML = `<i class="knob"></i><span>${label}</span><b></b>`;
    let v = init;
    const paint = () => {
      sw.classList.toggle('on', v);
      sw.setAttribute('aria-checked', v ? 'true' : 'false');
      (sw.querySelector('b') as HTMLElement).textContent = v ? 'Da' : 'Nu';
    };
    paint();
    sw.addEventListener('click', () => {
      ctx.sfx(v ? 'off' : 'on');
      v = !v;
      paint();
      onChange(v);
    });
    return () => v;
  }
  let wantTips = tipsEnabled();
  toggle('Arată-mi cum se joacă', 'startTips', wantTips, (v) => (wantTips = v));
  let wantAssist = false;
  toggle('Pornește cu asistentul de dezvoltare', 'startAssist', false, (v) => (wantAssist = v));

  const startBtn = el('button', { className: 'btn-primary', attrs: { type: 'button', id: 'startBtn' }, parent: startCard }) as HTMLButtonElement;
  startBtn.innerHTML = `${iconSvg('play')}<span>Începe</span>`;
  startBtn.addEventListener('click', () => {
    ctx.sfx('ok');
    if (wantTips !== tipsEnabled()) setTipsEnabled(wantTips);
    startScreen.classList.remove('show');
    // meciul se construiește din alegeri, cu sămânță proaspătă
    ctx.startMatch({ ...sel }, { assist: wantAssist });
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
  const seedLine = el('div', { className: 'seed-line tabular', parent: endCard });
  const again = el('button', { className: 'btn-primary', attrs: { type: 'button', id: 'againBtn' }, parent: endCard }) as HTMLButtonElement;
  again.innerHTML = `${iconSvg('play')}<span>Joacă din nou</span>`;
  again.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.restart('new');
  });
  const endRow = el('div', { className: 'end-row', parent: endCard });
  const same = el('button', { className: 'btn-mil', text: 'Aceeași hartă', attrs: { type: 'button', id: 'sameBtn' }, parent: endRow });
  same.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.restart('same');
  });
  const setup = el('button', { className: 'btn-mil', text: 'Schimbă setările', attrs: { type: 'button', id: 'setupBtn' }, parent: endRow });
  setup.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.restart('setup');
  });

  function stat(label: string, value: string): string {
    return `<div class="st"><div class="v tabular">${value}</div><div class="k">${label}</div></div>`;
  }

  function showEnd(winner: Team | null) {
    ended = true;
    ctx.paused = true;
    const won = winner === ctx.localTeam;
    const multi = ctx.world.players.length > 2;
    endTitle.className = won ? '' : 'defeat';
    endTitle.innerHTML = won ? 'VICTORIE' : 'BAZA <span>A CĂZUT</span>';
    endText.textContent = won
      ? `Ai rămas ultimul în picioare, în ${formatTime(ctx.world.tick / TICK_RATE)}.`
      : multi && winner !== null
        ? `Ai fost eliminat. ${TEAM_NAME[winner]} a câștigat.`
        : 'Ai fost eliminat.';
    statGrid.innerHTML =
      stat('Dificultate', DIFF_LABEL[ctx.difficulty]) +
      stat('Adversari', String(ctx.world.players.length - 1)) +
      stat('Timp', formatTime(ctx.world.tick / TICK_RATE)) +
      stat('Unități produse', String(ctx.stats.unitsBuilt)) +
      stat('Unități pierdute', String(ctx.stats.unitsLost)) +
      stat('Clădiri distruse', String(ctx.stats.buildingsDestroyed)) +
      stat('Credite câștigate', String(Math.round(ctx.stats.creditsEarned)));
    seedLine.textContent = `Harta #${ctx.seed}`;
    endScreen.classList.add('show');
  }

  function handleEvent(e: SimEvent) {
    if (e.type === 'gameOver' && !ended) showEnd(e.winner);
  }

  function update() {
    if (!ctx.started) return;
    // eliminat cât ceilalți încă se luptă: înfrângerea se arată imediat
    if (!ended) {
      const me = ctx.world.players.find((p) => p.team === ctx.localTeam);
      if (me?.defeated) {
        const alive = ctx.world.players.filter((p) => !p.defeated);
        showEnd(alive.length === 1 ? alive[0].team : null);
      }
    }
    pauseScreen.classList.toggle('show', ctx.paused && !ended && !ctx.helpOpen);
  }

  function dispose() {
    startScreen.remove();
    pauseScreen.remove();
    endScreen.remove();
  }

  return { update, dispose, handleEvent };
}
