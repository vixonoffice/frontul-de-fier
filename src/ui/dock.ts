// Dock (bară de butoane-icon pe marginea ecranului) + tavă (un rând de pătrate cu construcții / unități).
// Harta rămâne pe tot ecranul; tava apare doar când o deschide jucătorul. Pe un buton din dock se vede
// și fără tavă deschisă dacă ceva din categoria lui e în lucru sau gata.
import type { UiContext, UiModule, BuildTab } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { BUILD_LIST, UNIT_GROUPS, PRODUCERS, QUEUE_KEY, QUEUE_MAX, nameOf, shortName, isUnitType, descOf, costOf, timeOf } from './buildData';
import type { BuildingType, Player, UnitType } from '../sim/types';

type TileType = BuildingType | UnitType;

interface Tile {
  type: TileType;
  root: HTMLElement;
  prog: HTMLElement;
  x: HTMLButtonElement;
  badge: HTMLElement;
  sub: HTMLElement;
  blocked: string | null;
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
const LONG_MS = 480;

export function initDock(ctx: UiContext): UiModule {
  const root = ctx.root;

  // ---------------- tava ----------------
  const tray = el('div', { attrs: { id: 'tray' }, parent: root });
  const trayScroll = el('div', { className: 'tray-scroll', parent: tray });
  const grids = new Map<BuildTab, HTMLElement>();
  for (const t of TABS) grids.set(t, el('div', { className: 'tray-row', attrs: { 'data-tab': t }, parent: trayScroll }));

  // popover cu descrierea (apăsare lungă pe un pătrat)
  const pop = el('div', { attrs: { id: 'tilePop' }, parent: ctx.bottomEl });
  pop.style.display = 'none';
  let popTimer: ReturnType<typeof setTimeout> | null = null;
  function hidePop() {
    pop.style.display = 'none';
    if (popTimer) clearTimeout(popTimer);
    popTimer = null;
  }
  function showPop(type: TileType) {
    const unit = isUnitType(type);
    const def = unit ? UNITS[type as UnitType] : BUILDINGS[type as BuildingType];
    const need = unit ? nameOf((def as (typeof UNITS)[UnitType]).producedAt) : (def as (typeof BUILDINGS)[BuildingType]).requires;
    const needTxt = need ? `Necesită ${nameOf(need as BuildingType)}` : 'Fără cerințe';
    pop.innerHTML = `<div class="pop-head">${iconSvg(type)}<b>${nameOf(type)}</b><span class="tabular">${costOf(type)} credite · ${timeOf(type)} s</span></div><p>${descOf(type)}</p><p class="pop-need">${needTxt}</p>`;
    pop.style.display = '';
    if (popTimer) clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, 7000);
  }
  window.addEventListener('pointerdown', onAnyDown, true);
  function onAnyDown(e: Event) {
    if (pop.style.display !== 'none' && !pop.contains(e.target as Node) && Date.now() - lastLong > 300) hidePop();
  }
  let lastLong = 0;

  function localPlayer(): Player {
    return ctx.world.players.find((p) => p.team === ctx.localTeam)!;
  }
  function count(type: BuildingType): number {
    let n = 0;
    for (const b of ctx.world.buildings.values()) if (b.team === ctx.localTeam && b.type === type) n++;
    return n;
  }

  function makeTile(parent: HTMLElement, type: TileType): Tile {
    const r = el('div', { className: 'tile', attrs: { role: 'button', tabindex: '0', 'data-type': type, 'aria-label': nameOf(type) }, parent });
    r.innerHTML = `
      <span class="t-ic">${iconSvg(type)}</span>
      <span class="t-txt"><b class="t-name">${shortName(type)}</b><span class="t-cost">${iconSvg('coin')}<span class="tabular">${costOf(type)}</span></span><span class="t-sub"></span></span>
      <i class="t-prog"><u></u></i>
      <button type="button" class="t-x" aria-label="Anulează">${iconSvg('cancel')}</button>
      <em class="t-badge"></em>
      <span class="t-lock">${iconSvg('lock')}</span>`;
    const t: Tile = {
      type,
      root: r,
      prog: r.querySelector('.t-prog u') as HTMLElement,
      x: r.querySelector('.t-x') as HTMLButtonElement,
      badge: r.querySelector('.t-badge') as HTMLElement,
      sub: r.querySelector('.t-sub') as HTMLElement,
      blocked: null,
      cache: {},
    };
    return t;
  }

  const tiles: Tile[] = [];

