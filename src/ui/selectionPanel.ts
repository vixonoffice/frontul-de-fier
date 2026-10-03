import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDING_INFO, UNIT_INFO } from './buildData';
import type { UnitType } from '../sim/types';

export function initSelectionPanel(ctx: UiContext): UiModule {
  const panel = el('div', { attrs: { id: 'selectionPanel' }, parent: ctx.stageEl });
  const title = el('div', { className: 'sp-title upper', parent: panel });
  const rows = el('div', { className: 'sp-rows', parent: panel });
  const rallyBtn = el('button', { className: 'sp-rally', text: 'Punct de adunare', attrs: { type: 'button' }, parent: panel });
  rallyBtn.style.display = 'none';
  rallyBtn.addEventListener('click', () => ctx.startRallyPick());

  function update() {
    // id-urile moarte sunt scoase centralizat din game.ts, după fiecare tick
    if (!ctx.selection.length) {
      panel.classList.remove('show');
      return;
    }
    panel.classList.add('show');

    const units = ctx.selection.map((id) => ctx.world.units.get(id)).filter((u): u is NonNullable<typeof u> => !!u);
    const buildings = ctx.selection.map((id) => ctx.world.buildings.get(id)).filter((b): b is NonNullable<typeof b> => !!b);

    if (units.length === 0 && buildings.length === 1) {
      const b = buildings[0];
      title.textContent = BUILDING_INFO[b.type].name;
      rows.innerHTML = '';
      const row = el('div', { className: 'sp-row', parent: rows });
      row.innerHTML = `${iconSvg(b.type)}<span class="cnt">${Math.ceil(b.hp)}/${b.maxHp}</span><span class="sp-hpbar"><i style="width:${Math.max(0, (b.hp / b.maxHp) * 100)}%"></i></span>`;
      const bar = row.querySelector('i') as HTMLElement;
      bar.style.background = b.hp / b.maxHp > 0.55 ? 'var(--ok)' : b.hp / b.maxHp > 0.28 ? 'var(--amber)' : 'var(--red)';
      rallyBtn.style.display = b.type === 'factory' ? 'block' : 'none';
      rallyBtn.textContent = ctx.pickingRally ? 'Alege pe hartă…' : 'Punct de adunare';
      return;
    }

    rallyBtn.style.display = 'none';
    title.textContent = `${ctx.selection.length} selectate`;
    const byType = new Map<UnitType, { count: number; hp: number; maxHp: number }>();
    for (const u of units) {
      const g = byType.get(u.type) ?? { count: 0, hp: 0, maxHp: 0 };
      g.count += 1;
      g.hp += u.hp;
      g.maxHp += u.maxHp;
      byType.set(u.type, g);
    }
    rows.innerHTML = '';
    for (const [type, g] of byType) {
      const frac = g.maxHp > 0 ? g.hp / g.maxHp : 1;
      const row = el('div', { className: 'sp-row', parent: rows });
      row.innerHTML = `${iconSvg(type)}<span class="cnt">${g.count}×</span><span style="flex:1;font-size:11px;color:var(--mut)">${UNIT_INFO[type].name}</span><span class="sp-hpbar"><i style="width:${Math.max(0, frac * 100)}%"></i></span>`;
      const bar = row.querySelector('i') as HTMLElement;
      bar.style.background = frac > 0.55 ? 'var(--ok)' : frac > 0.28 ? 'var(--amber)' : 'var(--red)';
    }
    for (const b of buildings) {
      const frac = b.hp / b.maxHp;
      const row = el('div', { className: 'sp-row', parent: rows });
      row.innerHTML = `${iconSvg(b.type)}<span class="cnt">1×</span><span style="flex:1;font-size:11px;color:var(--mut)">${BUILDING_INFO[b.type].name}</span><span class="sp-hpbar"><i style="width:${Math.max(0, frac * 100)}%"></i></span>`;
      const bar = row.querySelector('i') as HTMLElement;
      bar.style.background = frac > 0.55 ? 'var(--ok)' : frac > 0.28 ? 'var(--amber)' : 'var(--red)';
    }
  }

  function dispose() {
    panel.remove();
  }

  return { update, dispose };
}
