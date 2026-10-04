// Panoul de construcție și antrenare: tab-uri (Clădiri / Fabrică / Cazarmă / Aerodrom), carduri cu
// cost, descriere, stare blocată explicită, progres și buton "Anulează" (banii se întorc integral).
import type { UiContext, UiModule, BuildTab } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { BUILD_LIST, UNIT_GROUPS, PRODUCERS, QUEUE_KEY, QUEUE_MAX, nameOf, isUnitType } from './buildData';
import type { BuildingType, Player, ProducerType, UnitType } from '../sim/types';

type CardType = BuildingType | UnitType;

interface Card {
  type: CardType;
  root: HTMLElement;
  desc: HTMLElement;
  status: HTMLElement;
  prog: HTMLElement;
  progFill: HTMLElement;
  cancel: HTMLButtonElement;
  badge: HTMLElement;
  /** textul de eroare afișat la atingerea unui card blocat (null = card activ) */
  blockedMsg: string | null;
  cache: Record<string, string>;
}

const TAB_LABEL: Record<BuildTab, string> = {
  buildings: 'Clădiri',
  factory: BUILDINGS.factory.name,
  barracks: BUILDINGS.barracks.name,
  airfield: BUILDINGS.airfield.name,
};
const TAB_ICON: Record<BuildTab, string> = { buildings: 'hq', factory: 'factory', barracks: 'barracks', airfield: 'airfield' };
const TABS: BuildTab[] = ['buildings', ...PRODUCERS];

