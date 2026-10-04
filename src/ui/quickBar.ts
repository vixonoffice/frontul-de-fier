// Alerte mici sub bara de sus (stânga): baza atacată, recoltoare care stau degeaba.
// Dispar singure după câteva secunde; se pot atinge ca să mergi acolo.
import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import type { SimEvent, Vec } from '../sim/types';

const IDLE_WAIT_MS = 2500;
const IDLE_SHOW_MS = 7000;
const IDLE_REPEAT_MS = 45000;
const ATTACK_SHOW_MS = 7000;

export function initQuickBar(ctx: UiContext): UiModule {
  const box = el('div', { attrs: { id: 'quickBar' }, parent: ctx.stageEl });
  const chips = el('div', { className: 'qb-chips', parent: box });
  const attackChip = el('button', { className: 'chip bad', attrs: { type: 'button', id: 'chipAttack' }, parent: chips }) as HTMLButtonElement;
  attackChip.innerHTML = `${iconSvg('alert')}<span>Baza e atacată!</span>`;
  const idleChip = el('button', { className: 'chip warn', attrs: { type: 'button', id: 'chipIdle' }, parent: chips }) as HTMLButtonElement;
  idleChip.innerHTML = `${iconSvg('harvester')}<span></span>`;
  const idleTxt = idleChip.querySelector('span') as HTMLElement;
  attackChip.style.display = 'none';
  idleChip.style.display = 'none';

  let attackUntil = 0;
  let attackPos: Vec | null = null;
  let idleSince = 0;
  let lastIdleN = 0;
  let idleHideAt = 0;
  let idleNextAt = 0;

  attackChip.addEventListener('click', () => {
    ctx.sfx('click');
    const p = attackPos ?? ctx.lastEventPos;
    if (p) ctx.renderer.centerOn(p);
    attackUntil = 0;
  });
  idleChip.addEventListener('click', () => {
    ctx.sfx('click');
    idleHideAt = 0;
    ctx.selectIdleHarvesters();
    ctx.setTool('harvest');
  });

  function handleEvent(e: SimEvent) {
    if (e.type === 'underAttack' && e.team === ctx.localTeam) {
      attackUntil = performance.now() + ATTACK_SHOW_MS;
      attackPos = { x: e.x, y: e.y };
    }
  }

  function update() {
    const now = performance.now();
    const showAttack = now < attackUntil && !ctx.gameOver;
    if (attackChip.style.display !== (showAttack ? '' : 'none')) attackChip.style.display = showAttack ? '' : 'none';

    const n = ctx.started && !ctx.paused ? ctx.idleHarvesters().length : 0;
    if (n === 0) {
      idleSince = 0;
      idleHideAt = 0;
      lastIdleN = 0;
    } else if (!idleSince) idleSince = now;
    // apare după o pauză, stă câteva secunde, reapare dacă mai sunt degeaba după un timp sau cresc la număr
    if (n > 0 && now - idleSince > IDLE_WAIT_MS && now >= idleNextAt && !idleHideAt) {
      idleHideAt = now + IDLE_SHOW_MS;
      idleNextAt = now + IDLE_REPEAT_MS;
      lastIdleN = n;
      idleTxt.textContent = n === 1 ? '1 recoltor stă degeaba' : `${n} recoltoare stau degeaba`;
    }
    if (n > lastIdleN && lastIdleN > 0) idleNextAt = 0;
    if (idleHideAt && now > idleHideAt) idleHideAt = 0;
    const showIdle = n > 0 && idleHideAt > 0;
    if (idleChip.style.display !== (showIdle ? '' : 'none')) idleChip.style.display = showIdle ? '' : 'none';
  }

  function dispose() {
    box.remove();
  }
  return { update, dispose, handleEvent };
}
