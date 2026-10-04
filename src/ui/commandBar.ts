// Bara de comenzi din josul scenei: apare doar cu ce se poate face cu selecția curentă,
// plus indicațiile pentru uneltele armate (atac, recoltare, bombardare, punct de adunare)
// și confirmarea plasării unei clădiri (pe telefon).
import type { UiContext, UiModule, Tool } from './context';
import { el } from './dom';
import { iconSvg } from './icons';
import { BUILDINGS } from '../data/buildings';
import { nameOf, canShoot } from './buildData';
import type { UnitType, Unit, Building } from '../sim/types';

const PROMPT: Record<Exclude<Tool, null>, string> = {
  attackMove: 'Atinge harta: trupele merg acolo și atacă tot ce întâlnesc.',
  harvest: 'Atinge minereul (zona aurie): recoltoarele merg să-l adune.',
  bomb: 'Atinge ținta: bombardierele zboară acolo și lasă bombele.',
  rally: 'Atinge harta: aici se vor aduna unitățile noi.',
};

export function initCommandBar(ctx: UiContext): UiModule {
  const root = el('div', { attrs: { id: 'cmdArea' }, parent: ctx.bottomEl });

  // --- indicație / confirmare ---
  const banner = el('div', { className: 'cb-banner', attrs: { id: 'cbBanner' }, parent: root });
  const bannerTxt = el('div', { className: 'cb-txt', parent: banner });
  const bannerRow = el('div', { className: 'cb-brow', parent: banner });
  const okBtn = el('button', { className: 'btn-mil go', attrs: { type: 'button', id: 'btnConfirm' }, parent: bannerRow }) as HTMLButtonElement;
  okBtn.innerHTML = `${iconSvg('check')}<span>Construiește aici</span>`;
  const noBtn = el('button', { className: 'btn-mil', attrs: { type: 'button', id: 'btnBannerCancel' }, parent: bannerRow }) as HTMLButtonElement;
  noBtn.innerHTML = `${iconSvg('cancel')}<span>Anulează</span>`;
  const noLabel = noBtn.querySelector('span') as HTMLElement;
  okBtn.addEventListener('click', () => ctx.confirmPlace());
  noBtn.addEventListener('click', () => {
    ctx.sfx('cancel');
    if (ctx.placing) {
      if (ctx.placeTile) {
        ctx.placeTile = null; // doar renunț la locul ales; încă pot alege altul
        ctx.renderer.setGhost(null);
      } else {
        ctx.cancelPlacing();
        ctx.toast('Clădirea rămâne gata. Atinge cardul ca s-o pui.');
      }
    } else ctx.setTool(null);
  });

  // --- bara cu acțiuni ---
  const bar = el('div', { className: 'cb-bar', attrs: { id: 'cmdBar' }, parent: root });
  const info = el('div', { className: 'cb-info', parent: bar });
  const acts = el('div', { className: 'cb-acts', parent: bar });

  const btns = new Map<string, HTMLButtonElement>();
  function addBtn(id: string, icon: string, label: string, onClick: () => void) {
    const btn = el('button', { className: 'act', attrs: { type: 'button', id: `act-${id}` }, parent: acts }) as HTMLButtonElement;
    btn.innerHTML = `${iconSvg(icon)}<span>${label}</span>`;
    btn.addEventListener('click', () => {
      ctx.sfx('click');
      onClick();
    });
    btns.set(id, btn);
  }
  const toggle = (t: Exclude<Tool, null>) => () => ctx.setTool(ctx.tool === t ? null : t);
  addBtn('move', 'move', 'Mută', () => ctx.setTool(null));
  addBtn('attack', 'target', 'Atacă-mergi', toggle('attackMove'));
  addBtn('stop', 'stop', 'Stop', () => {
    ctx.setTool(null);
    ctx.queueCommand({ t: 'stop', team: ctx.localTeam, ids: [...ctx.selection] });
  });
  addBtn('harvest', 'harvest', 'Adună minereu', toggle('harvest'));
  addBtn('bomb', 'bomb', 'Bombardează', toggle('bomb'));
  addBtn('rally', 'flag', 'Punct de adunare', toggle('rally'));

  let infoKey = '';

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
    const hasProducer = blds.some((b) => b.type === 'factory' || b.type === 'barracks' || b.type === 'airfield');
    const hasHarv = units.some((u) => u.type === 'harvester');
    const hasBomber = units.some((u) => u.type === 'bomber');
    const hasShooter = units.some((u) => canShoot(u.type));
    // unealta armată n-are sens fără selecția potrivită
    if (ctx.tool === 'rally' && !hasProducer) ctx.setTool(null);
    else if (ctx.tool === 'attackMove' && !hasShooter) ctx.setTool(null);
    else if (ctx.tool === 'harvest' && !hasHarv) ctx.setTool(null);
    else if (ctx.tool === 'bomb' && !hasBomber) ctx.setTool(null);

    // --- indicație / confirmare ---
    let bShow = false;
    let confirm = false;
    let txt = '';
    if (ctx.placing) {
      bShow = true;
      const def = BUILDINGS[ctx.placing];
      if (ctx.placeTile) {
        const ok = ctx.sim.canPlace(ctx.world, ctx.localTeam, ctx.placing, ctx.placeTile.tx, ctx.placeTile.ty);
        confirm = true;
        txt = ok ? `${def.name}: loc bun. Confirmă sau alege altul.` : `${def.name}: aici nu se poate (roșu). Atinge alt loc.`;
        okBtn.disabled = !ok;
      } else {
        txt = ctx.isTouch
          ? `${def.name} e gata. Atinge harta ca să alegi locul.`
          : `${def.name} e gata. Click pe hartă ca s-o pui (click dreapta anulează).`;
      }
    } else if (ctx.tool) {
      bShow = true;
      txt = PROMPT[ctx.tool];
    }
    banner.style.display = bShow ? '' : 'none';
    okBtn.style.display = confirm ? '' : 'none';
    const lbl = ctx.placing && !ctx.placeTile ? 'Mai târziu' : 'Anulează';
    if (noLabel.textContent !== lbl) noLabel.textContent = lbl;
    if (bannerTxt.textContent !== txt) bannerTxt.textContent = txt;
    banner.classList.toggle('confirm', confirm);

    // --- bara de acțiuni ---
    const show = ctx.selection.length > 0 && !ctx.placing;
    bar.style.display = show ? '' : 'none';
    if (!show) return;

    const vis: Record<string, boolean> = {
      move: units.length > 0,
      attack: hasShooter,
      stop: units.length > 0,
      harvest: hasHarv,
      bomb: hasBomber,
      rally: hasProducer && !units.length,
    };
    for (const [id, b] of btns) {
      const v = vis[id] ? '' : 'none';
      if (b.style.display !== v) b.style.display = v;
    }
    btns.get('move')!.classList.toggle('on', ctx.tool === null);
    btns.get('attack')!.classList.toggle('on', ctx.tool === 'attackMove');
    btns.get('harvest')!.classList.toggle('on', ctx.tool === 'harvest');
    btns.get('bomb')!.classList.toggle('on', ctx.tool === 'bomb');
    btns.get('rally')!.classList.toggle('on', ctx.tool === 'rally');

    // rezumatul selecției
    const parts: string[] = [];
    const byType = new Map<UnitType, { n: number; hp: number; max: number }>();
    for (const u of units) {
      const g = byType.get(u.type) ?? { n: 0, hp: 0, max: 0 };
      g.n++;
      g.hp += u.hp;
      g.max += u.maxHp;
      byType.set(u.type, g);
    }
    let hp = 0;
    let max = 0;
    for (const [t, g] of byType) {
      parts.push(`<span class="sel-chip">${iconSvg(t)}<b>${g.n}×</b> ${nameOf(t)}</span>`);
      hp += g.hp;
      max += g.max;
    }
    for (const b of blds) {
      parts.push(`<span class="sel-chip">${iconSvg(b.type)}<b>${nameOf(b.type)}</b></span>`);
      hp += b.hp;
      max += b.maxHp;
    }
    const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;
    const key = parts.join('') + Math.round(frac * 50);
    if (key !== infoKey) {
      infoKey = key;
      const col = frac > 0.55 ? 'var(--ok)' : frac > 0.28 ? 'var(--amber)' : 'var(--red)';
      info.innerHTML = `<div class="sel-list">${parts.join('')}</div><span class="hpbar" title="Viață"><i style="width:${Math.round(frac * 100)}%;background:${col}"></i></span>`;
    }
  }

  function dispose() {
    root.remove();
  }
  return { update, dispose };
}
