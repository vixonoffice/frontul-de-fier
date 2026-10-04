// Preferințe salvate local. Orice acces la localStorage e în try/catch: jocul merge și dacă stocarea aruncă.
const K_TIPS = 'fdf.sfaturi';
const K_SEEN = 'fdf.sfaturiVazute';

// copie în memorie, ca setările să țină măcar cât rulează pagina
const mem: Record<string, string> = {};

function read(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch { /* stocare indisponibilă */ }
  return key in mem ? mem[key] : null;
}
function write(key: string, val: string) {
  mem[key] = val;
  try { localStorage.setItem(key, val); } catch { /* ignorat */ }
}

/** Implicit pornite; "off" doar dacă jucătorul le-a oprit. */
export function tipsEnabled(): boolean {
  return read(K_TIPS) !== 'off';
}
const listeners = new Set<() => void>();
/** Se apelează când se schimbă sfaturile (pornite/oprite sau resetate). Întoarce funcția de dezabonare. */
export function onTipsChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function notify() {
  for (const cb of listeners) cb();
}
export function setTipsEnabled(on: boolean) {
  write(K_TIPS, on ? 'on' : 'off');
  notify();
}
export function seenTips(): Set<string> {
  const raw = read(K_SEEN);
  if (!raw) return new Set();
  return new Set(raw.split(',').filter(Boolean));
}
export function markTipSeen(id: string) {
  const s = seenTips();
  s.add(id);
  write(K_SEEN, Array.from(s).join(','));
}
export function resetSeenTips() {
  write(K_SEEN, '');
  notify();
}

const K_MAP = 'fdf.radarMare';
export function minimapBigPref(): boolean {
  return read(K_MAP) === '1';
}
export function setMinimapBigPref(b: boolean) {
  write(K_MAP, b ? '1' : '0');
}

const K_FEED = 'fdf.asistentMesaje';
/** Mesajele scurte ale asistentului (implicit pornite). */
export function assistFeedOn(): boolean {
  return read(K_FEED) !== 'off';
}
export function setAssistFeed(on: boolean) {
  write(K_FEED, on ? 'on' : 'off');
}
