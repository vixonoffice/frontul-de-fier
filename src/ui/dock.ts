// Dock (bară de butoane-icon pe marginea ecranului) + tavă (un rând de pătrate cu construcții / unități).
// Harta rămâne pe tot ecranul; tava apare doar când o deschide jucătorul. Pe un buton din dock se vede
// și fără tavă deschisă dacă ceva din categoria lui e în lucru sau gata.
import type { UiContext, UiModule, BuildTab } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { BUILD_LIST, UNIT_GROUPS, PRODUCERS, QUEUE_KEY, QUEUE_MAX, nameOf, shortName, isUnitType, descOf, costOf, timeOf } from './buildData';
import type { AssistMode, BuildingType, Player, ProductionSlot, UnitType } from '../sim/types';

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
  assist: 'Asistent',
  buildings: 'Clădiri',
  factory: BUILDINGS.factory.name,
  barracks: BUILDINGS.barracks.name,
  airfield: 'Aviație',
  army: 'Armată',
};
const TAB_ICON: Record<BuildTab, string> = { buildings: 'hq', factory: 'factory', barracks: 'barracks', airfield: 'airfield', assist: 'assist', army: 'army' };
const TABS: BuildTab[] = ['buildings', ...PRODUCERS, 'assist', 'army'];
const MULS: (1 | 5 | 25)[] = [1, 5, 25];

