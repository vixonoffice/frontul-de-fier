// Coloana sonoră: două piese CC0 (calmă / încordată) din public/audio, redate prin HTMLAudioElement și
// trecute prin WebAudio (ca volumul să meargă și pe iOS). Trecere lină între ele, buclă fără pauză
// (două elemente care se suprapun la capăt). Dacă fișierele lipsesc (varianta dintr-un singur fișier),
// totul rămâne tăcut, fără erori.
export type Mood = 'calm' | 'tense';

const XF = 3; // secunde de suprapunere la sfârșitul piesei
const TAU = 1.1; // constanta de timp a trecerii calm <-> încordat

interface Deck {
  el: HTMLAudioElement;
  gain: GainNode;
  playing: boolean;
  cont: boolean; // pornit ca să continue bucla (intră lin)
}

class Track {
  decks: Deck[] = [];
  active = 0;
  level = 0;
  target = 0;
  failed = false;
  constructor(private ac: AudioContext, private bus: AudioNode, private url: string) {}

  private make(): Deck | null {
    try {
      const el = new Audio();
      el.preload = 'auto';
      el.src = this.url;
      el.addEventListener('error', () => { this.failed = true; });
      const src = this.ac.createMediaElementSource(el);
      const gain = this.ac.createGain();
      gain.gain.value = 0;
      src.connect(gain);
      gain.connect(this.bus);
      return { el, gain, playing: false, cont: false };
    } catch {
      this.failed = true;
      return null;
    }
  }

  private startDeck(d: Deck, cont: boolean) {
    d.cont = cont;
    d.playing = true;
    try {
      if (cont) d.el.currentTime = 0;
      void d.el.play().catch(() => { d.playing = false; });
    } catch { d.playing = false; }
  }

  update(dt: number, factor: number) {
    if (this.failed) return;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt / TAU));
    if (this.target === 0 && this.level < 0.003) this.level = 0;
    if (this.level > 0 && this.decks.length === 0) {
      const a = this.make();
      const b = this.make();
      if (!a || !b) return;
      this.decks = [a, b];
    }
    if (this.decks.length === 0) return;
    const [a, b] = this.decks;
    if (this.level === 0) {
      for (const d of this.decks) if (d.playing) { d.el.pause(); d.playing = false; }
      return;
    }
    if (!a.playing && !b.playing) this.startDeck(this.decks[this.active], this.decks[this.active].cont && false);
    for (let i = 0; i < 2; i++) {
      const d = this.decks[i];
      if (!d.playing) { d.gain.gain.value = 0; continue; }
      const dur = isFinite(d.el.duration) && d.el.duration > 0 ? d.el.duration : 0;
      const t = d.el.currentTime;
      let f = 1;
      if (dur > 0) {
        const rem = dur - t;
        f = Math.min(1, Math.max(0, rem / XF));
        if (d.cont) f = Math.min(f, Math.min(1, t / XF));
        if (i === this.active && rem < XF) {
          const o = this.decks[1 - i];
          if (!o.playing) { this.startDeck(o, true); this.active = 1 - i; }
        }
        if (rem <= 0.05 || d.el.ended) { d.el.pause(); d.playing = false; f = 0; }
      }
      d.gain.gain.value = this.level * f * factor;
    }
  }

  dispose() {
    for (const d of this.decks) {
      try { d.el.pause(); d.el.removeAttribute('src'); d.el.load(); d.gain.disconnect(); } catch { /* ignorat */ }
    }
    this.decks = [];
  }
}

export interface Music {
  setMood(m: Mood | null): void;
  update(dt: number, factor: number): void;
  mood(): Mood | null;
  /** Stare pentru depanare (dev). */
  debug(): Record<Mood, { level: number; playing: boolean; time: number; failed: boolean }>;
  dispose(): void;
}

export function createMusic(ac: AudioContext, bus: AudioNode): Music {
  // adresă relativă la pagină: merge și când site-ul e publicat într-un sub-folder
  const base = (f: string) => new URL(`audio/${f}`, document.baseURI).href;
  const tracks: Record<Mood, Track> = {
    calm: new Track(ac, bus, base('calm.ogg')),
    tense: new Track(ac, bus, base('tense.ogg')),
  };
  let cur: Mood | null = null;
  return {
    setMood(m) {
      cur = m;
      tracks.calm.target = m === 'calm' ? 1 : 0;
      tracks.tense.target = m === 'tense' ? 1 : 0;
    },
    update(dt, factor) {
      tracks.calm.update(dt, factor);
      tracks.tense.update(dt, factor);
    },
    mood: () => cur,
    debug: () => {
      const f = (t: Track) => ({ level: +t.level.toFixed(3), playing: t.decks.some((d) => d.playing), time: +(t.decks[t.active]?.el.currentTime ?? 0).toFixed(1), failed: t.failed });
      return { calm: f(tracks.calm), tense: f(tracks.tense) };
    },
    dispose() {
      tracks.calm.dispose();
      tracks.tense.dispose();
    },
  };
}