export function initBuildPanel(ctx: UiContext): UiModule {
  const panel = el('div', { attrs: { id: 'buildPanel' }, parent: ctx.root });

  // starea bazei (doar coloana de pe desktop / telefon pe lat)
  const power = el('div', { className: 'bp-power', parent: panel });
  power.innerHTML = '<div class="bp-bar-label"><span>Integritate bază</span><span class="bp-pct tabular">100%</span></div><div class="bp-bar"><i></i></div>';
  const pct = power.querySelector('.bp-pct') as HTMLElement;
  const barFill = power.querySelector('.bp-bar i') as HTMLElement;

  const tabsEl = el('div', { className: 'bp-tabs', attrs: { role: 'tablist' }, parent: panel });
  const tabBtns = new Map<BuildTab, { btn: HTMLButtonElement; dot: HTMLElement }>();
  for (const t of TABS) {
    const btn = el('button', { className: 'bp-tab', attrs: { type: 'button', role: 'tab' }, parent: tabsEl }) as HTMLButtonElement;
    btn.innerHTML = `${iconSvg(TAB_ICON[t])}<span>${TAB_LABEL[t]}</span><em class="dot"></em>`;
    btn.addEventListener('click', () => {
      ctx.sfx('click');
      ctx.setBuildTab(t);
    });
    tabBtns.set(t, { btn, dot: btn.querySelector('.dot') as HTMLElement });
  }

  const viewport = el('div', { className: 'bp-viewport', parent: panel });
  const grids = new Map<BuildTab, HTMLElement>();
  for (const t of TABS) grids.set(t, el('div', { className: 'bp-grid', parent: viewport }));

  function localPlayer(): Player {
    return ctx.world.players.find((p) => p.team === ctx.localTeam)!;
  }
  function hasBuilding(type: BuildingType): boolean {
    for (const b of ctx.world.buildings.values()) if (b.team === ctx.localTeam && b.type === type) return true;
    return false;
  }

  function makeCard(parent: HTMLElement, type: CardType, isUnit: boolean): Card {
    const def = isUnit ? UNITS[type as UnitType] : BUILDINGS[type as BuildingType];
    const root = el('div', { className: 'card', attrs: { role: 'button', tabindex: '0', 'data-type': type }, parent });
    root.innerHTML = `
      <div class="c-top">
        <span class="c-icon">${iconSvg(type)}</span>
        <span class="c-head">
          <b class="c-name">${def.name}</b>
          <span class="c-cost">${iconSvg('coin')}<span class="tabular">${def.cost}</span><em class="tabular">${def.buildTime} s</em></span>
        </span>
        <span class="c-badge" style="display:none"></span>
      </div>
      <p class="c-desc">${def.desc}</p>
      <div class="c-foot">
        <div class="c-status"></div>
        <div class="c-prog"><i></i></div>
        <button type="button" class="btn-cancel" style="display:none"><b>Anulează</b><small>primești banii înapoi</small></button>
      </div>`;
    const card: Card = {
      type,
      root,
      desc: root.querySelector('.c-desc') as HTMLElement,
      status: root.querySelector('.c-status') as HTMLElement,
      prog: root.querySelector('.c-prog') as HTMLElement,
      progFill: root.querySelector('.c-prog i') as HTMLElement,
      cancel: root.querySelector('.btn-cancel') as HTMLButtonElement,
      badge: root.querySelector('.c-badge') as HTMLElement,
      blockedMsg: null,
      cache: {},
    };
    return card;
  }

  const cards: Card[] = [];

  // --- clădiri ---
  for (const type of BUILD_LIST) {
    const card = makeCard(grids.get('buildings')!, type, false);
    const act = () => {
      const slot = localPlayer().production.building;
      if (slot && slot.type === type) {
        if (slot.ready) {
          ctx.sfx('click');
          ctx.startPlacing(type);
        }
        return;
      }
      if (card.blockedMsg) {
        ctx.sfx('error');
        ctx.toast(card.blockedMsg, 'bad');
        return;
      }
      ctx.sfx('click');
      ctx.queueCommand({ t: 'buildStart', team: ctx.localTeam, building: type });
    };
    wire(card, act, () => {
      ctx.sfx('cancel');
      if (ctx.placing === type) ctx.cancelPlacing();
      ctx.queueCommand({ t: 'buildCancel', team: ctx.localTeam });
    });
    cards.push(card);
  }

  // --- unități, pe clădirea care le face ---
  for (const g of PRODUCERS) {
    for (const type of UNIT_GROUPS[g]) {
      const card = makeCard(grids.get(g)!, type, true);
      wire(
        card,
        () => {
          if (card.blockedMsg) {
            ctx.sfx('error');
            ctx.toast(card.blockedMsg, 'bad');
            return;
          }
          ctx.sfx('click');
          ctx.queueCommand({ t: 'train', team: ctx.localTeam, unit: type as UnitType });
        },
        () => {
          ctx.sfx('cancel');
          ctx.queueCommand({ t: 'trainCancel', team: ctx.localTeam, unit: type as UnitType });
        }
      );
      cards.push(card);
    }
  }

  function wire(card: Card, onTap: () => void, onCancel: () => void) {
    card.root.addEventListener('click', onTap);
    card.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTap();
      }
    });
    // butonul Anulează e un buton adevărat (merge cu degetul), nu doar clic dreapta
    card.cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      onCancel();
    });
    card.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (card.root.classList.contains('active')) onCancel();
    });
  }

  function put(card: Card, key: string, el_: HTMLElement, val: string) {
    if (card.cache[key] !== val) {
      card.cache[key] = val;
      el_.textContent = val;
    }
  }

  function setView(card: Card, v: { state: 'idle' | 'locked' | 'active' | 'ready'; status: string; progress?: number; count?: number; blocked: string | null }) {
    card.blockedMsg = v.blocked;
    card.root.classList.toggle('locked', v.state === 'locked');
    card.root.classList.toggle('active', v.state === 'active' || v.state === 'ready');
    card.root.classList.toggle('ready', v.state === 'ready');
    card.root.setAttribute('aria-disabled', v.state === 'locked' ? 'true' : 'false');
    put(card, 'st', card.status, v.status);
    const showProg = v.state === 'active' || v.state === 'ready';
    card.prog.style.display = showProg ? '' : 'none';
    if (showProg) card.progFill.style.width = `${Math.min(100, Math.round((v.progress ?? 0) * 100))}%`;
    const cd = showProg ? '' : 'none';
    if (card.cancel.style.display !== cd) card.cancel.style.display = cd;
    const cnt = v.count ?? 0;
    const bd = cnt > 1 ? '' : 'none';
    if (card.badge.style.display !== bd) card.badge.style.display = bd;
    put(card, 'bd', card.badge, `×${cnt}`);
    card.root.classList.toggle('lockedLook', v.state === 'locked');
  }

  let wasReady = false;

  function update() {
    const player = localPlayer();
    const prod = player.production;
    const credits = player.credits;

    // integritatea bazei
    let hp = 0;
    let maxHp = 0;
    for (const b of ctx.world.buildings.values()) {
      if (b.team !== ctx.localTeam) continue;
      hp += b.hp;
      maxHp += b.maxHp;
    }
    const frac = maxHp > 0 ? hp / maxHp : 1;
    pct.textContent = `${Math.round(frac * 100)}%`;
    barFill.style.width = `${Math.max(0, frac * 100)}%`;
    barFill.style.background = frac > 0.55 ? 'var(--amber)' : 'var(--red)';

    // tab activ
    for (const t of TABS) {
      const on = ctx.buildTab === t;
      const tb = tabBtns.get(t)!;
      tb.btn.classList.toggle('active', on);
      tb.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      grids.get(t)!.style.display = on ? '' : 'none';
      const n = t === 'buildings' ? (prod.building ? 1 : 0) : (prod[QUEUE_KEY[t as ProducerType]]?.length ?? 0);
      tb.dot.textContent = n > 0 ? String(n) : '';
      tb.dot.style.display = n > 0 ? '' : 'none';
    }

    // clădirea gata: intră în modul de plasare
    const slot = prod.building;
    const readyNow = !!(slot && slot.ready);
    if (readyNow && !wasReady && slot) {
      ctx.setBuildTab('buildings');
      ctx.startPlacing(slot.type);
    }
    wasReady = readyNow;
    // dacă a dispărut clădirea gata (anulată), ieșim din plasare
    if (ctx.placing && !(slot && slot.ready && slot.type === ctx.placing)) ctx.cancelPlacing();

    for (const card of cards) {
      if (!isUnitType(card.type)) {
        const type = card.type as BuildingType;
        const def = BUILDINGS[type];
        const mine = !!slot && slot.type === type;
        if (mine && slot) {
          if (slot.ready) {
            const txt = ctx.placing === type ? 'Gata: atinge harta ca să o pui' : 'Gata: atinge cardul, apoi harta';
            setView(card, { state: 'ready', status: txt, progress: 1, blocked: null });
          } else {
            setView(card, { state: 'active', status: `Se construiește… ${Math.round(slot.progress * 100)}%`, progress: slot.progress, blocked: null });
          }
          continue;
        }
        let blocked: string | null = null;
        if (slot) blocked = 'Se construiește altceva. Așteaptă sau anulează.';
        else if (def.requires && !hasBuilding(def.requires)) blocked = `Necesită ${BUILDINGS[def.requires].name}`;
        else if (credits < def.cost) blocked = `Credite insuficiente: mai trebuie ${Math.ceil(def.cost - credits)}`;
        setView(card, { state: blocked ? 'locked' : 'idle', status: blocked ?? 'Atinge ca să construiești', blocked });
      } else {
        const type = card.type as UnitType;
        const def = UNITS[type];
        const q = prod[QUEUE_KEY[def.producedAt]] ?? [];
        const count = q.filter((s) => s.type === type).length;
        const head = q[0];
        const isHead = !!head && head.type === type;
        let blocked: string | null = null;
        if (!hasBuilding(def.producedAt)) blocked = `Necesită ${nameOf(def.producedAt)}`;
        else if (q.length >= QUEUE_MAX) blocked = `Coada e plină (${QUEUE_MAX})`;
        else if (credits < def.cost) blocked = `Credite insuficiente: mai trebuie ${Math.ceil(def.cost - credits)}`;
        if (count > 0) {
          const st = isHead ? `Se antrenează… ${Math.round(head.progress * 100)}%` : 'În coadă, așteaptă rândul';
          setView(card, { state: 'active', status: blocked && !hasBuilding(def.producedAt) ? blocked : st, progress: isHead ? head.progress : 0, count, blocked });
        } else {
          setView(card, { state: blocked ? 'locked' : 'idle', status: blocked ?? 'Atinge ca să antrenezi', blocked });
        }
      }
    }
  }

  function dispose() {
    panel.remove();
  }

  return { update, dispose };
}
