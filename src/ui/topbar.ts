import type { UiContext, UiModule } from './context';
import { el, formatTime, clamp } from './dom';
import { iconSvg } from './icons';
import { TICK_RATE } from '../sim/types';
import { soundPrefs, setSoundPrefs, onSoundChange } from './prefs';
import { TEAM_NAME } from './screens';

const TEAM_CSS: Record<number, string> = { 0: '#3d9bff', 1: '#ff4a3a', 2: '#ffd23a', 3: '#54d17a' };

/** Un singur rând subțire: credite, curent, timer, (jucători), sunet, ajutor, pauză. */
export function initTopbar(ctx: UiContext): UiModule {
  const bar = el('div', { attrs: { id: 'topbar' }, parent: ctx.root });

  const credits = el('div', { className: 'tb-stat', attrs: { id: 'tb-credits', title: 'Credite' }, parent: bar });
  credits.innerHTML = `${iconSvg('coin')}<b class="tabular">0</b>`;
  const creditsVal = credits.querySelector('b') as HTMLElement;

  // contor de curent: produs / folosit; roșu și pulsează când lipsește
  const power = el('button', { className: 'tb-stat tb-power', attrs: { id: 'tb-power', type: 'button', 'aria-label': 'Curent' }, parent: bar }) as HTMLButtonElement;
  power.innerHTML = `${iconSvg('bolt')}<b class="tabular">0/0</b>`;
  const powerVal = power.querySelector('b') as HTMLElement;
  power.addEventListener('click', () => {
    const p = ctx.world.players.find((q) => q.team === ctx.localTeam);
    const made = p?.power?.made ?? 0;
    const used = p?.power?.used ?? 0;
    if (used > made) ctx.toast('Curent insuficient: producția și turelele merg la jumătate. Construiește o Centrală.', 'bad');
    else ctx.toast(`Curent: produci ${made}, folosești ${used}. Fiecare clădire consumă; Centrala produce.`);
  });

  const wave = el('div', { className: 'tb-stat', attrs: { id: 'tb-wave', title: 'Următorul atac inamic' }, parent: bar });
  wave.innerHTML = `<b class="tabular">--:--</b>`;
  const waveVal = wave.querySelector('b') as HTMLElement;

  el('div', { className: 'tb-sep', parent: bar });

  // câți jucători au rămas (doar la mai mult de 2 jucători)
  const others = ctx.world.players.filter((p) => p.team !== ctx.localTeam);
  const playersBtn = el('button', { className: 'tb-players', attrs: { id: 'tb-players', type: 'button', 'aria-label': 'Jucători' }, parent: bar }) as HTMLButtonElement;
  const dots = others.map((p) => {
    const d = el('i', { parent: playersBtn });
    d.style.setProperty('--c', TEAM_CSS[p.team] ?? '#ccc');
    return d;
  });
  playersBtn.style.display = ctx.world.players.length > 2 ? '' : 'none';
  playersBtn.addEventListener('click', () => {
    const parts = others.map((p) => `${TEAM_NAME[p.team]}: ${ctx.world.players[p.team]?.defeated ? 'eliminat' : 'în joc'}`);
    ctx.toast(`Toți sunt împotriva tuturor. ${parts.join(' · ')}`);
  });
  const wasDefeated = new Set<number>();

  const muteBtn = el('button', { className: 'btn-sq', attrs: { id: 'muteBtn', type: 'button', 'aria-label': 'Sunet' }, parent: bar }) as HTMLButtonElement;
  const paintMute = () => {
    const m = soundPrefs().mute;
    muteBtn.innerHTML = iconSvg(m ? 'speakerOff' : 'speaker');
    muteBtn.classList.toggle('muted', m);
    muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
  };
  paintMute();
  const unsub = onSoundChange(paintMute);
  muteBtn.addEventListener('click', () => {
    const m = !soundPrefs().mute;
    setSoundPrefs({ mute: m });
    if (!m) ctx.sfx('on');
  });

  const helpBtn = el('button', { className: 'btn-sq', attrs: { id: 'helpBtn', type: 'button', 'aria-label': 'Ajutor' }, parent: bar }) as HTMLButtonElement;
  helpBtn.innerHTML = '<span class="q">?</span>';
  helpBtn.addEventListener('click', () => {
    ctx.root.dispatchEvent(new CustomEvent('fdf-help'));
  });

  const pauseBtn = el('button', { className: 'btn-sq', attrs: { id: 'pauseBtn', type: 'button', 'aria-label': 'Pauză' }, parent: bar }) as HTMLButtonElement;
  pauseBtn.innerHTML = iconSvg('pause');
  pauseBtn.addEventListener('click', () => ctx.togglePause());

  // credite afișate care "ticăie" lin spre valoarea reală, nu sar brusc
  let shownCredits = ctx.world.players.find((p) => p.team === ctx.localTeam)?.credits ?? 0;
  let lastNow = performance.now();
  let lastIcon = '';

  function dispose() {
    unsub();
    bar.remove();
  }

  function update() {
    const now = performance.now();
    const dt = clamp((now - lastNow) / 1000, 0, 0.25);
    lastNow = now;

    const player = ctx.world.players.find((p) => p.team === ctx.localTeam);
    const real = player?.credits ?? 0;
    const diff = real - shownCredits;
    const rate = Math.max(1 - Math.pow(0.02, dt), 0.16);
    shownCredits += diff * rate;
    if (Math.abs(real - shownCredits) < 0.5) shownCredits = real;
    creditsVal.textContent = String(Math.round(shownCredits));

    const made = Math.round(player?.power?.made ?? 0);
    const used = Math.round(player?.power?.used ?? 0);
    const txt = `${used}/${made}`;
    if (powerVal.textContent !== txt) powerVal.textContent = txt;
    const low = used > made;
    power.classList.toggle('low', low);
    power.classList.toggle('idle', made === 0 && used === 0);

    const left = ctx.world.waveTimer / TICK_RATE;
    waveVal.textContent = formatTime(left);
    wave.classList.toggle('hot', left < 20);

    // jucători eliminați
    others.forEach((p, i) => {
      const dead = !!ctx.world.players[p.team]?.defeated;
      dots[i].classList.toggle('dead', dead);
      if (dead && !wasDefeated.has(p.team)) {
        wasDefeated.add(p.team);
        if (ctx.started) {
          ctx.toast(`${TEAM_NAME[p.team]} a fost eliminat`);
          ctx.sfx('ok');
        }
      }
    });

    const icon = ctx.paused ? 'play' : 'pause';
    if (icon !== lastIcon) {
      lastIcon = icon;
      pauseBtn.innerHTML = iconSvg(icon);
    }
  }

  return { update, dispose };
}
