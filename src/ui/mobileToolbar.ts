import type { UiContext, UiModule } from './context';
import { el } from './dom';

export function initMobileToolbar(ctx: UiContext): UiModule {
  const bar = el('div', { attrs: { id: 'mobileToolbar' }, parent: ctx.stageEl });

  const allBtn = el('button', { className: 'mt-btn', text: 'Toată armata', attrs: { type: 'button' }, parent: bar });
  const amBtn = el('button', { className: 'mt-btn', text: 'Atac-mers', attrs: { type: 'button' }, parent: bar });
  const stopBtn = el('button', { className: 'mt-btn', text: 'Stop', attrs: { type: 'button' }, parent: bar });
  const homeBtn = el('button', { className: 'mt-btn', text: 'Bază', attrs: { type: 'button' }, parent: bar });

  allBtn.addEventListener('click', () => {
    const ids = Array.from(ctx.world.units.values())
      .filter((u) => u.team === ctx.localTeam && u.type !== 'harvester')
      .map((u) => u.id);
    ctx.setSelection(ids);
  });
  amBtn.addEventListener('click', () => ctx.armAttackMove(!ctx.attackMoveArmed));
  stopBtn.addEventListener('click', () => {
    if (ctx.selection.length) ctx.queueCommand({ t: 'stop', team: ctx.localTeam, ids: [...ctx.selection] });
  });
  homeBtn.addEventListener('click', () => {
    const hq = Array.from(ctx.world.buildings.values()).find((b) => b.team === ctx.localTeam && b.type === 'hq')
      ?? Array.from(ctx.world.buildings.values()).find((b) => b.team === ctx.localTeam);
    if (hq) ctx.renderer.centerOn({ x: hq.tx + hq.w / 2, y: hq.ty + hq.h / 2 });
  });

  function update() {
    amBtn.classList.toggle('on', ctx.attackMoveArmed);
  }
  function dispose() {
    bar.remove();
  }
  return { update, dispose };
}
