// Colțul stânga-sus al scenei: "Toată armata", "Bază" și alertele atinse-ca-să-mergi
// (baza atacată, recoltoare care stau degeaba).
import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import type { SimEvent, Vec } from '../sim/types';

const IDLE_SHOW_MS = 2500;
const ATTACK_SHOW_MS = 14000;

export function initQuickBar(ctx: UiContext): UiModule {
  const box = el('div', { attrs: { id: 'quickBar' }, parent: ctx.stageEl });
  const row = el('div', { className: 'qb-row', parent: box });

  const armyBtn = el('button', { className: 'btn-mil', attrs: { type: 'button', id: 'qa-army' }, parent: row }) as HTMLButtonElement;
  armyBtn.innerHTML = `${iconSvg('army')}<span>Toată armata</span>`;
  armyBtn.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.selectArmy();
  });
  const homeBtn = el('button', { className: 'btn-mil', attrs: { type: 'button', id: 'qa-home' }, parent: row }) as HTMLButtonElement;
  homeBtn.innerHTML = `${iconSvg('home')}<span>Bază</span>`;
  homeBtn.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.centerBase();
  });

  const chips = el('div', { className: 'qb-chips', parent: box });
  const attackChip = el('button', { className: 'chip bad', attrs: { type: 'button', id: 'chipAttack' }, parent: chips }) as HTMLButtonElement;
  attackChip.innerHTML = `${iconSvg('alert')}<span>Baza e atacată! Atinge ca să vezi</span>`;
  const idleChip = el('button', { className: 'chip warn', attrs: { type: 'button', id: 'chipIdle' }, parent: chips }) as HTMLButtonElement;
  idleChip.innerHTML = `${iconSvg('harvester')}<span></span>`;
  const idleTxt = idleChip.querySelector('span') as HTMLElement;
  attackChip.style.display = 'none';
  idleChip.style.display = 'none';

  let attackUntil = 0;
  let attackPos: Vec | null = null;
  let idleSince = 0;

  attackChip.addEventListener('click', () => {
    ctx.sfx('click');
    const p = attackPos ?? ctx.lastEventPos;
    if (p) ctx.renderer.centerOn(p);
    attackUntil = 0;
  });
  idleChip.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.selectIdleHarvesters();
    ctx.setTool('harvest');
  });

  function handleEvent(e: SimEvent) {
    if (e.type === 'underAttack' && e.team === ctx.localTeam) {
      attackUntil = performance.now() + ATTACK_SHOW_MS;
      attackPos = { x: e.x, y: e.y };
    }
  }

  let lastIdleN = -1;
  function update() {
    const now = performance.now();
    const showAttack = now < attackUntil && !ctx.gameOver;
    if (attackChip.style.display !== (showAttack ? '' : 'none')) attackChip.style.display = showAttack ? '' : 'none';

    const n = ctx.started && !ctx.paused ? ctx.idleHarvesters().length : 0;
    if (n === 0) idleSince = 0;
    else if (!idleSince) idleSince = now;
    const showIdle = n > 0 && now - idleSince > IDLE_SHOW_MS;
    if (idleChip.style.display !== (showIdle ? '' : 'none')) idleChip.style.display = showIdle ? '' : 'none';
    if (showIdle && n !== lastIdleN) {
      lastIdleN = n;
      idleTxt.textContent = n === 1 ? '1 recoltor stă degeaba' : `${n} recoltoare stau degeaba`;
    }
  }

  function dispose() {
    box.remove();
  }
  return { update, dispose, handleEvent };
}
