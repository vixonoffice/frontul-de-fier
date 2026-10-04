// Rândul de chip-uri deasupra dock-ului: un singur rând de ~44px, cu strict ce se aplică acum:
// clădire gata, plasare în curs, unealtă armată sau acțiunile selecției (inclusiv "Vinde").
import type { UiContext, UiModule, Tool } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { nameOf, canShoot, canHarvest } from './buildData';
import { BUILDINGS } from '../data/buildings';
import { REPAIR_COST_FACTOR } from '../data/units';
import type { UnitType, Unit, Building, EntityId } from '../sim/types';

const PROMPT: Record<Exclude<Tool, null>, string> = {
  attackMove: 'Atinge harta: trupele merg și atacă',
  harvest: 'Atinge minereul (aurul de pe hartă)',
  bomb: 'Atinge ținta bombardamentului',
  rally: 'Atinge harta: aici se adună unitățile noi',
};
const SELL_CONFIRM_MS = 3000;

export function initCommandBar(ctx: UiContext): UiModule {
  const row = el('div', { attrs: { id: 'chipRow' }, parent: ctx.bottomEl });

  // etichetă informativă (nu e buton)
  const info = el('div', { className: 'ci-info', parent: row });
  // clădire gata
  const readyChip = el('button', { className: 'ci ci-ready', attrs: { type: 'button', id: 'chipReady' }, parent: row }) as HTMLButtonElement;
  readyChip.addEventListener('click', () => {
    ctx.sfx('click');
    ctx.openTray('buildings');
  });
  // renunț la plasare / unealtă
  const cancelChip = el('button', { className: 'ci ci-cancel', attrs: { type: 'button', id: 'btnPlaceCancel' }, parent: row }) as HTMLButtonElement;
  cancelChip.innerHTML = `${iconSvg('cancel')}<span>Anulează</span>`;
  cancelChip.addEventListener('click', () => {
    ctx.sfx('cancel');
    if (ctx.placing) {
      ctx.cancelPlacing();
      ctx.toast('Clădirea rămâne gata. O pui din tava Clădiri.');
    } else ctx.setTool(null);
  });

  const btns = new Map<string, HTMLButtonElement>();
  function addBtn(id: string, icon: string, label: string, onClick: () => void) {
    const btn = el('button', { className: 'ci act', attrs: { type: 'button', id: `act-${id}` }, parent: row }) as HTMLButtonElement;
    btn.innerHTML = `${iconSvg(icon)}<span>${label}</span>`;
    btn.addEventListener('click', () => {
      ctx.sfx('click');
      onClick();
    });
    btns.set(id, btn);
    return btn;
  }
  const toggle = (t: Exclude<Tool, null>) => () => ctx.setTool(ctx.tool === t ? null : t);
  addBtn('attack', 'target', 'Atacă', toggle('attackMove'));
  addBtn('stop', 'stop', 'Stop', () => {
    ctx.setTool(null);
    ctx.queueCommand({ t: 'stop', team: ctx.localTeam, ids: [...ctx.selection] });
  });
  addBtn('harvest', 'harvest', 'Adună minereu', toggle('harvest'));
  addBtn('bomb', 'bomb', 'Bombardează', toggle('bomb'));
  addBtn('rally', 'flag', 'Punct de adunare', toggle('rally'));
  let roleToasts = 0;
  const roleCmd = (role: 'guard' | 'attack') => () => {
    const ids = ctx.selection.filter((id) => {
      const u = ctx.world.units.get(id);
      return !!u && u.type !== 'harvester' && (role === 'guard') !== (u.role === 'guard');
    });
    if (!ids.length) return;
    ctx.queueCommand({ t: 'role', team: ctx.localTeam, ids, role });
    if (roleToasts < 4) {
      roleToasts++;
      ctx.toast(role === 'guard' ? 'Garda apără singură baza unde e atacată.' : 'Forța de atac pleacă în ofensive.');
    }
  };
  addBtn('guard', 'shield', 'Pune în gardă', roleCmd('guard'));
  addBtn('toattack', 'target', 'Pune la atac', roleCmd('attack'));
  const repairBtn = addBtn('repair', 'bolt', 'Repară', () => {
    const b = ctx.selection.length === 1 ? ctx.world.buildings.get(ctx.selection[0]) : undefined;
    if (!b || b.team !== ctx.localTeam) return;
    if (!b.repairing && b.hp >= b.maxHp) {
      ctx.toast('Clădirea e întreagă.');
      return;
    }
    ctx.sfx(b.repairing ? 'off' : 'on');
    ctx.queueCommand({ t: 'repair', team: ctx.localTeam, id: b.id, on: !b.repairing });
  });
  const repairLabel = repairBtn.querySelector('span') as HTMLElement;
  const sellBtn = addBtn('sell', 'coin', 'Vinde', () => {
    const id = sellTargetId();
    if (id === null) return;
    const now = performance.now();
    if (armed && armed.id === id && now < armed.until) {
      armed = null;
      ctx.sell(id);
      ctx.setSelection([]);
    } else {
      armed = { id, until: now + SELL_CONFIRM_MS };
    }
  });
  const sellLabel = sellBtn.querySelector('span') as HTMLElement;

  let armed: { id: EntityId; until: number } | null = null;
  function sellTargetId(): EntityId | null {
    if (ctx.selection.length !== 1) return null;
    const b = ctx.world.buildings.get(ctx.selection[0]);
    return b && b.team === ctx.localTeam && b.type !== 'hq' ? b.id : null;
  }
  // orice altă atingere în afara butonului anulează vânzarea
  const onDown = (e: Event) => {
    if (armed && !sellBtn.contains(e.target as Node)) armed = null;
  };
  window.addEventListener('pointerdown', onDown, true);

  let infoKey = '';
  let lastDisplay = '';

  function setInfo(html: string) {
    if (html !== infoKey) {
      infoKey = html;
      info.innerHTML = html;
    }
    info.style.display = html ? '' : 'none';
  }

  function update() {
    const units: Unit[] = [];
    const blds: Building[] = [];
    for (const id of ctx.selection) {
      const u = ctx.world.units.get(id);
      if (u) units.push(u);
      else {
        const b = ctx.world.buildings.get(id);
        if (b) blds.push(b);
      }
    }
    const fighters = units.filter((u) => u.type !== 'harvester');
    const hasProducer = blds.some((b) => b.type === 'factory' || b.type === 'barracks' || b.type === 'airfield');
    const hasHarv = units.some((u) => canHarvest(u.type));
    const hasBomber = units.some((u) => u.type === 'bomber');
    const hasShooter = units.some((u) => canShoot(u.type));
    const sellId = sellTargetId();
    const ownBuilding = ctx.selection.length === 1 && blds.length === 1 && blds[0].team === ctx.localTeam ? blds[0] : null;
    if (ownBuilding) {
      // costul estimat al unei reparații complete, după viața lipsă
      const cost = Math.ceil(BUILDINGS[ownBuilding.type].cost * REPAIR_COST_FACTOR * (1 - ownBuilding.hp / ownBuilding.maxHp));
      const t = ownBuilding.repairing ? 'Repar…' : cost > 0 ? `Repară ~${cost}` : 'Repară';
      if (repairLabel.textContent !== t) repairLabel.textContent = t;
      repairBtn.classList.toggle('on', !!ownBuilding.repairing);
    }
    if (ctx.tool === 'rally' && !hasProducer) ctx.setTool(null);
    else if (ctx.tool === 'attackMove' && !hasShooter) ctx.setTool(null);
    else if (ctx.tool === 'harvest' && !hasHarv) ctx.setTool(null);
    else if (ctx.tool === 'bomb' && !hasBomber) ctx.setTool(null);
    if (armed && (sellId !== armed.id || performance.now() > armed.until)) armed = null;

    const slot = ctx.world.players.find((p) => p.team === ctx.localTeam)?.production.building;
    const showReady = !!slot && slot.ready && !ctx.placing && !ctx.trayTab;
    const placing = !!ctx.placing;
    const toolOn = !!ctx.tool && !placing;
    const showSel = ctx.selection.length > 0 && !placing && !ctx.trayTab;

    // etichetă
    let infoHtml = '';
    if (placing) infoHtml = `${iconSvg(ctx.placing!)}<span>${ctx.isTouch ? 'Atinge harta' : 'Click pe hartă'}: pui ${nameOf(ctx.placing!)}</span>`;
    else if (toolOn) infoHtml = `<span>${PROMPT[ctx.tool!]}</span>`;
    else if (showSel) {
      const byType = new Map<UnitType, number>();
      let hp = 0;
      let max = 0;
      for (const u of units) {
        byType.set(u.type, (byType.get(u.type) ?? 0) + 1);
        hp += u.hp;
        max += u.maxHp;
      }
      const parts: string[] = [];
      for (const [t, n] of byType) parts.push(`${iconSvg(t)}<b>${n}×</b>`);
      if (units.length === 1 && blds.length === 0) {
        const u = units[0];
        const rk = u.rank ?? 0;
        const kl = u.kills ?? 0;
        parts.push(`<span class="ci-rank" title="Grad">${iconSvg('chevron').repeat(rk)}${rk === 2 ? 'Elită' : rk === 1 ? 'Veteran' : 'Recrut'}</span><span class="ci-kills tabular">${kl} distrugeri</span>`);
      }
      for (const b of blds) {
        parts.push(`${iconSvg(b.type)}`);
        hp += b.hp;
        max += b.maxHp;
      }
      const guards = fighters.filter((u) => u.role === 'guard').length;
      if (guards) parts.push(`${iconSvg('shield')}<b>${guards}</b>`);
      const pct = max > 0 ? Math.round((hp / max) * 100) : 100;
      const col = pct > 55 ? 'var(--ok)' : pct > 28 ? 'var(--amber)' : 'var(--red)';
      infoHtml = `${parts.slice(0, 6).join('')}<span class="ci-hp tabular" style="color:${col}">${pct}%</span>`;
    }
    setInfo(infoHtml);

    const vis: Record<string, boolean> = {
      attack: showSel && hasShooter,
      stop: showSel && units.length > 0,
      harvest: showSel && hasHarv,
      bomb: showSel && hasBomber,
      rally: showSel && hasProducer && !units.length,
      sell: showSel && sellId !== null,
      repair: showSel && ownBuilding !== null,
      guard: showSel && fighters.some((u) => u.role !== 'guard'),
      toattack: showSel && fighters.some((u) => u.role === 'guard'),
    };
    for (const [id, b] of btns) {
      const v = vis[id] ? '' : 'none';
      if (b.style.display !== v) b.style.display = v;
    }
    btns.get('attack')!.classList.toggle('on', ctx.tool === 'attackMove');
    btns.get('harvest')!.classList.toggle('on', ctx.tool === 'harvest');
    btns.get('bomb')!.classList.toggle('on', ctx.tool === 'bomb');
    btns.get('rally')!.classList.toggle('on', ctx.tool === 'rally');
    if (sellId !== null) {
      const v = ctx.sellValue(sellId);
      const t = armed ? `Sigur? +${v}` : `Vinde +${v}`;
      if (sellLabel.textContent !== t) sellLabel.textContent = t;
      sellBtn.classList.toggle('danger', !!armed);
    }

    cancelChip.style.display = placing || toolOn ? '' : 'none';
    readyChip.style.display = showReady ? '' : 'none';
    if (showReady && slot) {
      const t = `${nameOf(slot.type)} gata: atinge-o, apoi atinge harta`;
      if (readyChip.dataset.t !== t) {
        readyChip.dataset.t = t;
        readyChip.innerHTML = `${iconSvg(slot.type)}<span>${t}</span>`;
      }
    }

    const any = placing || toolOn || showSel || showReady;
    const d = any ? '' : 'none';
    if (lastDisplay !== d) {
      lastDisplay = d;
      row.style.display = d;
    }
  }

  function dispose() {
    window.removeEventListener('pointerdown', onDown, true);
    row.remove();
  }
  return { update, dispose };
}