  function wire(t: Tile, onTap: () => void, onCancel: () => void) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sx = 0;
    let sy = 0;
    let fired = false;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    t.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.t-x')) return;
      fired = false;
      sx = e.clientX;
      sy = e.clientY;
      clear();
      timer = setTimeout(() => {
        fired = true;
        lastLong = Date.now();
        ctx.sfx('click');
        showPop(t.type);
      }, LONG_MS);
    });
    t.root.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) clear();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) t.root.addEventListener(ev, clear);
    t.root.addEventListener('click', (e) => {
      if (fired) {
        fired = false;
        e.preventDefault();
        return;
      }
      hidePop();
      onTap();
    });
    t.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onTap();
      }
    });
    t.root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showPop(t.type);
    });
    t.x.addEventListener('click', (e) => {
      e.stopPropagation();
      onCancel();
    });
  }

  // --- clădiri ---
  for (const type of BUILD_LIST) {
    const t = makeTile(grids.get('buildings')!, type);
    wire(
      t,
      () => {
        const slot = localPlayer().production.building;
        if (slot && slot.type === type) {
          if (slot.ready) {
            ctx.sfx('click');
            ctx.startPlacing(type);
          } else ctx.toast(`${nameOf(type)} se construiește. Cu „x” o anulezi.`);
          return;
        }
        if (t.blocked) {
          ctx.sfx('error');
          ctx.toast(t.blocked, 'bad');
          return;
        }
        ctx.sfx('click');
        ctx.queueCommand({ t: 'buildStart', team: ctx.localTeam, building: type });
      },
      () => {
        ctx.sfx('cancel');
        if (ctx.placing === type) ctx.cancelPlacing();
        ctx.queueCommand({ t: 'buildCancel', team: ctx.localTeam });
        ctx.toast('Anulat: primești banii înapoi.');
      }
    );
    tiles.push(t);
  }
  // --- unități, pe clădirea care le face ---
  for (const g of PRODUCERS) {
    for (const type of UNIT_GROUPS[g]) {
      const t = makeTile(grids.get(g)!, type);
      wire(
        t,
        () => {
          if (t.blocked) {
            ctx.sfx('error');
            ctx.toast(t.blocked, 'bad');
            return;
          }
          ctx.sfx('click');
          ctx.queueCommand({ t: 'train', team: ctx.localTeam, unit: type as UnitType });
        },
        () => {
          ctx.sfx('cancel');
          ctx.queueCommand({ t: 'trainCancel', team: ctx.localTeam, unit: type as UnitType });
          ctx.toast('Anulat: primești banii înapoi.');
        }
      );
      tiles.push(t);
    }
  }

  // ---------------- dock ----------------
  const dock = el('div', { attrs: { id: 'dock' }, parent: root });
  interface DockBtn { btn: HTMLButtonElement; badge: HTMLElement; prog: HTMLElement }
  const dbtns = new Map<string, DockBtn>();
  function addDock(id: string, icon: string, label: string, onClick: () => void) {
    const btn = el('button', { className: 'dk', attrs: { type: 'button', id: `dk-${id}`, 'aria-label': label }, parent: dock }) as HTMLButtonElement;
    btn.innerHTML = `${iconSvg(icon)}<span class="dk-l">${label}</span><em class="dk-badge"></em><i class="dk-prog"><u></u></i>`;
    btn.addEventListener('click', () => {
      ctx.sfx('click');
      hidePop();
      onClick();
    });
    dbtns.set(id, { btn, badge: btn.querySelector('.dk-badge') as HTMLElement, prog: btn.querySelector('.dk-prog u') as HTMLElement });
  }
  for (const t of TABS) {
    addDock(t, TAB_ICON[t], TAB_LABEL[t], () => {
      if (ctx.placing) ctx.cancelPlacing();
      if (ctx.trayTab === t) ctx.closeTray();
      else ctx.openTray(t);
    });
  }
  addDock('army', 'army', 'Armată', () => {
    ctx.closeTray();
    ctx.selectArmy();
  });
  addDock('home', 'home', 'Bază', () => {
    ctx.closeTray();
    ctx.centerBase();
  });

  const tabVisible = (t: BuildTab, prod: Player['production']): boolean => {
    if (t === 'buildings') return true;
    return count(t) > 0 || (prod[QUEUE_KEY[t]]?.length ?? 0) > 0;
  };

  function put(t: Tile, key: string, node: HTMLElement, val: string) {
    if (t.cache[key] !== val) {
      t.cache[key] = val;
      node.textContent = val;
    }
  }

  function setTile(t: Tile, v: { state: 'idle' | 'locked' | 'active' | 'ready'; sub: string; progress?: number; count?: number; blocked: string | null }) {
    t.blocked = v.blocked;
    t.root.classList.toggle('locked', v.state === 'locked');
    t.root.classList.toggle('active', v.state === 'active' || v.state === 'ready');
    t.root.classList.toggle('ready', v.state === 'ready');
    t.root.setAttribute('aria-disabled', v.state === 'locked' ? 'true' : 'false');
    put(t, 'sub', t.sub, v.sub);
    const showProg = v.state === 'active' || v.state === 'ready';
    t.prog.style.width = showProg ? `${Math.min(100, Math.round((v.progress ?? 0) * 100))}%` : '0%';
    const xd = showProg ? '' : 'none';
    if (t.x.style.display !== xd) t.x.style.display = xd;
    const cnt = v.count ?? 0;
    const bd = cnt > 1 ? '' : 'none';
    if (t.badge.style.display !== bd) t.badge.style.display = bd;
    put(t, 'bd', t.badge, `×${cnt}`);
  }

  let lastTabKey = '';

  function update() {
    const player = localPlayer();
    const prod = player.production;
    const credits = player.credits;
    const slot = prod.building;

    // tava sau tabul dispar dacă n-au sens
    if (ctx.trayTab && !tabVisible(ctx.trayTab, prod)) ctx.closeTray();
    if (ctx.placing && !(slot && slot.ready && slot.type === ctx.placing)) ctx.cancelPlacing();
    if (!ctx.started || ctx.gameOver) ctx.closeTray();

    root.classList.toggle('tray-open', !!ctx.trayTab);
    for (const t of TABS) grids.get(t)!.style.display = ctx.trayTab === t ? '' : 'none';
    if (ctx.trayTab && lastTabKey !== ctx.trayTab) {
      lastTabKey = ctx.trayTab;
      trayScroll.scrollLeft = 0;
      trayScroll.scrollTop = 0;
    }
    if (!ctx.trayTab) lastTabKey = '';

    // --- butoanele din dock ---
    for (const t of TABS) {
      const d = dbtns.get(t)!;
      const vis = tabVisible(t, prod);
      d.btn.style.display = vis ? '' : 'none';
      d.btn.classList.toggle('on', ctx.trayTab === t);
      let n = 0;
      let prog = 0;
      let ready = false;
      if (t === 'buildings') {
        if (slot) {
          n = 1;
          prog = slot.progress;
          ready = slot.ready;
        }
      } else {
        const q = prod[QUEUE_KEY[t]] ?? [];
        n = q.length;
        prog = q[0]?.progress ?? 0;
      }
      d.btn.classList.toggle('pulse', ready);
      d.btn.classList.toggle('busy', n > 0 && !ready);
      const bt = ready ? '!' : n > 0 ? String(n) : '';
      if (d.badge.textContent !== bt) d.badge.textContent = bt;
      d.badge.style.display = bt ? '' : 'none';
      d.prog.style.width = n > 0 ? `${Math.round(Math.min(1, prog) * 100)}%` : '0%';
    }
    let army = 0;
    for (const u of ctx.world.units.values()) if (u.team === ctx.localTeam && u.type !== 'harvester') army++;
    const ad = dbtns.get('army')!;
    const at = army ? String(army) : '';
    if (ad.badge.textContent !== at) ad.badge.textContent = at;
    ad.badge.style.display = at ? '' : 'none';
    ad.badge.classList.add('plain');

    // --- pătratele ---
    for (const t of tiles) {
      if (!isUnitType(t.type)) {
        const type = t.type as BuildingType;
        const def = BUILDINGS[type];
        if (slot && slot.type === type) {
          if (slot.ready) setTile(t, { state: 'ready', sub: 'GATA', progress: 1, blocked: null });
          else setTile(t, { state: 'active', sub: `${Math.round(slot.progress * 100)}%`, progress: slot.progress, blocked: null });
          continue;
        }
        let blocked: string | null = null;
        if (slot) blocked = 'Se construiește altceva. Așteaptă sau anulează.';
        else if (def.requires && count(def.requires) === 0) blocked = `Necesită ${BUILDINGS[def.requires].name}`;
        else if (credits < def.cost) blocked = `Credite insuficiente: mai trebuie ${Math.ceil(def.cost - credits)}`;
        setTile(t, { state: blocked ? 'locked' : 'idle', sub: '', blocked });
      } else {
        const type = t.type as UnitType;
        const def = UNITS[type];
        const q = prod[QUEUE_KEY[def.producedAt]] ?? [];
        const n = q.filter((s) => s.type === type).length;
        const head = q[0];
        const isHead = !!head && head.type === type;
        let blocked: string | null = null;
        if (count(def.producedAt) === 0) blocked = `Necesită ${nameOf(def.producedAt)}`;
        else if (q.length >= QUEUE_MAX) blocked = `Coada e plină (${QUEUE_MAX})`;
        else if (credits < def.cost) blocked = `Credite insuficiente: mai trebuie ${Math.ceil(def.cost - credits)}`;
        if (n > 0) setTile(t, { state: 'active', sub: isHead ? `${Math.round(head.progress * 100)}%` : 'coadă', progress: isHead ? head.progress : 0, count: n, blocked });
        else setTile(t, { state: blocked ? 'locked' : 'idle', sub: '', blocked });
      }
    }
  }

  function dispose() {
    window.removeEventListener('pointerdown', onAnyDown, true);
    hidePop();
    root.classList.remove('tray-open');
    tray.remove();
    dock.remove();
    pop.remove();
  }
  return { update, dispose };
}
