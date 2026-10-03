import type { UiContext, UiModule } from './context';
import { el } from './dom';
import { TERRAIN_ROCK, type SimEvent } from '../sim/types';

interface Ping { x: number; y: number; born: number }

export function initMinimap(ctx: UiContext): UiModule {
  const panel = el('div', { attrs: { id: 'minimapPanel' }, parent: ctx.root });
  const head = el('div', { className: 'mm-head upper', parent: panel });
  head.innerHTML = '<span>Hartă</span>';
  const stack = el('div', { className: 'mm-stack', parent: panel });
  const bg = el('canvas', { attrs: { id: 'minimap', 'aria-label': 'Hartă mică' }, parent: stack });
  const fx = el('canvas', { attrs: { id: 'minimapFx' }, parent: stack });

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
    0: [61, 155, 255],
    1: [255, 74, 58],
    2: [111, 217, 127],
    3: [240, 177, 58],
  };

  function drawBg() {
    const map = ctx.world.map;
    const fog = ctx.world.fog[ctx.localTeam];
    const data = img.data;
    for (let i = 0; i < map.w * map.h; i++) {
      const seenState = fog[i];
      let r = 10, g = 11, b = 9;
      if (seenState > 0) {
        if (map.terrain[i] === TERRAIN_ROCK) {
          r = 38; g = 41; b = 35;
        } else if (map.ore[i] > 0) {
          r = 150; g = 115; b = 42;
        } else {
          r = 42; g = 46; b = 36;
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
      if (b.team !== ctx.localTeam && fog[cy * map.w + cx] !== 2) continue;
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
      if (u.team !== ctx.localTeam && fog[ty * map.w + tx] !== 2) continue;
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
    fxCtx.strokeStyle = '#ffffff';
    fxCtx.lineWidth = 1;
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
  function onDown(e: PointerEvent) {
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
    if (!dragging) return;
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

  function update() {
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
