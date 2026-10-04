import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { TERRAIN_ROCK, type SimEvent } from '../sim/types';

interface Ping { x: number; y: number; born: number }

export function initMinimap(ctx: UiContext): UiModule {
  const panel = el('div', { attrs: { id: 'minimapPanel' }, parent: ctx.root });
  const well = el('div', { className: 'mm-well', parent: panel });
  const stack = el('div', { className: 'mm-stack', parent: well });
  const shrink = el('button', { className: 'mm-shrink', attrs: { type: 'button', 'aria-label': 'Micșorează radarul' }, parent: panel }) as HTMLButtonElement;
  shrink.textContent = '–';
  shrink.addEventListener('click', (e) => {
    e.stopPropagation();
    ctx.sfx('click');
    ctx.setMinimapBig(false);
  });
  const bg = el('canvas', { attrs: { id: 'minimap', 'aria-label': 'Hartă mică' }, parent: stack });
  const fx = el('canvas', { attrs: { id: 'minimapFx' }, parent: stack });
  el('div', { className: 'mm-sweep', parent: stack });
  el('div', { className: 'mm-grid', parent: stack });
  const noRadar = el('div', { className: 'mm-nr', parent: stack });
  noRadar.innerHTML = '<span>Fără radar</span>';
  noRadar.style.display = 'none';

  const mapW = ctx.world.map.w;
  const mapH = ctx.world.map.h;
  bg.width = mapW;
  bg.height = mapH;
  const bgCtx = bg.getContext('2d')!;
  const img = bgCtx.createImageData(mapW, mapH);

  const fxCtx = fx.getContext('2d')!;
  let fxW = 0;
  let fxH = 0;

  const pings: Ping[] = [];
  let clock = 0;
  let lastDraw = 0;

  function resizeFx() {
    const r = stack.getBoundingClientRect();
    fxW = Math.max(1, Math.round(r.width));
    fxH = Math.max(1, Math.round(r.height));
    fx.width = fxW;
    fx.height = fxH;
  }
  const ro = new ResizeObserver(resizeFx);
  ro.observe(stack);
  resizeFx();

  const TEAM_RGB: Record<number, [number, number, number]> = {
    0: [90, 180, 255],
    1: [255, 80, 60],
    2: [255, 210, 58],
    3: [84, 209, 122],
  };

  function drawBg() {
    const map = ctx.world.map;
    const fog = ctx.world.fog[ctx.localTeam];
    const data = img.data;
    for (let i = 0; i < map.w * map.h; i++) {
      const seenState = fog[i];
      let r = 5, g = 12, b = 8;
      if (seenState > 0) {
        if (map.terrain[i] === TERRAIN_ROCK) {
          r = 16; g = 30; b = 22;
        } else if (map.ore[i] > 0) {
          r = 222; g = 166; b = 48;
        } else {
          r = 30; g = 62; b = 38;
        }
        if (seenState === 1) {
          r *= 0.55; g *= 0.55; b *= 0.55;
        }
      }
      const o = i * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
    for (const b of ctx.world.buildings.values()) {
      const cx = Math.floor(b.tx + b.w / 2);
      const cy = Math.floor(b.ty + b.h / 2);
      if (b.team !== ctx.localTeam && fog[cy * map.w + cx] === 0) continue; // clădirile inamice rămân pe hartă odată văzute
      const col = TEAM_RGB[b.team] ?? [200, 200, 200];
      for (let y = b.ty; y < b.ty + b.h; y++) {
        for (let x = b.tx; x < b.tx + b.w; x++) {
          if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
          const o = (y * map.w + x) * 4;
          data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2];
        }
      }
    }
    for (const u of ctx.world.units.values()) {
      const tx = Math.floor(u.x);
      const ty = Math.floor(u.y);
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      if (u.team !== ctx.localTeam && (fog[ty * map.w + tx] !== 2 || !radarOn())) continue; // unitățile inamice apar doar cu radar
      const col = TEAM_RGB[u.team] ?? [200, 200, 200];
      const o = (ty * map.w + tx) * 4;
      data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2];
    }
    bgCtx.putImageData(img, 0, 0);
  }

  function worldToMiniPx(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx / mapW) * fxW, y: (wy / mapH) * fxH };
  }
  function miniPxToWorld(px: number, py: number): { x: number; y: number } {
    return { x: (px / fxW) * mapW, y: (py / fxH) * mapH };
  }

  function drawFx() {
    fxCtx.clearRect(0, 0, fxW, fxH);
    const quad = ctx.renderer.viewQuad();
    fxCtx.strokeStyle = '#f5e6a8';
    fxCtx.lineWidth = 1.5;
    fxCtx.beginPath();
    quad.forEach((p, i) => {
      const s = worldToMiniPx(p.x, p.y);
      if (i === 0) fxCtx.moveTo(s.x, s.y);
      else fxCtx.lineTo(s.x, s.y);
    });
    fxCtx.closePath();
    fxCtx.stroke();
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const age = clock - p.born;
      if (age > 1.4) {
        pings.splice(i, 1);
        continue;
      }
      const s = worldToMiniPx(p.x, p.y);
      fxCtx.globalAlpha = Math.max(0, 1 - age / 1.4);
      fxCtx.strokeStyle = '#ff4a3a';
      fxCtx.lineWidth = 2;
      fxCtx.beginPath();
      fxCtx.arc(s.x, s.y, 3 + age * 14, 0, Math.PI * 2);
      fxCtx.stroke();
      fxCtx.globalAlpha = 1;
    }
  }

  let dragging = false;
  function pointFromEvent(e: PointerEvent): { x: number; y: number } {
    const r = stack.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  // Harta mică merge mereu (teren, bază, ce ai explorat). Radarul adaugă inamicii vizibili pe ea.
  const radarOn = () => (ctx.world.players.find((p) => p.team === ctx.localTeam) as { radar?: boolean } | undefined)?.radar !== false;
  const hasRadar = () => true;
  function onDown(e: PointerEvent) {
    if (!hasRadar()) return; // fără radar harta mică nu navighează
    if (!ctx.minimapBig) {
      // radarul mic: o atingere îl mărește
      ctx.sfx('click');
      ctx.setMinimapBig(true);
      return;
    }
    stack.setPointerCapture(e.pointerId);
    if (e.button === 2) {
      const p = pointFromEvent(e);
      const w = miniPxToWorld(p.x, p.y);
      if (ctx.selection.length) {
        ctx.queueCommand({ t: 'move', team: ctx.localTeam, ids: [...ctx.selection], x: w.x, y: w.y });
        ctx.renderer.pulse(w, 'move');
      }
      return;
    }
    dragging = true;
    const p = pointFromEvent(e);
    ctx.renderer.centerOn(miniPxToWorld(p.x, p.y));
  }
  function onMove(e: PointerEvent) {
    if (!dragging || !hasRadar()) return;
    const p = pointFromEvent(e);
    ctx.renderer.centerOn(miniPxToWorld(p.x, p.y));
  }
  function onUp(e: PointerEvent) {
    dragging = false;
    try { stack.releasePointerCapture(e.pointerId); } catch { /* ignorat */ }
  }
  stack.addEventListener('contextmenu', (e) => e.preventDefault());
  stack.addEventListener('pointerdown', onDown);
  stack.addEventListener('pointermove', onMove);
  stack.addEventListener('pointerup', onUp);

  function handleEvent(e: SimEvent) {
    if (e.type === 'underAttack' && e.team === ctx.localTeam) {
      pings.push({ x: e.x, y: e.y, born: clock });
    }
  }

  // static pe ecran când radarul lipsește
  const nz = document.createElement('canvas');
  nz.width = 40;
  nz.height = 40;
  const nzCtx = nz.getContext('2d')!;
  const nzImg = nzCtx.createImageData(40, 40);
  let prevRadar = false; // la start nu ai radar: nu anunța asta ca pe o pierdere
  let nzTick = 0;
  function drawNoise() {
    if ((nzTick++ & 1) === 0) {
      const d = nzImg.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = 20 + Math.random() * 90;
        d[i] = v * 0.8; d[i + 1] = v; d[i + 2] = v * 0.85; d[i + 3] = 255;
      }
      nzCtx.putImageData(nzImg, 0, 0);
      bgCtx.drawImage(nz, 0, 0, mapW, mapH);
    }
  }

  function update() {
    panel.classList.toggle('big', ctx.minimapBig);
    const radarNow = radarOn();
    const radar = hasRadar();
    if (radarNow !== prevRadar && ctx.started) {
      prevRadar = radarNow;
      ctx.toast(radarNow ? 'Radar activ: vezi unitățile inamice pe harta mică.' : 'Fără radar: nu mai vezi unitățile inamice pe harta mică.', radarNow ? 'info' : 'bad');
      ctx.sfx(radarNow ? 'radarOn' : 'radarOff');
    }
    prevRadar = radarNow;
    noRadar.style.display = radar ? 'none' : '';
    if (!radar) {
      drawNoise();
      fxCtx.clearRect(0, 0, fxW, fxH);
      return;
    }
    clock += 1 / 60;
    if (clock - lastDraw > 0.12) {
      lastDraw = clock;
      drawBg();
    }
    drawFx();
  }

  function dispose() {
    ro.disconnect();
    panel.remove();
  }

  return { update, dispose, handleEvent };
}
