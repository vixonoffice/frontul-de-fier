// Sfaturi ghidate pentru primul meci: cartonașe scurte legate de ce face jucătorul, cu inel + săgeată
// către controlul potrivit. Se pot închide ("Am înțeles") sau opri definitiv ("Nu mai arăta sfaturi").
import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { tipsEnabled, setTipsEnabled, seenTips, markTipSeen, onTipsChange } from './prefs';
import type { BuildingType, Command, ProducerType } from '../sim/types';
import { QUEUE_KEY } from './buildData';

interface Rect { x: number; y: number; w: number; h: number }

interface Tip {
  id: string;
  text: string;
  /** apare peste ce rulează (alerte), în loc să aștepte rândul */
  urgent?: boolean;
  ready: () => boolean;
  done?: () => boolean;
  target?: () => Rect | null;
  onShow?: () => void;
}

const GAP_MS = 900;

export function initTips(ctx: UiContext): UiModule {
  const layer = el('div', { attrs: { id: 'tipLayer' }, parent: ctx.root });
  const ring = el('div', { className: 'tip-ring', parent: layer });
  const arrow = el('div', { className: 'tip-arrow', parent: layer });
  arrow.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22 L2 6 H22 Z" fill="currentColor"/></svg>';
  const card = el('div', { className: 'tip-card', attrs: { role: 'dialog', 'aria-label': 'Sfat' }, parent: layer });
  const step = el('div', { className: 'tip-step', parent: card });
  const txt = el('p', { className: 'tip-text', parent: card });
  const btns = el('div', { className: 'tip-btns', parent: card });
  const okBtn = el('button', { className: 'btn-mil go', text: 'Am înțeles', attrs: { type: 'button', id: 'tipOk' }, parent: btns }) as HTMLButtonElement;
  const offBtn = el('button', { className: 'btn-link', text: 'Nu mai arăta sfaturi', attrs: { type: 'button', id: 'tipOff' }, parent: btns }) as HTMLButtonElement;
  layer.style.display = 'none';

  let enabled = tipsEnabled();
  let seen = seenTips();
  const unsub = onTipsChange(() => {
    enabled = tipsEnabled();
    seen = seenTips();
    hide();
  });

  // ---- ce a făcut jucătorul (pentru pașii care așteaptă o acțiune) ----
  const did = { move: false, army: false, bomb: false };
  ctx.onCommand((c: Command) => {
    if (c.t === 'move') did.move = true;
    else if (c.t === 'attackMove' || c.t === 'attack') did.army = true;
    else if (c.t === 'bomb') did.bomb = true;
  });

  const me = () => ctx.world.players.find((p) => p.team === ctx.localTeam)!;
  const has = (t: BuildingType) => {
    for (const b of ctx.world.buildings.values()) if (b.team === ctx.localTeam && b.type === t) return true;
    return false;
  };
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

  // ---- ținte ----
  const rectOf = (sel: string): Rect | null => {
    const n = ctx.root.querySelector(sel) as HTMLElement | null;
    if (!n || n.offsetParent === null) return null;
    const r = n.getBoundingClientRect();
    const o = ctx.root.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  };
  const visible = (sel: string) => {
    const n = ctx.root.querySelector(sel) as HTMLElement | null;
    return !!n && n.style.display !== 'none';
  };
  const cardRect = (type: string) => rectOf(`.card[data-type="${type}"]`);
  const unitRect = (pred: (t: string) => boolean): Rect | null => {
    const o = ctx.root.getBoundingClientRect();
    const prefer = ownUnits(pred);
    for (const u of prefer) {
      const s = ctx.renderer.worldToScreen({ x: u.x, y: u.y });
      if (!s) continue;
      const cv = ctx.stageEl.querySelector('#gamecanvas') as HTMLElement;
      const cr = cv.getBoundingClientRect();
      if (s.x < 0 || s.y < 0 || s.x > cr.width || s.y > cr.height) continue;
      const x = s.x + cr.left - o.left;
      const y = s.y + cr.top - o.top;
      return { x: x - 26, y: y - 26, w: 52, h: 52 };
    }
    return null;
  };

  const showTab = (t: 'buildings' | ProducerType) => () => ctx.setBuildTab(t);

  const TIPS: Tip[] = [
    // --- alerte (trec în față) ---
    {
      id: 'attacked', urgent: true,
      text: 'Baza ta e atacată! Atinge alerta roșie ca să vezi unde. Trimite trupe acolo: selectează-le și atinge locul.',
      ready: () => visible('#chipAttack'),
      done: () => !visible('#chipAttack'),
      target: () => rectOf('#chipAttack'),
    },
    {
      id: 'idle', urgent: true,
      text: 'Recoltoarele stau degeaba și nu aduc bani. Atinge alerta galbenă, apoi atinge minereul (zona aurie de pe hartă).',
      ready: () => visible('#chipIdle'),
      done: () => !visible('#chipIdle'),
      target: () => rectOf('#chipIdle'),
    },
    // --- primul meci, în ordine ---
    {
      id: 'select',
      text: 'Atinge un tanc de-al tău ca să-l selectezi. Apare un cerc în jurul lui și jos o bară cu comenzi.',
      ready: () => true,
      done: () => ctx.selection.some((id) => ctx.world.units.has(id)),
      target: () => unitRect((t) => t === 'tank') ?? unitRect(() => true),
    },
    {
      id: 'move',
      text: 'Acum atinge un loc liber pe hartă: unitatea merge acolo. „Mută” e modul normal.',
      ready: () => ctx.selection.some((id) => ctx.world.units.has(id)),
      done: () => did.move,
      target: () => rectOf('#act-move'),
    },
    {
      id: 'credits',
      text: 'Sus vezi creditele: banii tăi. Totul costă credite. Banii vin din minereul adus de recoltoare.',
      ready: () => seen.has('move'),
      target: () => rectOf('#tb-credits'),
    },
    {
      id: 'minimap',
      text: 'Aici e radarul. Albastru ești tu, roșu e inamicul. Atinge-l ca să muți camera în acel loc.',
      ready: () => seen.has('credits'),
      target: () => rectOf('#minimapPanel'),
    },
    {
      id: 'refinery',
      text: `Hai să construim o rafinărie nouă (${BUILDINGS.refinery.cost} credite): mai mulți bani, plus un recoltor gratuit. Atinge cardul ei. Poți anula oricând.`,
      ready: () => seen.has('minimap') && countOf('refinery') < 2 && !queued('refinery'),
      done: () => queued('refinery') || countOf('refinery') >= 2,
      onShow: showTab('buildings'),
      target: () => cardRect('refinery'),
    },
    {
      id: 'cancel',
      text: 'Ai greșit? Apasă „Anulează” și primești toți banii înapoi. Nu pierzi nimic.',
      ready: () => !!building() && !building()!.ready,
      done: () => !building() || building()!.ready,
      target: () => rectOf('.card.active .btn-cancel'),
    },
    {
      id: 'place',
      text: 'Gata! Atinge harta lângă bază unde vrei clădirea (verde = merge, roșu = nu merge), apoi apasă „Construiește aici”.',
      ready: () => !!building()?.ready,
      done: () => !building(),
      target: () => rectOf('#cbBanner') ?? rectOf('#hudBottom'),
    },
    {
      id: 'harvesters',
      text: 'Camioanele sunt recoltoare: adună minereu și îl duc la rafinărie. Dacă stau degeaba, atinge-le, apasă „Adună minereu” și atinge zona aurie.',
      ready: () => seen.has('place') && ownUnits((t) => t === 'harvester').length > 0,
      target: () => unitRect((t) => t === 'harvester'),
    },
    {
      id: 'barracks',
      text: `Cazarma (${BUILDINGS.barracks.cost} credite) antrenează soldați. Se construiește la fel: card, așteaptă, pune-o pe hartă.`,
      ready: () => seen.has('harvesters') && !has('barracks') && !queued('barracks'),
      done: () => has('barracks') || queued('barracks'),
      onShow: showTab('buildings'),
      target: () => cardRect('barracks'),
    },
    {
      id: 'train',
      text: `Antrenează soldați: atinge cardul Soldat (${UNITS.soldier.cost} credite). Poți pune mai mulți la coadă și anula oricând.`,
      ready: () => has('barracks'),
      done: () => me().production[QUEUE_KEY.barracks].length > 0 || ownUnits((t) => t === 'soldier').length > 0,
      onShow: showTab('barracks'),
      target: () => cardRect('soldier'),
    },
    {
      id: 'army',
      text: 'Trimite armata: apasă „Toată armata”, apoi „Atacă-mergi” și atinge harta spre inamic.',
      ready: () => seen.has('train') && ownUnits((t) => t !== 'harvester').length >= 2,
      done: () => did.army,
      target: () => rectOf('#qa-army'),
    },
    {
      id: 'help',
      text: 'Ai nevoie de ajutor? Butonul „?” arată toate comenzile și te lasă să pornești sau să oprești sfaturile.',
      ready: () => seen.has('army') || seen.has('train'),
      target: () => rectOf('#helpBtn'),
    },
    // --- aviație ---
    {
      id: 'airfield',
      text: `Aerodromul face bombardiere (${UNITS.bomber.cost} credite). Atinge cardul Bombardier.`,
      ready: () => has('airfield'),
      onShow: showTab('airfield'),
      target: () => cardRect('bomber'),
    },
    {
      id: 'bomber',
      text: 'Selectează un bombardier, apasă „Bombardează” și atinge ținta. După ce lasă bombele, se întoarce singur la aerodrom să reîncarce.',
      ready: () => seen.has('airfield') && ctx.selection.some((id) => ctx.world.units.get(id)?.type === 'bomber'),
      done: () => did.bomb,
      target: () => rectOf('#act-bomb'),
    },
  ];

  let current: Tip | null = null;
  let hiddenUntil = 0;

  function hide() {
    current = null;
    layer.style.display = 'none';
  }
  function complete(t: Tip) {
    seen.add(t.id);
    markTipSeen(t.id);
    hide();
    hiddenUntil = performance.now() + GAP_MS;
  }
  okBtn.addEventListener('click', () => {
    ctx.sfx('click');
    if (current) complete(current);
  });
  offBtn.addEventListener('click', () => {
    ctx.sfx('click');
    setTipsEnabled(false);
    ctx.toast('Sfaturile sunt oprite. Le pornești din butonul „?”.');
  });

  function place(t: Tip) {
    const o = ctx.root.getBoundingClientRect();
    const r = t.target?.() ?? null;
    ring.style.display = r ? '' : 'none';
    arrow.style.display = r ? '' : 'none';
    let below = true; // cartonașul sus, ținta jos?
    if (r) {
      const pad = 5;
      ring.style.left = `${r.x - pad}px`;
      ring.style.top = `${r.y - pad}px`;
      ring.style.width = `${r.w + pad * 2}px`;
      ring.style.height = `${r.h + pad * 2}px`;
      below = r.y + r.h / 2 > o.height * 0.5;
    }
    const topbar = ctx.root.querySelector('#topbar') as HTMLElement | null;
    const topY = (topbar ? topbar.getBoundingClientRect().bottom - o.top : 0) + 8;
    const drawer = ctx.root.querySelector('#buildPanel') as HTMLElement | null;
    const dr = drawer?.getBoundingClientRect();
    const drawerBottom = !!dr && dr.width > o.width * 0.9; // sertar jos pe toată lățimea
    const wide = o.width > 700;
    const sr = ctx.stageEl.getBoundingClientRect();
    const cardW = wide ? 360 : o.width - 16;
    card.style.width = `${cardW}px`;
    // pe lat, rândul cu "Toată armata / Bază" e în colț: cartonașul coboară sub el
    const landscape = o.height <= 500;
    if (below) {
      card.style.top = `${topY + (landscape ? 56 : 0)}px`;
      card.style.bottom = 'auto';
    } else {
      const bottomEdge = drawerBottom && dr ? dr.top - o.top : o.height;
      card.style.top = 'auto';
      card.style.bottom = `${o.height - bottomEdge + 8}px`;
    }
    // desktop/pe lat: cartonașul în stânga, ca să nu acopere coloana din dreapta
    card.style.left = `${wide ? Math.round(sr.left - o.left + (sr.width - cardW) / 2) : 8}px`;
    if (r) {
      const cx = r.x + r.w / 2;
      const aboveTarget = !below; // cartonașul e jos, deci ținta e sus: săgeata arată în sus
      arrow.style.left = `${cx - 12}px`;
      arrow.style.top = aboveTarget ? `${r.y + r.h + 4}px` : `${r.y - 28}px`;
      arrow.classList.toggle('up', aboveTarget);
    }
  }

  function pick(): Tip | null {
    for (const t of TIPS) {
      if (seen.has(t.id)) continue;
      if (!t.ready()) continue;
      if (t.done?.() && !t.urgent) {
        // jucătorul a făcut deja asta singur: nu-l mai deranjăm
        seen.add(t.id);
        markTipSeen(t.id);
        continue;
      }
      return t;
    }
    return null;
  }

  function update() {
    const active = enabled && ctx.started && !ctx.paused && !ctx.gameOver && !ctx.helpOpen;
    if (!active) {
      if (layer.style.display !== 'none') layer.style.display = 'none';
      return;
    }
    if (current) {
      const urgent = TIPS.find((t) => t.urgent && !seen.has(t.id) && t.ready());
      if (urgent && !current.urgent) hide();
      else if (current.done?.()) {
        if (current.urgent) {
          hide(); // alerta a dispărut singură; o putem arăta din nou data viitoare
          hiddenUntil = performance.now() + GAP_MS;
        } else complete(current);
      } else if (!current.ready()) {
        hide();
      }
    }
    if (!current) {
      if (performance.now() < hiddenUntil) return;
      const t = pick();
      if (!t) return;
      current = t;
      t.onShow?.();
      layer.style.display = '';
      step.textContent = `Sfat ${Math.min(seen.size + 1, 99)}`;
      txt.textContent = t.text;
      if (t.urgent) {
        // alertele se arată o singură dată, apoi se consideră văzute
        seen.add(t.id);
        markTipSeen(t.id);
      }
    }
    if (current) place(current);
  }

  function dispose() {
    unsub();
    layer.remove();
  }

  return { update, dispose };
}
