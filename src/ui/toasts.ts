import type { UiContext, UiModule, ToastKind } from './context';
import { el } from './dom';
import type { SimEvent } from '../sim/types';
import { nameOf } from './buildData';

const MAX_VISIBLE = 3;

export interface ToastsModule extends UiModule {
  push(text: string, kind?: ToastKind): void;
}

export function initToasts(ctx: UiContext): ToastsModule {
  const box = el('div', { attrs: { id: 'toasts' }, parent: ctx.bottomEl });

  function push(text: string, kind: ToastKind = 'info') {
    const bad = kind === 'bad';
    const t = el('div', { className: bad ? 'toast bad' : 'toast', text, parent: box });
    setTimeout(() => {
      t.classList.add('fade');
      setTimeout(() => t.remove(), 400);
    }, 3200);
    while (box.children.length > MAX_VISIBLE) box.firstElementChild?.remove();
  }

  let lastAttackToast = -1e9;

  let lastReadyToast = -1e9;

  function handleEvent(e: SimEvent) {
    switch (e.type) {
      case 'unitReady':
        // cu cozi lungi ies unități una după alta: un singur mesaj la câteva secunde, nu unul pentru fiecare
        if (e.team === ctx.localTeam && performance.now() - lastReadyToast > 6000) {
          lastReadyToast = performance.now();
          push(`${nameOf(e.unit)} gata.`);
        }
        break;
      case 'sold':
        if (e.team === ctx.localTeam) push(`${nameOf(e.building)} vândută: +${e.refund} credite.`);
        break;
      // 'buildingReady' n-are toast: bara de indicații și cardul spun deja ce trebuie făcut
      case 'underAttack':
        if (e.team === ctx.localTeam && performance.now() - lastAttackToast > 8000) {
          lastAttackToast = performance.now();
          push('Baza e atacată!', 'bad');
        }
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
