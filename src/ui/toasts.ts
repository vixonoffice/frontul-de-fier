import type { UiContext, UiModule, ToastKind } from './context';
import { el } from './dom';
import type { SimEvent } from '../sim/types';
import { BUILDING_INFO, UNIT_INFO } from './buildData';

const MAX_VISIBLE = 3;

export interface ToastsModule extends UiModule {
  push(text: string, kind?: ToastKind): void;
}

export function initToasts(ctx: UiContext): ToastsModule {
  const box = el('div', { attrs: { id: 'toasts' }, parent: ctx.stageEl });

  function push(text: string, kind: ToastKind = 'info') {
    const bad = kind === 'bad';
    const t = el('div', { className: bad ? 'toast bad' : 'toast', text, parent: box });
    setTimeout(() => {
      t.classList.add('fade');
      setTimeout(() => t.remove(), 400);
    }, 3200);
    while (box.children.length > MAX_VISIBLE) box.firstElementChild?.remove();
  }

  function handleEvent(e: SimEvent) {
    switch (e.type) {
      case 'unitReady':
        if (e.team === ctx.localTeam) push(`${UNIT_INFO[e.unit].name} gata.`);
        break;
      case 'buildingReady':
        if (e.team === ctx.localTeam) push(`${BUILDING_INFO[e.building].name} gata — alege locul.`);
        break;
      case 'underAttack':
        if (e.team === ctx.localTeam) push('Baza e atacată!', 'bad');
        break;
      case 'waveIncoming':
        if (e.team === ctx.localTeam) push(`Val inamic ${e.wave} se îndreaptă spre bază!`, 'bad');
        break;
      // 'unload' e ignorat intenționat — nu merită un toast de fiecare dată.
    }
  }

  function update(): void {
    /* toasturile se gestionează singure prin setTimeout */
  }

  function dispose() {
    box.remove();
  }

  return { update, dispose, handleEvent, push };
}