const ASSIST: { mode: AssistMode; name: string; desc: string; icon: string }[] = [
  { mode: 'economy', name: 'Dezvoltare bază', desc: 'Construiește rafinării, recoltoare și clădirile de producție.', icon: 'refinery' },
  { mode: 'defense', name: 'Apărare', desc: 'Pune turele și face unități de gardă pentru bază.', icon: 'turret' },
  { mode: 'attack', name: 'Atac', desc: 'Produce armată de atac. Tu o conduci.', icon: 'target' },
]
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
    if (unit && queuedCount(type as UnitType) > 0) {
      const rm = el('button', { className: 'pop-rm', text: `Scoate toate din coadă (${queuedCount(type as UnitType)})`, attrs: { type: 'button' }, parent: pop });
      rm.addEventListener('click', () => {
        cancelUnits(type as UnitType, true);
        hidePop();
      });
    }
    pop.style.display = '';
    if (popTimer) clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, 7000);
  }
  window.addEventListener('pointerdown', onAnyDown, true);
  function onAnyDown(e: Event) {
    if (pop.style.display !== 'none' && !pop.contains(e.target as Node) && Date.now() - lastLong > 300) hidePop();
  }
  let lastLong = 0;
  const queuedCount = (type: UnitType): number => queueOf(ctx.world.players.find((p) => p.team === ctx.localTeam)!.production, UNITS[type].producedAt).filter((s) => s.type === type).length;

  const queueOf = (prod: Player['production'], t: BuildTab): ProductionSlot<UnitType>[] =>
    t === 'buildings' || t === 'assist' || t === 'army' ? [] : prod[QUEUE_KEY[t]] ?? [];

  function localPlayer(): Player {
    return ctx.world.players.find((p) => p.team === ctx.localTeam)!;
  }
  function count(type: BuildingType): number {
    let n = 0;
    for (const b of ctx.world.buildings.values()) if (b.team === ctx.localTeam && b.type === type) n++;
    return n;
  }

  /** Scoate unul sau toate dintr-un tip din coadă; toast cu cât s-a întors (doar unitățile deja plătite). */
  function cancelUnits(type: UnitType, all: boolean) {
    const q = queueOf(localPlayer().production, UNITS[type].producedAt);
    const mine = q.filter((s) => s.type === type);
    if (!mine.length) return;
    const gone = all ? mine : [mine[mine.length - 1]];
    const refund = gone.filter((s) => s.paid !== false).length * UNITS[type].cost;
    ctx.sfx('cancel');
    ctx.queueCommand({ t: 'trainCancel', team: ctx.localTeam, unit: type, ...(all ? { all: true } : {}) });
    const what = all ? `Scoase ${gone.length} ${nameOf(type)}` : 'Scos din coadă';
    ctx.toast(refund > 0 ? `${what}: +${refund} credite înapoi.` : `${what}.`);
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

  function wire(t: Tile, onTap: () => void, onCancel: () => void, onCancelAll?: () => void) {
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
    // "x" scoate unul; apăsat lung scoate toate de acest tip (doar la unități)
    let xTimer: ReturnType<typeof setTimeout> | null = null;
    let xFired = false;
    t.x.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      xFired = false;
      if (!onCancelAll) return;
      xTimer = setTimeout(() => {
        xFired = true;
        onCancelAll();
      }, LONG_MS);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      t.x.addEventListener(ev, () => {
        if (xTimer) clearTimeout(xTimer);
        xTimer = null;
      });
    }
    t.x.addEventListener('click', (e) => {
      e.stopPropagation();
      if (xFired) {
        xFired = false;
        return;
      }
      onCancel();
    });
  }

  // --- selectorul de număr (x1 / x5 / x25) la începutul fiecărui tab de unități ---
  const mulBtns: HTMLButtonElement[] = [];
  for (const g of PRODUCERS) {
    const b = el('button', { className: 'mul', attrs: { type: 'button', 'aria-label': 'Câte unități pui la coadă' }, parent: grids.get(g)! }) as HTMLButtonElement;
    b.innerHTML = '<small>Câte</small><b></b>';
    b.addEventListener('click', () => {
      ctx.sfx('click');
      ctx.trainCount = MULS[(MULS.indexOf(ctx.trainCount) + 1) % MULS.length];
    });
    mulBtns.push(b);
  }

  // --- asistentul: trei comutatoare mari, independente ---
  el('p', { className: 'anote', text: 'Asistentul îți construiește baza. Atacul îl conduci tu.', parent: grids.get('assist')! });
  const atiles = new Map<AssistMode, HTMLButtonElement>();
  for (const a of ASSIST) {
    const b = el('button', { className: 'atile', attrs: { type: 'button', role: 'switch', 'data-mode': a.mode }, parent: grids.get('assist')! }) as HTMLButtonElement;
    b.innerHTML = `<span class="a-ic">${iconSvg(a.icon)}</span><span class="a-txt"><b>${a.name}</b><span class="a-desc">${a.desc}</span></span><i class="a-state"></i>`;
    b.addEventListener('click', () => {
      const as = localPlayer().assist;
      ctx.sfx(as?.[a.mode] ? 'off' : 'on');
      const now = !!as?.[a.mode];
      ctx.queueCommand({ t: 'assist', team: ctx.localTeam, mode: a.mode, on: !now });
    });
    atiles.set(a.mode, b);
  }

  // --- armata: trei dale mari cu numărătoare vie ---
  const ARMY: { id: 'all' | 'attack' | 'guard'; name: string; desc: string; icon: string }[] = [
    { id: 'all', name: 'Toată armata', desc: 'Selectează toate unitățile de luptă', icon: 'army' },
    { id: 'attack', name: 'Forța de atac', desc: 'Cele care pleacă în ofensive', icon: 'target' },
    { id: 'guard', name: 'Garda bazei', desc: 'Apără singure baza unde e atacată', icon: 'shield' },
  ];
  const combat = (): import('../sim/types').Unit[] => {
    const out = [];
    for (const u of ctx.world.units.values()) if (u.team === ctx.localTeam && u.type !== 'harvester') out.push(u);
    return out;
  };
  const armyTiles = new Map<string, HTMLButtonElement>();
  for (const a of ARMY) {
    const b = el('button', { className: 'atile army-tile', attrs: { type: 'button', 'data-army': a.id }, parent: grids.get('army')! }) as HTMLButtonElement;
    b.innerHTML = `<span class="a-ic">${iconSvg(a.icon)}</span><span class="a-txt"><b>${a.name}</b><span class="a-desc">${a.desc}</span></span><i class="a-state tabular"></i>`;
    b.addEventListener('click', () => {
      const ids = combat().filter((u) => a.id === 'all' || (a.id === 'guard' ? u.role === 'guard' : u.role !== 'guard')).map((u) => u.id);
      if (!ids.length) {
        ctx.sfx('error');
        ctx.toast(a.id === 'guard' ? 'Nu ai unități în gardă. Selectează unele și apasă „Pune în gardă”.' : 'Nu ai unități aici.', 'bad');
        return;
      }
      ctx.sfx('click');
      ctx.setSelection(ids);
      ctx.closeTray();
    });
    armyTiles.set(a.id, b);
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
          ctx.queueCommand({ t: 'train', team: ctx.localTeam, unit: type as UnitType, ...(ctx.trainCount > 1 ? { count: ctx.trainCount } : {}) });
        },
        () => cancelUnits(type as UnitType, false),
        () => cancelUnits(type as UnitType, true)
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
      hidePop();
      onClick();
      if (id === 'home') ctx.sfx('click');
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
  dbtns.get('assist')!.btn.insertAdjacentHTML('beforeend', '<span class="lamps"><i></i><i></i><i></i></span>');
  addDock('home', 'home', 'Bază', () => {
    ctx.closeTray();
    ctx.centerBase();
  });

  const tabVisible = (t: BuildTab, prod: Player['production']): boolean => {
    if (t === 'buildings' || t === 'assist' || t === 'army') return true;
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
  let wasTrayOpen = false;

  function update() {
    const player = localPlayer();
    const prod = player.production;
    const credits = player.credits;
    const slot = prod.building;

    // tava sau tabul dispar dacă n-au sens
    if (ctx.trayTab && !tabVisible(ctx.trayTab, prod)) ctx.closeTray();
    if (ctx.placing && !(slot && slot.ready && slot.type === ctx.placing)) ctx.cancelPlacing();
    if (!ctx.started || ctx.gameOver) ctx.closeTray();

    if (!!ctx.trayTab !== wasTrayOpen) {
      wasTrayOpen = !!ctx.trayTab;
      ctx.sfx(wasTrayOpen ? 'open' : 'close');
    }
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
      let waiting = false;
      if (t === 'buildings') {
        if (slot) {
          n = 1;
          prog = slot.progress;
          ready = slot.ready;
        }
      } else if (t !== 'assist' && t !== 'army') {
        const q = queueOf(prod, t);
        n = q.length;
        prog = q[0]?.progress ?? 0;
        waiting = n > 0 && q[0].paid === false && q[0].progress === 0;
      }
      if (t === 'army') {
        const n = combat().length;
        const bt = n ? String(n) : '';
        if (d.badge.textContent !== bt) d.badge.textContent = bt;
        d.badge.style.display = bt ? '' : 'none';
        d.badge.classList.add('plain');
        continue;
      }
      if (t === 'assist') {
        const a = player.assist;
        d.btn.classList.toggle('a-eco', !!a?.economy);
        d.btn.classList.toggle('a-def', !!a?.defense);
        d.btn.classList.toggle('a-atk', !!a?.attack);
        continue;
      }
      d.btn.classList.toggle('pulse', ready);
      d.btn.classList.toggle('busy', n > 0 && !ready && !waiting);
      d.btn.classList.toggle('wait', waiting);
      const bt = ready ? '!' : n > 0 ? (n > 99 ? '99' : String(n)) : '';
      if (d.badge.textContent !== bt) d.badge.textContent = bt;
      d.badge.style.display = bt ? '' : 'none';
      d.prog.style.width = n > 0 && !waiting ? `${Math.round(Math.min(1, prog) * 100)}%` : '0%';
    }
    // selectorul de număr și comutatoarele asistentului
    for (const b of mulBtns) (b.querySelector('b') as HTMLElement).textContent = `×${ctx.trainCount}`;
    for (const a of ASSIST) {
      const on = !!player.assist?.[a.mode];
      const b = atiles.get(a.mode)!;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      const st = b.querySelector('.a-state') as HTMLElement;
      const txt = on ? 'PORNIT' : 'OPRIT';
      if (st.textContent !== txt) st.textContent = txt;
    }
    {
      const cs = combat();
      const g = cs.filter((u) => u.role === 'guard').length;
      const counts: Record<string, number> = { all: cs.length, attack: cs.length - g, guard: g };
      for (const [id, b] of armyTiles) {
        const st = b.querySelector('.a-state') as HTMLElement;
        const tx = String(counts[id]);
        if (st.textContent !== tx) st.textContent = tx;
        b.classList.toggle('dim', counts[id] === 0);
      }
    }

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
        const q = queueOf(prod, def.producedAt);
        const n = q.filter((s) => s.type === type).length;
        const head = q[0];
        const isHead = !!head && head.type === type;
        const waiting = isHead && head.paid === false && head.progress === 0;
        let blocked: string | null = null;
        if (count(def.producedAt) === 0) blocked = `Necesită ${nameOf(def.producedAt)}`;
        else if (q.length >= QUEUE_MAX) blocked = `Coada e plină (${QUEUE_MAX})`;
        // banii nu mai blochează: unitățile din coadă se plătesc abia când le vine rândul
        t.root.classList.toggle('wait', waiting);
        if (n > 0) setTile(t, { state: 'active', sub: waiting ? 'Aștept bani' : isHead ? `${Math.round(head.progress * 100)}%` : 'coadă', progress: isHead && !waiting ? head.progress : 0, count: n, blocked });
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
