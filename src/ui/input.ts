import type { UiContext, UiModule } from './context';
import { el, clamp } from './dom';
import type { BuildingType, EntityId, UnitType, Vec } from '../sim/types';
import { BUILDINGS } from '../data/buildings';
import { canShoot, canHarvest } from './buildData';

const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 350;
const DOUBLE_TAP_MS = 320;
const EDGE_PX = 26;
const KEY_PAN_PX_S = 560;
const WHEEL_ZOOM_STEP = 1.12;

type Pt = { x: number; y: number };

type Gesture =
  | { mode: 'undecided'; x0: number; y0: number; button: number; isTouch: boolean }
  | { mode: 'pan'; lastX: number; lastY: number }
  | { mode: 'box' }
  | { mode: 'pinch' }
  | { mode: 'aim' }
  | null;

function distPt(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function midPt(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function initInput(ctx: UiContext, canvas: HTMLCanvasElement): UiModule {
  const stage = canvas.parentElement as HTMLElement;
  const boxDiv = el('div', { attrs: { id: 'boxSelect' }, parent: stage });

  const ptrs = new Map<number, Pt>();
  let gest: Gesture = null;
  let hover: Pt | null = null;
  let lastPtrType = 'mouse';
  /** Locul țintit cu degetul în modul de plasare (fantoma urmează degetul, se pune la ridicare). */
  let aimTile: { tx: number; ty: number } | null = null;
  let aimStart: Pt = { x: 0, y: 0 };
  let aimDragged = false;
  const AIM_LIFT_PX = 44; // fantoma stă puțin deasupra degetului ca să se vadă
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let twoFinger: { dist: number; mid: Pt; moved: boolean; startedAt: number } | null = null;
  let lastTapAt = 0;
  let lastTapPos: Pt = { x: -999, y: -999 };
  let lastTapEntity: EntityId | null = null;
  let ghostShown = false;
  const held = new Set<string>();
  const lastDigitTime = new Map<number, number>();
  let lastFrameAt = performance.now();

  function clearLongPress() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  function relPoint(e: PointerEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function showBox(x0: number, y0: number, x1: number, y1: number) {
    const x = Math.min(x0, x1);
    const y = Math.min(y0, y1);
    boxDiv.style.display = 'block';
    boxDiv.style.left = `${x}px`;
    boxDiv.style.top = `${y}px`;
    boxDiv.style.width = `${Math.abs(x1 - x0)}px`;
    boxDiv.style.height = `${Math.abs(y1 - y0)}px`;
  }
  function hideBox() {
    boxDiv.style.display = 'none';
  }

  function isOwn(id: EntityId): boolean {
    const u = ctx.world.units.get(id);
    if (u) return u.team === ctx.localTeam;
    const b = ctx.world.buildings.get(id);
    return !!b && b.team === ctx.localTeam;
  }
  function isEnemy(id: EntityId): boolean {
    const u = ctx.world.units.get(id);
    if (u) return u.team !== ctx.localTeam;
    const b = ctx.world.buildings.get(id);
    return !!b && b.team !== ctx.localTeam;
  }

  function selectToggleOrReplace(id: EntityId, additive: boolean) {
    if (additive) {
      if (ctx.selection.includes(id)) ctx.setSelection(ctx.selection.filter((x) => x !== id));
      else ctx.setSelection([...ctx.selection, id]);
    } else {
      ctx.setSelection([id]);
    }
  }

  function pointInQuad(p: Vec, quad: Vec[]): boolean {
    let sign = 0;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i];
      const b = quad[(i + 1) % quad.length];
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      const s = Math.sign(cross);
      if (s === 0) continue;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  }

  function selectAllOfTypeOnScreen(fromId: EntityId) {
    const u = ctx.world.units.get(fromId);
    if (!u) return;
    const quad = ctx.renderer.viewQuad();
    const ids: EntityId[] = [];
    for (const o of ctx.world.units.values()) {
      if (o.team === ctx.localTeam && o.type === u.type && pointInQuad({ x: o.x, y: o.y }, quad)) ids.push(o.id);
    }
    ctx.setSelection(ids);
  }

  function oreAt(wp: Vec): boolean {
    const map = ctx.world.map;
    const tx = Math.floor(wp.x);
    const ty = Math.floor(wp.y);
    return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && map.ore[ty * map.w + tx] > 0;
  }
  function unitsOf(ids: EntityId[], pred: (t: UnitType) => boolean): EntityId[] {
    return ids.filter((id) => {
      const u = ctx.world.units.get(id);
      return !!u && pred(u.type);
    });
  }
  const onlyUnits = (ids: EntityId[]) => ids.filter((id) => ctx.world.units.has(id));

  /** Ordin dat cu o atingere / click dreapta, în funcție de ce e selectat și de ce e sub deget. */
  function smartCommand(worldPt: Vec | null, entityId: EntityId | null) {
    const sel = onlyUnits(ctx.selection);
    if (!worldPt || !sel.length) return;
    const team = ctx.localTeam;
    const bombers = unitsOf(sel, (t) => t === 'bomber');
    const harvesters = unitsOf(sel, (t) => canHarvest(t));
    const shooters = unitsOf(sel, (t) => canShoot(t));
    if (entityId !== null && isEnemy(entityId)) {
      if (shooters.length) ctx.queueCommand({ t: 'attack', team, ids: shooters, targetId: entityId });
      if (bombers.length) ctx.queueCommand({ t: 'bomb', team, ids: bombers, x: worldPt.x, y: worldPt.y });
      const rest = sel.filter((id) => !shooters.includes(id) && !bombers.includes(id));
      if (rest.length) ctx.queueCommand({ t: 'move', team, ids: rest, x: worldPt.x, y: worldPt.y });
      ctx.renderer.pulse(worldPt, 'attack');
      return;
    }
    if (harvesters.length && oreAt(worldPt)) {
      ctx.queueCommand({ t: 'harvest', team, ids: harvesters, x: worldPt.x, y: worldPt.y });
      const rest = sel.filter((id) => !harvesters.includes(id));
      if (rest.length) ctx.queueCommand({ t: 'move', team, ids: rest, x: worldPt.x, y: worldPt.y });
      ctx.renderer.pulse(worldPt, 'move');
      return;
    }
    ctx.queueCommand({ t: 'move', team, ids: sel, x: worldPt.x, y: worldPt.y });
    ctx.renderer.pulse(worldPt, 'move');
  }

  /** Ordin dat de o unealtă armată din bara de comenzi (un singur tap, apoi unealta se stinge). */
  function toolCommand(tool: NonNullable<UiContext['tool']>, worldPt: Vec | null, entityId: EntityId | null) {
    if (!worldPt) return;
    const team = ctx.localTeam;
    const sel = onlyUnits(ctx.selection);
    if (tool === 'rally') {
      ctx.queueCommand({ t: 'rally', team, x: worldPt.x, y: worldPt.y });
      ctx.renderer.pulse(worldPt, 'move');
      ctx.sfx('ok');
    } else if (tool === 'attackMove') {
      const ids = unitsOf(sel, (t) => canShoot(t));
      if (entityId !== null && isEnemy(entityId)) ctx.queueCommand({ t: 'attack', team, ids, targetId: entityId });
      else ctx.queueCommand({ t: 'attackMove', team, ids, x: worldPt.x, y: worldPt.y });
      ctx.renderer.pulse(worldPt, 'attack');
      const rest = sel.filter((id) => !ids.includes(id));
      if (rest.length) ctx.queueCommand({ t: 'move', team, ids: rest, x: worldPt.x, y: worldPt.y });
    } else if (tool === 'harvest') {
      const ids = unitsOf(sel, (t) => canHarvest(t));
      if (!oreAt(worldPt)) ctx.toast('Aici nu e minereu. Caută zona aurie de pe hartă.', 'bad');
      ctx.queueCommand({ t: 'harvest', team, ids, x: worldPt.x, y: worldPt.y });
      ctx.renderer.pulse(worldPt, 'move');
    } else if (tool === 'bomb') {
      const ids = unitsOf(sel, (t) => t === 'bomber');
      ctx.queueCommand({ t: 'bomb', team, ids, x: worldPt.x, y: worldPt.y });
      ctx.renderer.pulse(worldPt, 'attack');
    }
    ctx.setTool(null);
  }

  function placementTile(wp: Vec, type: BuildingType): { tx: number; ty: number } {
    const def = BUILDINGS[type];
    const map = ctx.world.map;
    return {
      tx: clamp(Math.round(wp.x - def.w / 2), 0, map.w - 1),
      ty: clamp(Math.round(wp.y - def.h / 2), 0, map.h - 1),
    };
  }

  function aimAt(p: Pt) {
    if (!ctx.placing) return;
    // o simplă atingere pune exact sub deget; dacă trage, fantoma stă puțin deasupra degetului
    if (distPt(p, aimStart) > 10) aimDragged = true;
    const wp = ctx.renderer.pick(p.x, aimDragged ? Math.max(0, p.y - AIM_LIFT_PX) : p.y).world;
    if (wp) aimTile = placementTile(wp, ctx.placing);
  }

  function handleTap(p: Pt, button: number, shift: boolean, isTouch: boolean) {
    const result = ctx.renderer.pick(p.x, p.y);

    if (ctx.trayTab) {
      ctx.closeTray();
      return;
    }
    if (ctx.placing) {
      if (button === 2) {
        ctx.cancelPlacing();
      } else if (result.world) {
        const t = placementTile(result.world, ctx.placing);
        ctx.tryPlaceAt(t.tx, t.ty);
      }
      return;
    }
    if (ctx.tool) {
      if (button === 2) ctx.setTool(null);
      else toolCommand(ctx.tool, result.world, result.entityId);
      return;
    }
    if (button === 2) {
      smartCommand(result.world, result.entityId);
      return;
    }
    if (result.entityId !== null && isOwn(result.entityId)) {
      const now = performance.now();
      const isDbl = isTouch && now - lastTapAt < DOUBLE_TAP_MS && distPt(p, lastTapPos) < 24 && lastTapEntity === result.entityId;
      lastTapAt = now;
      lastTapPos = p;
      lastTapEntity = result.entityId;
      if (isDbl) {
        selectAllOfTypeOnScreen(result.entityId);
        return;
      }
      selectToggleOrReplace(result.entityId, shift);
      return;
    }
    if (isTouch && onlyUnits(ctx.selection).length) {
      smartCommand(result.world, result.entityId);
      return;
    }
    if (!shift) ctx.setSelection([]);
  }

  function finalizeBox(shift: boolean) {
    // citim dreptunghiul ÎNAINTE de a ascunde cutia — un element display:none are rect gol
    const x0 = parseFloat(boxDiv.style.left || '0');
    const y0 = parseFloat(boxDiv.style.top || '0');
    const bw = parseFloat(boxDiv.style.width || '0');
    const bh = parseFloat(boxDiv.style.height || '0');
    hideBox();
    const got = ctx.renderer.pickBox(x0, y0, x0 + bw, y0 + bh, ctx.localTeam);
    if (got.length) ctx.setSelection(shift ? Array.from(new Set([...ctx.selection, ...got])) : got);
  }

  function onPointerDown(e: PointerEvent) {
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignorat — unele dispozitive/evenimente sintetice nu permit capturarea */
    }
    const p = relPoint(e);
    ptrs.set(e.pointerId, p);
    hover = p;
    lastPtrType = e.pointerType;

    if (ptrs.size >= 2) {
      clearLongPress();
      hideBox();
      const pts = Array.from(ptrs.values());
      twoFinger = { dist: distPt(pts[0], pts[1]), mid: midPt(pts[0], pts[1]), moved: false, startedAt: performance.now() };
      gest = { mode: 'pinch' };
      return;
    }

    const isTouch = e.pointerType !== 'mouse';
    if (isTouch && ctx.placing) {
      gest = { mode: 'aim' };
      aimStart = p;
      aimDragged = false;
      aimAt(p);
      return;
    }
    if (e.button === 1) {
      gest = { mode: 'pan', lastX: p.x, lastY: p.y };
      return;
    }
    gest = { mode: 'undecided', x0: p.x, y0: p.y, button: e.button, isTouch };
    if (isTouch) {
      longPressTimer = setTimeout(() => {
        if (gest && gest.mode === 'undecided') {
          gest = { mode: 'box' };
          showBox(p.x, p.y, p.x, p.y);
        }
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e: PointerEvent) {
    const p = relPoint(e);
    hover = p;
    if (e.pointerType === 'mouse') lastPtrType = 'mouse';
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, p);

    if (ptrs.size >= 2) {
      const pts = Array.from(ptrs.values());
      const d = distPt(pts[0], pts[1]);
      const mid = midPt(pts[0], pts[1]);
      if (twoFinger) {
        if (Math.abs(d - twoFinger.dist) > 14 || distPt(mid, twoFinger.mid) > 18) twoFinger.moved = true;
        if (Math.abs(d - twoFinger.dist) > 1.5 && twoFinger.dist > 0) {
          ctx.renderer.zoomBy(d / twoFinger.dist, mid.x, mid.y);
        }
        ctx.renderer.panBy(-(mid.x - twoFinger.mid.x), -(mid.y - twoFinger.mid.y));
        twoFinger.dist = d;
        twoFinger.mid = mid;
      }
      return;
    }

    if (!gest) return;
    if (gest.mode === 'aim') {
      aimAt(p);
      return;
    }
    if (gest.mode === 'undecided') {
      const { x0, y0, isTouch: touchStart, button } = gest;
      if (distPt(p, { x: x0, y: y0 }) <= DRAG_THRESHOLD) return;
      clearLongPress();
      if (!touchStart && button === 0 && !ctx.placing && !ctx.tool) {
        gest = { mode: 'box' };
        showBox(x0, y0, p.x, p.y);
      } else {
        gest = { mode: 'pan', lastX: x0, lastY: y0 };
      }
      return;
    }
    if (gest.mode === 'pan') {
      ctx.renderer.panBy(-(p.x - gest.lastX), -(p.y - gest.lastY));
      gest.lastX = p.x;
      gest.lastY = p.y;
    } else if (gest.mode === 'box') {
      const r = boxDiv; // folosim x0/y0 reținute în stilul curent
      const left = parseFloat(r.style.left || '0');
      const top = parseFloat(r.style.top || '0');
      showBox(left, top, p.x, p.y);
    }
  }

  function onPointerUp(e: PointerEvent) {
    const p = relPoint(e);
    ptrs.delete(e.pointerId);
    clearLongPress();

    if (gest && gest.mode === 'pinch') {
      if (ptrs.size < 2) {
        if (twoFinger && !twoFinger.moved && performance.now() - twoFinger.startedAt < 300) {
          ctx.setSelection([]);
        }
        twoFinger = null;
        gest = null;
      }
      return;
    }
    if (!gest) return;
    if (gest.mode === 'aim') {
      aimAt(p);
      const t = aimTile;
      aimTile = null;
      gest = null;
      if (t && ctx.placing) ctx.tryPlaceAt(t.tx, t.ty);
      return;
    }
    if (gest.mode === 'undecided') {
      handleTap(p, gest.button, e.shiftKey, gest.isTouch);
    } else if (gest.mode === 'box') {
      finalizeBox(e.shiftKey);
    }
    gest = null;
  }

  function onPointerCancel(e: PointerEvent) {
    ptrs.delete(e.pointerId);
    clearLongPress();
    hideBox();
    gest = null;
    aimTile = null;
    twoFinger = null;
  }

  function onPointerLeave() {
    hover = null;
  }

  function onDblClick(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const res = ctx.renderer.pick(p.x, p.y);
    if (res.entityId !== null && isOwn(res.entityId)) selectAllOfTypeOnScreen(res.entityId);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
    ctx.renderer.zoomBy(factor, e.clientX - r.left, e.clientY - r.top);
  }
  function onContextMenu(e: Event) {
    e.preventDefault();
  }

  function isTypingTarget(t: EventTarget | null): boolean {
    const node = t as HTMLElement | null;
    return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    const k = e.key.toLowerCase();
    if (!e.repeat) {
      if (k === 'a') ctx.setTool(ctx.tool === 'attackMove' ? null : 'attackMove');
      else if (k === 's' && ctx.selection.length) ctx.queueCommand({ t: 'stop', team: ctx.localTeam, ids: [...ctx.selection] });
      else if (k === 'h') ctx.centerBase();
      else if (k === ' ') { if (ctx.lastEventPos) ctx.renderer.centerOn(ctx.lastEventPos); }
      else if (k === 'escape') {
        if (ctx.placing) ctx.cancelPlacing();
        else if (ctx.tool) ctx.setTool(null);
        else ctx.setSelection([]);
      } else if (k === 'f10' || k === 'p') ctx.togglePause();
      else if (/^[1-9]$/.test(k)) {
        const n = Number(k);
        if (e.ctrlKey || e.metaKey) {
          ctx.groups.set(n, [...ctx.selection]);
        } else {
          const ids = (ctx.groups.get(n) ?? []).filter((id) => ctx.world.units.has(id) || ctx.world.buildings.has(id));
          ctx.setSelection(ids);
          const now = performance.now();
          const isDbl = now - (lastDigitTime.get(n) ?? 0) < DOUBLE_TAP_MS;
          lastDigitTime.set(n, now);
          if (isDbl && ids.length) {
            const first = ctx.world.units.get(ids[0]);
            if (first) ctx.renderer.centerOn({ x: first.x, y: first.y });
            else {
              const bld = ctx.world.buildings.get(ids[0]);
              if (bld) ctx.renderer.centerOn({ x: bld.tx + bld.w / 2, y: bld.ty + bld.h / 2 });
            }
          }
        }
      }
    }
    if (['a', 's', 'd', 'w', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) held.add(k);
  }
  function onKeyUp(e: KeyboardEvent) {
    held.delete(e.key.toLowerCase());
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  function update() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
    lastFrameAt = now;

    let dx = 0;
    let dy = 0;
    const speed = KEY_PAN_PX_S * dt;
    if (held.has('arrowleft') || held.has('a')) dx -= speed;
    if (held.has('arrowright') || held.has('d')) dx += speed;
    if (held.has('arrowup') || held.has('w')) dy -= speed;
    if (held.has('arrowdown') || held.has('s')) dy += speed;
    if (hover && !gest && lastPtrType === 'mouse' && !ctx.helpOpen && ctx.started && !ctx.paused) {
      const r = canvas.getBoundingClientRect();
      if (hover.x < EDGE_PX) dx -= speed;
      else if (hover.x > r.width - EDGE_PX) dx += speed;
      if (hover.y < EDGE_PX) dy -= speed;
      else if (hover.y > r.height - EDGE_PX) dy += speed;
    }
    if (dx || dy) ctx.renderer.panBy(dx, dy);

    canvas.classList.toggle('placing', !!ctx.placing || !!ctx.tool);
    if (ctx.placing) {
      const flash = ctx.ghostFlash && performance.now() < ctx.ghostFlash.until ? ctx.ghostFlash : null;
      let tile: { tx: number; ty: number } | null = null;
      let forceBad = false;
      if (gest && gest.mode === 'aim') tile = aimTile;
      else if (flash) {
        tile = flash;
        forceBad = true;
      } else if (lastPtrType === 'mouse' && hover) {
        const wp = ctx.renderer.pick(hover.x, hover.y).world;
        if (wp) tile = placementTile(wp, ctx.placing);
      }
      if (tile) {
        const valid = !forceBad && ctx.sim.canPlace(ctx.world, ctx.localTeam, ctx.placing, tile.tx, tile.ty);
        ctx.renderer.setGhost({ type: ctx.placing, tx: tile.tx, ty: tile.ty, valid });
        ghostShown = true;
      } else if (ghostShown) {
        ctx.renderer.setGhost(null);
        ghostShown = false;
      }
    } else if (ghostShown) {
      ctx.renderer.setGhost(null);
      ghostShown = false;
    }
  }

  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerCancel);
    canvas.removeEventListener('pointerleave', onPointerLeave);
    canvas.removeEventListener('dblclick', onDblClick);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    clearLongPress();
    boxDiv.remove();
  }

  return { update, dispose };
}
