// Foaia de ajutor ("?" din bara de sus): toate comenzile + descrierea clădirilor și a unităților,
// cu comutator pentru sfaturi. Jocul stă în pauză cât timp e deschisă.
import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { BUILD_LIST, UNIT_GROUPS, PRODUCERS, nameOf } from './buildData';
import { tipsEnabled, setTipsEnabled, resetSeenTips, onTipsChange } from './prefs';

const TOUCH_HELP: [string, string][] = [
  ['Atinge o unitate', 'o selectezi. Dublu-atingere: selectezi toate unitățile de același fel de pe ecran.'],
  ['Atinge harta', 'unitățile selectate merg acolo. Dacă atingi un inamic, îl atacă.'],
  ['Țin apăsat și trag', 'chenar de selecție, pentru mai multe unități deodată.'],
  ['Trag cu un deget', 'mut harta. Cu două degete (ciupit) apropii sau depărtez.'],
  ['Radarul', 'atinge-l ca să muți camera în acel loc.'],
  ['Bara de jos', 'Mută, Atacă-mergi, Stop. La recoltoare: Adună minereu. La bombardiere: Bombardează. La clădiri de producție: Punct de adunare.'],
  ['Toată armata', 'selectează toate trupele de luptă.'],
  ['Alertele', 'atinge „Baza e atacată” sau „recoltoare degeaba” ca să mergi acolo.'],
  ['Construcții', 'atingi cardul, aștepți, atingi harta unde o vrei și confirmi cu „Construiește aici”.'],
  ['Anulează', 'oricând, pe card: banii se întorc integral.'],
];
const MOUSE_HELP: [string, string][] = [
  ['Click stânga', 'selectezi o unitate sau tragi un chenar peste mai multe. Dublu-click: toate de același fel.'],
  ['Click dreapta', 'ordinul potrivit: atac pe inamic, recoltare pe minereu, mutare pe teren liber.'],
  ['Rotița mouse-ului', 'zoom. Marginile ecranului sau săgețile mută harta.'],
  ['A', 'Atacă-mergi. S: Stop. H: înapoi la bază. Spațiu: la ultima alertă.'],
  ['Ctrl + 1…9', 'salvezi un grup; apoi 1…9 îl selectezi.'],
  ['P sau F10', 'pauză. Esc anulează ce ai început.'],
  ['Construcții', 'click pe card, aștepți, click pe hartă. Click dreapta pe card anulează și primești banii înapoi.'],
];

export function initHelp(ctx: UiContext): UiModule {
  const overlay = el('div', { className: 'sheet-wrap', attrs: { id: 'helpSheet' }, parent: ctx.root });
  const sheet = el('div', { className: 'sheet', attrs: { role: 'dialog', 'aria-label': 'Ajutor' }, parent: overlay });

  const head = el('div', { className: 'sheet-head', parent: sheet });
  el('h2', { text: 'Ajutor', parent: head });
  const closeBtn = el('button', { className: 'btn-sq', attrs: { type: 'button', id: 'helpClose', 'aria-label': 'Închide' }, parent: head }) as HTMLButtonElement;
  closeBtn.innerHTML = iconSvg('cancel');

  const body = el('div', { className: 'sheet-body', parent: sheet });

  // --- sfaturi ---
  const tipsBox = el('div', { className: 'help-tips', parent: body });
  const toggle = el('button', { className: 'switch', attrs: { type: 'button', role: 'switch', id: 'tipsSwitch' }, parent: tipsBox }) as HTMLButtonElement;
  toggle.innerHTML = '<i class="knob"></i><span>Sfaturi în joc</span><b></b>';
  const toggleState = toggle.querySelector('b') as HTMLElement;
  const replay = el('button', { className: 'btn-mil', text: 'Reia sfaturile de la început', attrs: { type: 'button', id: 'tipsReplay' }, parent: tipsBox });
  function syncSwitch() {
    const on = tipsEnabled();
    toggle.setAttribute('aria-checked', on ? 'true' : 'false');
    toggle.classList.toggle('on', on);
    toggleState.textContent = on ? 'Pornite' : 'Oprite';
  }
  syncSwitch();
  const unsub = onTipsChange(syncSwitch);
  toggle.addEventListener('click', () => {
    ctx.sfx('click');
    setTipsEnabled(!tipsEnabled());
  });
  replay.addEventListener('click', () => {
    ctx.sfx('ok');
    resetSeenTips();
    setTipsEnabled(true);
    ctx.toast('Sfaturile pornesc de la început.');
    close();
  });

  // --- comenzi ---
  function section(title: string): HTMLElement {
    el('h3', { text: title, parent: body });
    return el('div', { className: 'help-list', parent: body });
  }
  const first = ctx.isTouch ? TOUCH_HELP : MOUSE_HELP;
  const second = ctx.isTouch ? MOUSE_HELP : TOUCH_HELP;
  for (const [title, list] of [
    [ctx.isTouch ? 'Comenzi pe telefon' : 'Comenzi cu mouse și tastatură', first],
    [ctx.isTouch ? 'Comenzi cu mouse și tastatură' : 'Comenzi pe telefon', second],
  ] as [string, [string, string][]][]) {
    const box = section(title);
    for (const [k, v] of list) el('p', { html: `<b>${k}</b> ${v}`, parent: box });
  }

  // --- clădiri ---
  const bBox = section('Clădiri');
  for (const t of BUILD_LIST) {
    const d = BUILDINGS[t];
    const need = d.requires ? ` Necesită ${nameOf(d.requires)}.` : '';
    const row = el('div', { className: 'help-row', parent: bBox });
    row.innerHTML = `<span class="c-icon">${iconSvg(t)}</span><div><b>${d.name}</b> <em class="tabular">${d.cost} credite</em><p>${d.desc}${need}</p></div>`;
  }
  // --- unități ---
  for (const g of PRODUCERS) {
    const box = section(`Unități: ${nameOf(g)}`);
    for (const t of UNIT_GROUPS[g]) {
      const d = UNITS[t];
      const row = el('div', { className: 'help-row', parent: box });
      row.innerHTML = `<span class="c-icon">${iconSvg(t)}</span><div><b>${d.name}</b> <em class="tabular">${d.cost} credite</em><p>${d.desc}</p></div>`;
    }
  }

  let wasPaused = false;
  function open() {
    if (ctx.helpOpen) return;
    wasPaused = ctx.paused;
    ctx.helpOpen = true;
    ctx.paused = true;
    syncSwitch();
    overlay.classList.add('show');
    body.scrollTop = 0;
  }
  function close() {
    if (!ctx.helpOpen) return;
    ctx.helpOpen = false;
    if (!wasPaused && !ctx.gameOver) ctx.paused = false;
    overlay.classList.remove('show');
  }
  closeBtn.addEventListener('click', () => {
    ctx.sfx('click');
    close();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  const onHelp = () => (ctx.helpOpen ? close() : ctx.started && !ctx.gameOver && open());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && ctx.helpOpen) close();
    else if ((e.key === '?' || e.key === 'F1') && ctx.started) {
      e.preventDefault();
      onHelp();
    }
  };
  ctx.root.addEventListener('fdf-help', onHelp);
  window.addEventListener('keydown', onKey);

  function update() {
    /* nimic pe cadru */
  }
  function dispose() {
    unsub();
    ctx.root.removeEventListener('fdf-help', onHelp);
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  return { update, dispose };
}
