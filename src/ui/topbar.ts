import type { UiContext, UiModule } from './context';
import { el, formatTime, clamp } from './dom';
import { iconSvg } from './icons';
import { TICK_RATE } from '../sim/types';

export function initTopbar(ctx: UiContext): UiModule {
  const bar = el('div', { attrs: { id: 'topbar' }, parent: ctx.root });

  const credits = el('div', { className: 'tb-stat', attrs: { id: 'tb-credits' }, parent: bar });
  credits.innerHTML = `${iconSvg('ore')}<b class="tabular">0</b>`;
  const creditsVal = credits.querySelector('b') as HTMLElement;

  const army = el('div', { className: 'tb-stat', attrs: { id: 'tb-army' }, parent: bar });
  army.innerHTML = `${iconSvg('army')}<b class="tabular">0</b>`;
  const armyVal = army.querySelector('b') as HTMLElement;

  el('div', { className: 'tb-sep', parent: bar });

  const wave = el('div', { className: 'tb-stat upper', attrs: { id: 'tb-wave' }, parent: bar });
  wave.innerHTML = `<span class="tb-label-long">Atac inamic în</span> <b class="tabular">--:--</b>`;
  const waveVal = wave.querySelector('b') as HTMLElement;

  const pauseBtn = el('button', { attrs: { id: 'pauseBtn', type: 'button', 'aria-label': 'Pauză' }, parent: bar });
  pauseBtn.innerHTML = iconSvg('pause');
  pauseBtn.addEventListener('click', () => ctx.togglePause());

  // credite afișate care "ticăie" lin spre valoarea reală, nu sar brusc
  let shownCredits = ctx.world.players.find((p) => p.team === ctx.localTeam)?.credits ?? 0;
  let lastNow = performance.now();

  function dispose() {
    bar.remove();
  }

  function update() {
    const now = performance.now();
    const dt = clamp((now - lastNow) / 1000, 0, 0.25);
    lastNow = now;

    const player = ctx.world.players.find((p) => p.team === ctx.localTeam);
    const real = player?.credits ?? 0;
    const diff = real - shownCredits;
    const rate = Math.max(1 - Math.pow(0.02, dt), 0.16); // converge lin, dar niciodată sub un prag minim pe cadru
    shownCredits += diff * rate;
    if (Math.abs(real - shownCredits) < 0.5) shownCredits = real;
    creditsVal.textContent = String(Math.round(shownCredits));

    const armyCount = Array.from(ctx.world.units.values()).filter(
      (u) => u.team === ctx.localTeam && u.type !== 'harvester'
    ).length;
    armyVal.textContent = String(armyCount);

    const left = ctx.world.waveTimer / TICK_RATE;
    waveVal.textContent = formatTime(left);
    wave.classList.toggle('hot', left < 20);

    pauseBtn.innerHTML = iconSvg(ctx.paused ? 'play' : 'pause');
  }

  return { update, dispose };
}
