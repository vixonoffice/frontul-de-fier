// Sfaturi ghidate: o singură bandă subțire sub bara de sus (maximum două rânduri de text), cu "x" = am înțeles
// și "Nu mai arăta". Nu apar cât timp e tava deschisă sau în modul de plasare, iar conturul de evidențiere
// nu blochează atingerile.
import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { tipsEnabled, setTipsEnabled, seenTips, markTipSeen, onTipsChange } from './prefs';
import type { BuildingType, Command } from '../sim/types';
import { QUEUE_KEY } from './buildData';
import { iconSvg } from './icons';

interface Rect { x: number; y: number; w: number; h: number }

interface Tip {
  id: string;
  text: string;
  ready: () => boolean;
  done?: () => boolean;
  /** selector CSS al controlului evidențiat */
  target?: string;
}

const GAP_MS = 1200;

export function initTips(ctx: UiContext): UiModule {
  const strip = el('div', { attrs: { id: 'tipStrip', role: 'status' }, parent: ctx.root });
  const body = el('div', { className: 'tip-body', parent: strip });
  const txt = el('p', { className: 'tip-text', parent: body });
  const off = el('button', { className: 'btn-link', text: 'Nu mai arăta', attrs: { type: 'button', id: 'tipOff' }, parent: body }) as HTMLButtonElement;
  const ok = el('button', { className: 'tip-x', attrs: { type: 'button', id: 'tipOk', 'aria-label': 'Am înțeles' }, parent: strip }) as HTMLButtonElement;
  ok.innerHTML = iconSvg('cancel');
  const ring = el('div', { className: 'tip-ring', parent: ctx.root });
  strip.style.display = 'none';
  ring.style.display = 'none';

  let enabled = tipsEnabled();
  let seen = seenTips();
  const unsub = onTipsChange(() => {
    enabled = tipsEnabled();
    seen = seenTips();
    hide();
  });

  const did = { move: false, army: false, bomb: false };
  ctx.onCommand((c: Command) => {
    if (c.t === 'move') did.move = true;
    else if (c.t === 'attackMove' || c.t === 'attack') did.army = true;
    else if (c.t === 'bomb') did.bomb = true;
  });

  const me = () => ctx.world.players.find((p) => p.team === ctx.localTeam)!;
  const countOf = (t: BuildingType) => {
    let n = 0;
    for (const b of ctx.world.buildings.values()) if (b.team === ctx.localTeam && b.type === t) n++;
    return n;
  };
  const building = () => me().production.building;
  const queued = (t: BuildingType) => building()?.type === t;
  const ownUnits = (pred: (t: string) => boolean = () => true) => {
    const out = [];
    for (const u of ctx.world.units.values()) if (u.team === ctx.localTeam && pred(u.type)) out.push(u);
    return out;
  };
  const selBuilding = () => {
    if (ctx.selection.length !== 1) return false;
    const b = ctx.world.buildings.get(ctx.selection[0]);
    return !!b && b.team === ctx.localTeam && b.type !== 'hq';
  };

  const TIPS: Tip[] = [
    {
      id: 'select',
      text: 'Atinge un tanc ca să-l selectezi. Jos apar acțiunile lui.',
      ready: () => true,
      done: () => ctx.selection.some((id) => ctx.world.units.has(id)),
    },
    {
      id: 'move',
      text: 'Acum atinge un loc liber pe hartă: unitatea merge acolo.',
      ready: () => ctx.selection.some((id) => ctx.world.units.has(id)),
      done: () => did.move,
    },
    {
      id: 'credits',
      text: 'Sus: creditele, banii tăi. Vin din minereul adus de recoltoare.',
      ready: () => seen.has('move'),
      target: '#tb-credits',
    },
    {
      id: 'minimap',
      text: 'Radarul: roșu e inamicul. Atinge-l ca să-l mărești sau micșorezi.',
      ready: () => seen.has('credits'),
      target: '#minimapPanel',
    },
    {
      id: 'refinery',
      text: `Atinge Clădiri, apoi Rafinărie. Cu „x” anulezi și primești banii.`,
      ready: () => seen.has('minimap') && countOf('refinery') < 2 && !queued('refinery'),
      done: () => queued('refinery') || countOf('refinery') >= 2,
      target: '#dk-buildings',
    },
    {
      id: 'place',
      text: 'Gata! Atinge Clădiri, pătratul ei, apoi harta. Fără confirmare.',
      ready: () => !!building()?.ready,
      done: () => !building(),
      target: '#dk-buildings',
    },
    {
      id: 'harvesters',
      text: 'Recoltoare degeaba? Selectează-le, „Adună minereu”, atinge aurul.',
      ready: () => seen.has('place') && ownUnits((t) => t === 'harvester').length > 0,
    },
    {
      id: 'barracks',
      text: `Cazarma (${BUILDINGS.barracks.cost}) face soldați: Clădiri, apoi Cazarmă.`,
      ready: () => seen.has('harvesters') && countOf('barracks') === 0 && !queued('barracks'),
      done: () => countOf('barracks') > 0 || queued('barracks'),
      target: '#dk-buildings',
    },
    {
      id: 'train',
      text: `Dock, Cazarmă, apoi Soldat (${UNITS.soldier.cost}). Poți pune mai mulți la coadă.`,
      ready: () => countOf('barracks') > 0,
      done: () => me().production[QUEUE_KEY.barracks].length > 0 || ownUnits((t) => t === 'soldier').length > 0,
      target: '#dk-barracks',
    },
    {
      id: 'army',
      text: 'Armată o selectează; apoi Atacă și atinge harta spre inamic.',
      ready: () => seen.has('train') && ownUnits((t) => t !== 'harvester').length >= 2,
      done: () => did.army,
      target: '#dk-army',
    },
    {
      id: 'sell',
      text: 'Vinde: apasă „Vinde” de două ori. Primești jumătate din cost.',
      ready: () => seen.has('place') && selBuilding(),
      target: '#act-sell',
    },
    {
      id: 'help',
      text: 'Ajutor? „?” arată comenzile și oprește sfaturile.',
      ready: () => seen.has('army') || seen.has('train'),
      target: '#helpBtn',
    },
    {
      id: 'airfield',
      text: `Bombardierele (${UNITS.bomber.cost}) se fac la Aerodrom, din dock.`,
      ready: () => countOf('airfield') > 0,
      target: '#dk-airfield',
    },
    {
      id: 'bomber',
      text: 'Bombardier ales: Bombardează, apoi atinge ținta.',
      ready: () => seen.has('airfield') && ctx.selection.some((id) => ctx.world.units.get(id)?.type === 'bomber'),
      done: () => did.bomb,
      target: '#act-bomb',
    },
  ];

  let current: Tip | null = null;
  let hiddenUntil = 0;

  function hide() {
    current = null;
    strip.style.display = 'none';
    ring.style.display = 'none';
    ctx.root.style.setProperty('--tip-h', '0px');
  }
  function complete(t: Tip) {
    seen.add(t.id);
    markTipSeen(t.id);
    hide();
    hiddenUntil = performance.now() + GAP_MS;
  }
  ok.addEventListener('click', () => {
    ctx.sfx('click');
    if (current) complete(current);
  });
  off.addEventListener('click', () => {
    ctx.sfx('click');
    setTipsEnabled(false);
    ctx.toast('Sfaturile sunt oprite. Le pornești din „?”.');
  });

  const rectOf = (sel: string): Rect | null => {
    const n = ctx.root.querySelector(sel) as HTMLElement | null;
    if (!n || n.offsetParent === null) return null;
    const r = n.getBoundingClientRect();
    const o = ctx.root.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  };

  function pick(): Tip | null {
    for (const t of TIPS) {
      if (seen.has(t.id) || !t.ready()) continue;
      if (t.done?.()) {
        seen.add(t.id);
        markTipSeen(t.id);
        continue;
      }
      return t;
    }
    return null;
  }

  function update() {
    const active = enabled && ctx.started && !ctx.paused && !ctx.gameOver && !ctx.helpOpen && !ctx.trayTab && !ctx.placing;
    if (!active) {
      if (strip.style.display !== 'none') hide();
      return;
    }
    if (current) {
      if (current.done?.()) complete(current);
      else if (!current.ready()) hide();
    }
    if (!current) {
      if (performance.now() < hiddenUntil) return;
      const t = pick();
      if (!t) return;
      current = t;
      txt.textContent = t.text;
      strip.style.display = '';
    }
    if (current) {
      ctx.root.style.setProperty('--tip-h', `${strip.offsetHeight + 4}px`);
      const r = current.target ? rectOf(current.target) : null;
      ring.style.display = r ? '' : 'none';
      if (r) {
        const pad = 3;
        ring.style.left = `${r.x - pad}px`;
        ring.style.top = `${r.y - pad}px`;
        ring.style.width = `${r.w + pad * 2}px`;
        ring.style.height = `${r.h + pad * 2}px`;
      }
    }
  }

  function dispose() {
    unsub();
    strip.remove();
    ring.remove();
    ctx.root.style.removeProperty('--tip-h');
  }

  return { update, dispose };
}
