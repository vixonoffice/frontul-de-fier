// Foaia de ajutor ("?" din bara de sus): toate comenzile + descrierea clădirilor și a unităților,
// cu comutator pentru sfaturi. Jocul stă în pauză cât timp e deschisă.
import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { BUILD_LIST, UNIT_GROUPS, PRODUCERS, nameOf } from './buildData';
import { tipsEnabled, setTipsEnabled, resetSeenTips, onTipsChange, assistFeedOn, setAssistFeed, soundPrefs, setSoundPrefs, onSoundChange } from './prefs';

const TOUCH_HELP: [string, string][] = [
  ['Atinge o unitate', 'o selectezi. Dublu-atingere: selectezi toate unitățile de același fel de pe ecran.'],
  ['Atinge harta', 'unitățile selectate merg acolo. Dacă atingi un inamic, îl atacă. Cu tava deschisă, atingerea o închide.'],
  ['Țin apăsat și trag', 'chenar de selecție, pentru mai multe unități deodată.'],
  ['Trag cu un deget', 'mut harta. Cu două degete: mut harta și apropii sau depărtez (ciupit).'],
  ['Radarul din colț', 'atinge-l ca să-l măreşti; mărit, atinge-l ca să muți camera. „–” îl micșorează.'],
  ['Dock-ul de jos', 'Clădiri, Fabrică, Cazarmă, Aerodrom deschid o tavă cu pătrate. Armată selectează trupele, Bază te duce acasă.'],
  ['Pătratele din tavă', 'atinge ca să începi. „x” anulează și primești banii înapoi. Apăsare lungă: descrierea.'],
  ['Clădire gata', 'atinge pătratul ei, apoi atinge harta: se pune acolo, fără confirmare. Poți trage degetul ca să țintești și ridici ca să pui.'],
  ['Selecție', 'rândul de deasupra dock-ului: Atacă, Stop, Adună minereu, Bombardează, Punct de adunare.'],
  ['Asistent', 'butonul Asistent din dock are trei comutatoare: Dezvoltare bază, Apărare și Atac (producție de armată). Se pornesc independent și îți construiesc baza din banii pe care îi ai. Armata o conduci tot tu. Lămpile de pe buton arată ce e pornit.'],
  ['Gardă și atac', 'fiecare unitate de luptă e fie în forța de atac, fie în gardă. Garda ține un post lângă bază și merge singură unde e atacată o clădire sau un recoltor, apoi se întoarce. Forța de atac pleacă în ofensive. „Armată” din dock selectează grupurile, iar „Pune în gardă” / „Pune la atac” le mută. Pentru ofensivă totală alegi „Toată armata” și atingi ținta.'],
  ['Toți contra tuturor', 'Toți sunt împotriva tuturor. Câștigă ultimul rămas. Punctele colorate din bara de sus arată cine mai e în joc.'],
  ['Curent', 'clădirile consumă curent, iar Centrala îl produce. Când consumul e mai mare decât producția (contorul de sus se face roșu), producția și turelele merg la jumătate. Atinge contorul ca să afli mai multe.'],
  ['Reparații și grade', '„Repară” pe o clădire selectată o repară cu bani, pe măsură ce își recapătă viața. Unitățile care distrug destule ținte devin Veteran și apoi Elită: mai puternice și mai rezistente.'],
  ['Perimetrul asistentului', 'asistentul își alege singur locul pentru clădiri, în jurul bazei: rafinării și producție în spate, turele spre margine. Poți oricând să mai pui tu clădiri.'],
  ['Radar', 'fără un Radar cu curent, miniharta arată doar static și nu mai poți naviga pe ea. Construiește-l din Clădiri, secțiunea Bază.'],
  ['Ziduri', 'după un zid, următorul începe singur. Atinge sau trage degetul pe hartă ca să-ți pictezi linia de ziduri (câte unul pe fiecare pătrat, când e gata). „Anulează” oprește lanțul.'],
  ['Cozi lungi', 'în tava unei clădiri de producție, butonul ×1 / ×5 / ×25 spune câte pui la coadă la o atingere. Poți pune până la 99 în coadă. Plătești fiecare unitate abia când îi vine rândul. „x” scoate una; ține apăsat pe „x” ca să le scoți pe toate.'],
  ['Vinde', 'selectează o clădire, „Vinde” apoi încă o atingere pentru confirmare. Primești jumătate din cost.'],
];
const MOUSE_HELP: [string, string][] = [
  ['Click stânga', 'selectezi o unitate sau tragi un chenar peste mai multe. Dublu-click: toate de același fel.'],
  ['Click dreapta', 'ordinul potrivit: atac pe inamic, recoltare pe minereu, mutare pe teren liber.'],
  ['Rotița mouse-ului', 'zoom. Marginile ecranului sau săgețile mută harta.'],
  ['A', 'Atacă-mergi. S: Stop. H: înapoi la bază. Spațiu: la ultima alertă.'],
  ['Ctrl + 1…9', 'salvezi un grup; apoi 1…9 îl selectezi.'],
  ['P sau F10', 'pauză. Esc anulează ce ai început.'],
  ['Construcții', 'click pe pătrat, aștepți, click pe pătratul gata, apoi click pe hartă. „x” pe pătrat anulează și primești banii înapoi. Vinde: selectezi clădirea și apeși „Vinde” de două ori.'],
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

  const feed = el('button', { className: 'switch', attrs: { type: 'button', role: 'switch', id: 'feedSwitch' }, parent: tipsBox }) as HTMLButtonElement;
  feed.innerHTML = '<i class="knob"></i><span>Mesaje de la asistent</span><b></b>';
  const syncFeed = () => {
    const on = assistFeedOn();
    feed.classList.toggle('on', on);
    feed.setAttribute('aria-checked', on ? 'true' : 'false');
    (feed.querySelector('b') as HTMLElement).textContent = on ? 'Pornite' : 'Oprite';
  };
  syncFeed();
  feed.addEventListener('click', () => {
    ctx.sfx('click');
    setAssistFeed(!assistFeedOn());
    syncFeed();
  });

  // --- sunet ---
  el('h3', { text: 'Sunet', parent: body });
  const sndBox = el('div', { className: 'help-tips', parent: body });
  const sliders: { key: 'master' | 'music' | 'sfx'; input: HTMLInputElement; out: HTMLElement }[] = [];
  for (const [key, label] of [['master', 'Volum general'], ['music', 'Muzică'], ['sfx', 'Efecte']] as const) {
    const row = el('label', { className: 'slider-row', parent: sndBox });
    row.innerHTML = `<span>${label}</span><input type="range" min="0" max="100" step="1" id="vol-${key}" aria-label="${label}"><b class="tabular"></b>`;
    const input = row.querySelector('input') as HTMLInputElement;
    const out = row.querySelector('b') as HTMLElement;
    input.addEventListener('input', () => {
      setSoundPrefs({ [key]: Number(input.value) / 100 });
      out.textContent = `${input.value}%`;
    });
    // un clic scurt de probă la ridicarea degetului, ca să se audă nivelul
    input.addEventListener('change', () => ctx.sfx('click'));
    sliders.push({ key, input, out });
  }
  const mkSwitch = (id: string, label: string, get: () => boolean, set: (v: boolean) => void) => {
    const sw = el('button', { className: 'switch', attrs: { type: 'button', role: 'switch', id }, parent: sndBox }) as HTMLButtonElement;
    sw.innerHTML = `<i class="knob"></i><span>${label}</span><b></b>`;
    const paint = () => {
      const on = get();
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
      (sw.querySelector('b') as HTMLElement).textContent = on ? 'Da' : 'Nu';
    };
    sw.addEventListener('click', () => {
      set(!get());
      paint();
      ctx.sfx(get() ? 'on' : 'off');
    });
    return paint;
  };
  const paintMute = mkSwitch('muteSwitch', 'Sunet oprit (mut)', () => soundPrefs().mute, (v) => setSoundPrefs({ mute: v }));
  const paintVib = mkSwitch('vibSwitch', 'Vibrații', () => soundPrefs().vibrate, (v) => setSoundPrefs({ vibrate: v }));
  const syncSound = () => {
    const p = soundPrefs();
    for (const s of sliders) {
      s.input.value = String(Math.round(p[s.key] * 100));
      s.out.textContent = `${s.input.value}%`;
    }
    paintMute();
    paintVib();
  };
  syncSound();
  const unsubSnd = onSoundChange(syncSound);

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
    syncFeed();
    syncSound();
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
    unsubSnd();
    ctx.root.removeEventListener('fdf-help', onHelp);
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  return { update, dispose };
}
