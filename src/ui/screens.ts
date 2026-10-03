import type { UiContext, UiModule } from './context';
import { el, formatTime } from './dom';
import { TICK_RATE, type Difficulty, type SimEvent, type Team } from '../sim/types';

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Ușor', normal: 'Normal', hard: 'Greu' };

export function initScreens(ctx: UiContext): UiModule {
  let matchStarted = false;
  let ended = false;

  // ---------------- ecran de start ----------------
  const startScreen = el('div', { className: 'screen show', attrs: { id: 'startScreen' }, parent: ctx.root });
  const startCard = el('div', { className: 'screen-card', parent: startScreen });
  el('h1', { html: 'FRONTUL <span>DE FIER</span>', parent: startCard });
  el('p', { text: 'Tu ești echipa albastră. Calculatorul te atacă în valuri — apără-ți baza și distruge-i clădirile.', parent: startCard });

  el('div', { className: 'upper', html: '<span style="font-size:11px;color:var(--mut)">Dificultate</span>', parent: startCard });
  const diffRow = el('div', { className: 'diff-row', parent: startCard });
  let chosen: Difficulty = 'normal';
  const diffBtns: Record<Difficulty, HTMLButtonElement> = {} as Record<Difficulty, HTMLButtonElement>;
  (['easy', 'normal', 'hard'] as Difficulty[]).forEach((d) => {
    const b = el('button', { className: 'diff-btn', text: DIFF_LABEL[d], attrs: { type: 'button' }, parent: diffRow }) as HTMLButtonElement;
    b.classList.toggle('sel', d === chosen);
    b.addEventListener('click', () => {
      chosen = d;
      (['easy', 'normal', 'hard'] as Difficulty[]).forEach((k) => diffBtns[k].classList.toggle('sel', k === d));
      for (const p of ctx.world.players) if (p.isAI) p.difficulty = chosen;
    });
    diffBtns[d] = b;
  });

  const helpMouse = el('ol', { parent: startCard });
  helpMouse.innerHTML = `
    <li>Click stânga selectezi o unitate sau tragi un chenar peste mai multe.</li>
    <li>Click dreapta dă ordinul potrivit: atac pe inamic, recoltare pe minereu, mișcare pe teren liber.</li>
    <li>Construiește o Fabrică, apoi tancuri, din panoul din dreapta.</li>
    <li>Câștigi când distrugi toate clădirile inamicului.</li>
  `;
  const helpTouch = el('ol', { parent: startCard });
  helpTouch.innerHTML = `
    <li>Atinge o unitate ca s-o selectezi, apoi atinge ținta pentru ordinul potrivit.</li>
    <li>O apăsare lungă urmată de tragere face o selecție cu chenar.</li>
    <li>Construiește din sertarul de jos: Fabrică, apoi tancuri.</li>
    <li>Câștigi când distrugi toate clădirile inamicului.</li>
  `;
  helpTouch.style.display = ctx.isTouch ? '' : 'none';
  helpMouse.style.display = ctx.isTouch ? 'none' : '';

  const startBtn = el('button', { className: 'btn-primary', text: 'Începe', attrs: { type: 'button' }, parent: startCard });
  startBtn.addEventListener('click', () => {
    matchStarted = true;
    startScreen.classList.remove('show');
    ctx.paused = false;
  });

  // ---------------- ecran de pauză ----------------
  const pauseScreen = el('div', { className: 'screen', attrs: { id: 'pauseScreen' }, parent: ctx.root });
  const pauseCard = el('div', { className: 'screen-card', parent: pauseScreen });
  el('h1', { text: 'Pauză', parent: pauseCard });
  el('p', { text: 'Jocul e oprit. Apasă Reluare sau tasta P / F10.', parent: pauseCard });
  const resumeBtn = el('button', { className: 'btn-primary', text: 'Reluare', attrs: { type: 'button' }, parent: pauseCard });
  resumeBtn.addEventListener('click', () => ctx.togglePause());

  // ---------------- ecran de final ----------------
  const endScreen = el('div', { className: 'screen', attrs: { id: 'endScreen' }, parent: ctx.root });
  const endCard = el('div', { className: 'screen-card', parent: endScreen });
  const endTitle = el('h1', { parent: endCard });
  const endText = el('p', { parent: endCard });
  const statGrid = el('div', { className: 'stat-grid', parent: endCard });
  const again = el('button', { className: 'btn-primary', text: 'Joacă din nou', attrs: { type: 'button' }, parent: endCard });
  again.addEventListener('click', () => location.reload());

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
    if (!matchStarted) return;
    pauseScreen.classList.toggle('show', ctx.paused && !ended);
  }

  function dispose() {
    startScreen.remove();
    pauseScreen.remove();
    endScreen.remove();
  }

  return { update, dispose, handleEvent };
}
