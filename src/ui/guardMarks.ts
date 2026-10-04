// Mici scuturi albastre deasupra unităților din gardă, desenate în DOM (randarea nu se atinge).
// Maximum 30 de marcaje, doar pentru gărzile de pe ecran, ascunse când harta e mult depărtată.
import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { iconSvg } from './icons';

const MAX = 30;
const FAR_TILES = 46; // peste această lățime vizibilă, marcajele dispar

export function initGuardMarks(ctx: UiContext): UiModule {
  const layer = el('div', { attrs: { id: 'guardMarks' }, parent: ctx.stageEl });
  const pool: HTMLElement[] = [];
  for (let i = 0; i < MAX; i++) {
    const m = el('div', { className: 'gmark', html: iconSvg('shield'), parent: layer });
    m.style.display = 'none';
    pool.push(m);
  }
  let used = 0;
  let frame = 0;

  function update() {
    frame++;
    let n = 0;
    // fără gărzi nu facem nimic (cazul obișnuit)
    let any = false;
    for (const u of ctx.world.units.values()) {
      if (u.team === ctx.localTeam && u.role === 'guard') {
        any = true;
        break;
      }
    }
    if (any && ctx.started) {
      const q = ctx.renderer.viewQuad();
      let minX = 1e9, maxX = -1e9;
      for (const p of q) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
      if (maxX - minX <= FAR_TILES) {
        const cv = ctx.stageEl.querySelector('#gamecanvas') as HTMLElement;
        const w = cv.clientWidth;
        const h = cv.clientHeight;
        for (const u of ctx.world.units.values()) {
          if (n >= MAX) break;
          if (u.team !== ctx.localTeam || u.role !== 'guard') continue;
          const s = ctx.renderer.worldToScreen({ x: u.x, y: u.y });
          if (!s || s.x < -10 || s.y < -10 || s.x > w + 10 || s.y > h + 10) continue;
          const m = pool[n++];
          m.style.display = '';
          m.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        }
      }
    }
    for (let i = n; i < used; i++) pool[i].style.display = 'none';
    used = n;
    void frame;
  }
  function dispose() {
    layer.remove();
  }
  return { update, dispose };
}
