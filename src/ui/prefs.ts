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

// ---------------- sunet ----------------
export interface SoundPrefs { master: number; music: number; sfx: number; mute: boolean; vibrate: boolean }
const K_SND = 'fdf.sunet';
const SND_DEFAULT: SoundPrefs = { master: 0.8, music: 0.55, sfx: 0.85, mute: false, vibrate: true };
let sndCache: SoundPrefs | null = null;
const sndListeners = new Set<() => void>();
function clamp01(v: unknown, d: number): number {
  return typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : d;
}
export function soundPrefs(): SoundPrefs {
  if (sndCache) return sndCache;
  let o: Partial<SoundPrefs> = {};
  try {
    const raw = read(K_SND);
    if (raw) o = JSON.parse(raw) as Partial<SoundPrefs>;
  } catch { /* valori implicite */ }
  sndCache = {
    master: clamp01(o.master, SND_DEFAULT.master),
    music: clamp01(o.music, SND_DEFAULT.music),
    sfx: clamp01(o.sfx, SND_DEFAULT.sfx),
    mute: o.mute === true,
    vibrate: o.vibrate !== false,
  };
  return sndCache;
}
export function setSoundPrefs(p: Partial<SoundPrefs>) {
  sndCache = { ...soundPrefs(), ...p };
  write(K_SND, JSON.stringify(sndCache));
  for (const cb of sndListeners) cb();
}
export function onSoundChange(cb: () => void): () => void {
  sndListeners.add(cb);
  return () => sndListeners.delete(cb);
}

// ---------------- setările ultimului meci ----------------
export type MapChoice = 'random' | 'open' | 'passes' | 'lakes' | 'islands';
export interface MatchPrefs { opponents: 1 | 2 | 3; difficulty: 'easy' | 'normal' | 'hard'; map: MapChoice; size: 64 | 80 | 96 }
const K_MATCH = 'fdf.meci';
const MATCH_DEFAULT: MatchPrefs = { opponents: 1, difficulty: 'easy', map: 'random', size: 80 };
export function matchPrefs(): MatchPrefs {
  try {
    const raw = read(K_MATCH);
    if (raw) {
      const o = JSON.parse(raw) as Partial<MatchPrefs>;
      return {
        opponents: o.opponents === 2 || o.opponents === 3 ? o.opponents : 1,
        difficulty: o.difficulty === 'normal' || o.difficulty === 'hard' ? o.difficulty : 'easy',
        map: (['random', 'open', 'passes', 'lakes', 'islands'] as const).includes(o.map as MapChoice) ? (o.map as MapChoice) : 'random',
        size: o.size === 64 || o.size === 96 ? o.size : 80,
      };
    }
  } catch { /* valori implicite */ }
  return { ...MATCH_DEFAULT };
}
export function setMatchPrefs(p: MatchPrefs) {
  write(K_MATCH, JSON.stringify(p));
}
