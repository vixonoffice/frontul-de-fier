import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDABLE_BUILDINGS, BUILDABLE_UNITS, BUILDING_INFO, UNIT_INFO } from './buildData';
import type { BuildingType, Player, UnitType } from '../sim/types';

const LONG_PRESS_MS = 350;

interface CardRefs {
  btn: HTMLButtonElement;
  wipe: HTMLElement;
  status: HTMLElement;
  badge: HTMLElement;
}

export function initBuildPanel(ctx: UiContext): UiModule {
  const panel = el('div', { attrs: { id: 'buildPanel' }, parent: ctx.root });

  const power = el('div', { className: 'bp-power', parent: panel });
  const crRow = el('div', { className: 'bp-cr', parent: power });
  crRow.innerHTML = `${iconSvg('ore')}<b class="tabular">0</b><span class="upper">credite</span>`;
  const crVal = crRow.querySelector('b') as HTMLElement;
  const barLabel = el('div', { className: 'bp-bar-label', parent: power });
  barLabel.innerHTML = '<span>STARE BAZĂ</span><span class="bp-pct">100%</span>';
  const pct = barLabel.querySelector('.bp-pct') as HTMLElement;
  const barWrap = el('div', { className: 'bp-bar', parent: power });
  const barFill = el('i', { parent: barWrap });

  const tabs = el('div', { className: 'bp-tabs', parent: panel });
  const tabBuildings = el('button', { className: 'bp-tab active', text: 'Clădiri', attrs: { type: 'button' }, parent: tabs });
  const tabUnits = el('button', { className: 'bp-tab', text: 'Unități', attrs: { type: 'button' }, parent: tabs });

  const viewport = el('div', { className: 'bp-viewport', parent: panel });
  const gridBuildings = el('div', { className: 'bp-grid', parent: viewport });
  const gridUnits = el('div', { className: 'bp-grid', parent: viewport });
  gridUnits.style.display = 'none';

  function localPlayer(): Player {
    return ctx.world.players.find((p) => p.team === ctx.localTeam)!;
  }

  function setTab(tab: 'buildings' | 'units') {
    const onB = tab === 'buildings';
    tabBuildings.classList.toggle('active', onB);
    tabUnits.classList.toggle('active', !onB);
    gridBuildings.style.display = onB ? '' : 'none';
    gridUnits.style.display = onB ? 'none' : '';
  }
  tabBuildings.addEventListener('click', () => setTab('buildings'));
  tabUnits.addEventListener('click', () => setTab('units'));

  function makeCard(parent: HTMLElement, iconName: string, name: string, cost: number): CardRefs {
    const btn = el('button', { className: 'card', attrs: { type: 'button' }, parent }) as HTMLButtonElement;
    btn.innerHTML = `
      <i class="c-wipe"></i>
      <span class="c-icon">${iconSvg(iconName)}</span>
      <span class="c-body">
        <div class="c-name">${name}</div>
        <div class="c-cost tabular">${cost}</div>
        <div class="c-status"></div>
      </span>
      <span class="c-badge" style="display:none"></span>
    `;
    return {
      btn,
      wipe: btn.querySelector('.c-wipe') as HTMLElement,
      status: btn.querySelector('.c-status') as HTMLElement,
      badge: btn.querySelector('.c-badge') as HTMLElement,
    };
  }

  function wireCancel(btn: HTMLButtonElement, action: () => void) {
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      action();
    });
    let timer: ReturnType<typeof setTimeout> | null = null;
    let longFired = false;
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      longFired = false;
      timer = setTimeout(() => {
        longFired = true;
        action();
      }, LONG_PRESS_MS);
    });
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    btn.addEventListener('pointerup', clear);
    btn.addEventListener('pointerleave', clear);
    btn.addEventListener('pointercancel', clear);
    btn.addEventListener(
      'click',
      (e) => {
        if (longFired) {
          e.preventDefault();
          e.stopPropagation();
          longFired = false;
        }
      },
      true
    );
  }

  const buildingCards = new Map<BuildingType, CardRefs>();
  for (const type of BUILDABLE_BUILDINGS) {
    const info = BUILDING_INFO[type];
    const card = makeCard(gridBuildings, type, info.name, info.cost);
    card.btn.addEventListener('click', () => {
      const player = localPlayer();
      const slot = player.production.building;
      if (slot && slot.type === type) {
        if (slot.ready) ctx.startPlacing(type);
      } else if (!slot) {
        ctx.queueCommand({ t: 'buildStart', team: ctx.localTeam, building: type });
      }
    });
    wireCancel(card.btn, () => {
      const slot = localPlayer().production.building;
      if (slot && slot.type === type && !slot.ready) {
        ctx.queueCommand({ t: 'buildCancel', team: ctx.localTeam });
      }
    });
    buildingCards.set(type, card);
  }

  const unitCards = new Map<UnitType, CardRefs>();
  for (const type of BUILDABLE_UNITS) {
    const info = UNIT_INFO[type];
    const card = makeCard(gridUnits, type, info.name, info.cost);
    card.btn.addEventListener('click', () => {
      ctx.queueCommand({ t: 'train', team: ctx.localTeam, unit: type });
    });
    wireCancel(card.btn, () => {
      ctx.queueCommand({ t: 'trainCancel', team: ctx.localTeam, unit: type });
    });
    unitCards.set(type, card);
  }

  function hasFactory(): boolean {
    for (const b of ctx.world.buildings.values()) {
      if (b.team === ctx.localTeam && b.type === 'factory') return true;
    }
    return false;
  }

  function update() {
    const player = localPlayer();
    crVal.textContent = String(Math.round(player.credits));

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
    barFill.style.background = frac > 0.55 ? 'var(--amber)' : frac > 0.28 ? 'var(--amber)' : 'var(--red)';

    const slot = player.production.building;
    for (const [type, card] of buildingCards) {
      const info = BUILDING_INFO[type];
      const mine = slot && slot.type === type;
      card.btn.classList.toggle('ready', !!(mine && slot.ready));
      card.wipe.style.height = mine ? `${Math.min(100, slot.progress * 100)}%` : '0%';
      card.status.textContent = mine ? (slot.ready ? 'GATA — ALEGE LOCUL' : `${Math.round(slot.progress * 100)}%`) : '';
      card.btn.disabled = !mine && (!!slot || player.credits < info.cost);
    }

    const fac = hasFactory();
    for (const [type, card] of unitCards) {
      const info = UNIT_INFO[type];
      const q = player.production.units;
      const mineCount = q.filter((s) => s.type === type).length;
      const head = q[0];
      const isHead = head && head.type === type;
      card.wipe.style.height = isHead ? `${Math.min(100, head.progress * 100)}%` : '0%';
      card.status.textContent = !fac ? 'Fără fabrică' : mineCount > 0 ? (isHead ? 'ÎN LUCRU' : 'ÎN COADĂ') : '';
      card.badge.style.display = mineCount > 1 ? 'grid' : 'none';
      card.badge.textContent = String(mineCount);
      card.btn.disabled = !fac || q.length >= 5 || player.credits < info.cost;
    }
  }

  function dispose() {
    panel.remove();
  }

  return { update, dispose };
}
