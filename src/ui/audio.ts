// Sunet: efecte sintetizate cu WebAudio (poziționale: volum după distanță, panoramare după x pe ecran),
// limitator + plafon de voci pe categorii, confirmări radio la ordine, muzică (music.ts), vibrații.
// Contextul audio e unic pe pagină și supraviețuiește repornirii meciului; pornește doar după primul gest.
import type { UiContext, UiModule, SfxName, AckKind } from './context';
import type { SimEvent, Vec } from '../sim/types';
import { UNITS } from '../data/units';
import { soundPrefs, onSoundChange } from './prefs';
import { createMusic, type Music, type Mood } from './music';

interface Shared {
  ac: AudioContext;
  master: GainNode;
  sfxBus: GainNode;
  musicBus: GainNode;
  noise: AudioBuffer;
}
let shared: Shared | null = null;

function getShared(): Shared | null {
  if (shared) return shared;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ac = new Ctor();
    const master = ac.createGain();
    // limitator: nu lasă 40 de focuri deodată să sature
    const lim = ac.createDynamicsCompressor();
    lim.threshold.value = -12;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.003;
    lim.release.value = 0.12;
    const sfxBus = ac.createGain();
    const musicBus = ac.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    master.connect(lim);
    lim.connect(ac.destination);
    const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    shared = { ac, master, sfxBus, musicBus, noise };
    return shared;
  } catch {
    return null;
  }
}

const CAPS: Record<string, number> = { cannon: 3, rocket: 2, rifle: 3, bomb: 2, boom: 3, hit: 3, misc: 6 };
const MAX_VOICES = 28;
const ACK_GAP_MS = 1200;

export function initAudio(ctx: UiContext): UiModule {
  let S: Shared | null = null;
  let budget: Record<string, number> = { ...CAPS };
  let voices: number[] = [];
  let lastAlarm = -1e9;
  let lastSfx = 0;
  let lastAck = -1e9;
  let lastCash = -1e9;
  let lastReady = -1e9;
  let music: Music | null = null;
  let tenseScore = 0;
  let mood: Mood = 'calm';
  let moodSince = 0;
  let lastFrame = performance.now();
  let musicFade = 1;

  // ---------- pornire (după un gest) ----------
  function ensure(): boolean {
    if (!S) S = getShared();
    if (!S) return false;
    if (!music && S.ac.state === 'running') {
      try { music = createMusic(S.ac, S.musicBus); } catch { music = null; }
      applyVolumes();
    }
    return S.ac.state === 'running';
  }
  const unlock = () => {
    if (!S) S = getShared();
    void S?.ac.resume();
    applyVolumes();
    ensure();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function applyVolumes() {
    if (!S) return;
    const p = soundPrefs();
    const t = S.ac.currentTime;
    S.master.gain.setTargetAtTime(p.mute ? 0 : p.master, t, 0.03);
    S.sfxBus.gain.setTargetAtTime(p.sfx, t, 0.03);
    S.musicBus.gain.setTargetAtTime(p.music * 0.9, t, 0.03);
  }
  const unsubSound = onSoundChange(applyVolumes);

  // ---------- poziție ----------
  function camCenter(): Vec {
    const q = ctx.renderer.viewQuad();
    let x = 0, y = 0;
    for (const p of q) { x += p.x; y += p.y; }
    return { x: x / Math.max(1, q.length), y: y / Math.max(1, q.length) };
  }
  function where(x: number, y: number): { vol: number; pan: number } {
    const c = camCenter();
    const d = Math.hypot(x - c.x, y - c.y);
    const vol = Math.max(0, 1 - d / 34);
    let pan = 0;
    const s = ctx.renderer.worldToScreen({ x, y });
    const cv = ctx.stageEl.querySelector('#gamecanvas') as HTMLElement | null;
    if (s && cv && cv.clientWidth > 0) pan = (s.x / cv.clientWidth) * 2 - 1;
    else pan = Math.max(-1, Math.min(1, (x - c.x) / 17));
    return { vol, pan: Math.max(-0.85, Math.min(0.85, pan)) };
  }

  // ---------- unelte de sinteză ----------
  function out(pan: number, vol: number): GainNode | null {
    if (!S) return null;
    const { ac, sfxBus } = S;
    const g = ac.createGain();
    g.gain.value = vol;
    if (pan && ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(sfxBus);
    } else g.connect(sfxBus);
    return g;
  }
  function noiseB(dest: AudioNode, vol: number, dur: number, f0: number, f1: number, q: number, type: BiquadFilterType, delay = 0) {
    if (!S) return;
    const { ac, noise } = S;
    const t = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  function toneB(dest: AudioNode, vol: number, dur: number, f0: number, f1: number, type: OscillatorType = 'sine', delay = 0) {
    if (!S) return;
    const { ac } = S;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Pornește o voce în categoria dată, respectând plafoanele. fn primește nodul de ieșire. */
  function voice(cat: string, pan: number, vol: number, fn: (o: AudioNode) => void, dur = 0.5): boolean {
    if (!S || S.ac.state !== 'running' || vol <= 0.015) return false;
    if ((budget[cat] ?? 1) <= 0) return false;
    const now = S.ac.currentTime;
    voices = voices.filter((e) => e > now);
    if (voices.length >= MAX_VOICES) return false;
    const o = out(pan, vol);
    if (!o) return false;
    budget[cat] = (budget[cat] ?? 1) - 1;
    voices.push(now + dur);
    fn(o);
    return true;
  }
  const flat = (cat: string, vol: number, fn: (o: AudioNode) => void, dur = 0.5) => voice(cat, 0, vol, fn, dur);

  // ---------- efecte de interfață ----------
  function uiSound(name: SfxName) {
    switch (name) {
      case 'click': flat('misc', 0.5, (o) => { toneB(o, 0.5, 0.05, 1300, 900, 'square'); noiseB(o, 0.15, 0.02, 5000, 3000, 1, 'highpass'); }, 0.1); break;
      case 'ok': flat('misc', 0.6, (o) => { toneB(o, 0.5, 0.07, 700, 700, 'triangle'); toneB(o, 0.5, 0.1, 1050, 1050, 'triangle', 0.07); }, 0.25); break;
      case 'cancel': flat('misc', 0.6, (o) => { toneB(o, 0.5, 0.07, 700, 500, 'triangle'); toneB(o, 0.5, 0.1, 480, 330, 'triangle', 0.07); }, 0.25); break;
      case 'error': flat('misc', 0.7, (o) => { toneB(o, 0.6, 0.12, 170, 120, 'sawtooth'); toneB(o, 0.6, 0.14, 150, 100, 'sawtooth', 0.13); }, 0.35); break;
      case 'open': flat('misc', 0.5, (o) => { noiseB(o, 0.5, 0.12, 500, 2400, 1.2, 'bandpass'); toneB(o, 0.2, 0.08, 400, 700, 'triangle'); }, 0.2); break;
      case 'close': flat('misc', 0.5, (o) => { noiseB(o, 0.5, 0.1, 2200, 400, 1.2, 'bandpass'); toneB(o, 0.2, 0.08, 600, 330, 'triangle'); }, 0.2); break;
      case 'on': flat('misc', 0.6, (o) => { toneB(o, 0.5, 0.06, 600, 600, 'square'); toneB(o, 0.5, 0.09, 900, 900, 'square', 0.06); }, 0.2); break;
      case 'off': flat('misc', 0.6, (o) => { toneB(o, 0.5, 0.06, 900, 900, 'square'); toneB(o, 0.5, 0.09, 520, 520, 'square', 0.06); }, 0.2); break;
    }
  }

  function sfx(name: SfxName): void {
    lastSfx = performance.now();
    if (name === 'error') haptic('error');
    if (!ensure()) return;
    uiSound(name);
  }
  ctx.sfx = sfx;

  // ---------- vibrații ----------
  function haptic(kind: 'tick' | 'error' | 'big'): void {
    if (!soundPrefs().vibrate) return;
    try {
      if (typeof navigator.vibrate !== 'function') return;
      navigator.vibrate(kind === 'tick' ? 12 : kind === 'error' ? [25, 45, 25] : 90);
    } catch { /* ignorat */ }
  }
  ctx.haptic = haptic;

  // ---------- confirmări radio la ordine ----------
  function click(o: AudioNode, delay = 0) {
    noiseB(o, 0.5, 0.025, 5200, 3200, 1, 'highpass', delay);
  }
  function chirp(o: AudioNode, f0: number, f1: number, dur: number, delay: number, vol = 0.35) {
    if (!S) return;
    const { ac } = S;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t + dur);
    const bp = ac.createBiquadFilter(); // sunet "prin stație"
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(bp); bp.connect(g); g.connect(o);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function ack(kind: AckKind): void {
    const now = performance.now();
    if (now - lastAck < ACK_GAP_MS || !ensure()) return;
    lastAck = now;
    const v = Math.floor(Math.random() * 3);
    flat('misc', 0.55, (o) => {
      click(o);
      switch (kind) {
        case 'move': // două ciripituri ascendente
          chirp(o, 900 + v * 120, 1300 + v * 120, 0.07, 0.04); chirp(o, 1200 + v * 120, 1700 + v * 150, 0.09, 0.13);
          break;
        case 'attack': // trei rafale scurte, joase
          chirp(o, 520, 560, 0.05, 0.04); chirp(o, 520, 560, 0.05, 0.11); chirp(o, 700 + v * 60, 760, 0.09, 0.18);
          break;
        case 'harvest': // două tonuri calde
          chirp(o, 640 + v * 40, 600, 0.1, 0.04, 0.3); chirp(o, 800 + v * 40, 760, 0.12, 0.17, 0.3);
          break;
        case 'bomb': // descendent + bubuit îndepărtat
          chirp(o, 1700, 800 - v * 50, 0.16, 0.04); noiseB(o, 0.3, 0.25, 700, 120, 0.8, 'lowpass', 0.2);
          break;
        case 'guard': // două tonuri ferme
          chirp(o, 760, 760, 0.07, 0.04); chirp(o, 570, 570, 0.1, 0.13);
          break;
      }
      noiseB(o, 0.18, 0.06, 3500, 2000, 1, 'highpass', 0.3 + v * 0.02); // zgomotul de la sfârșitul transmisiei
    }, 0.5);
  }
  ctx.ack = ack;
  ctx.onCommand((c) => {
    if (c.team !== ctx.localTeam) return;
    switch (c.t) {
      case 'move': ack('move'); haptic('tick'); break;
      case 'attack': case 'attackMove': ack('attack'); haptic('tick'); break;
      case 'harvest': ack('harvest'); haptic('tick'); break;
      case 'bomb': ack('bomb'); haptic('tick'); break;
      case 'role': ack(c.role === 'guard' ? 'guard' : 'move'); haptic('tick'); break;
      case 'stop': case 'rally': haptic('tick'); break;
    }
  });

  // ---------- efecte de joc ----------
  function boom(x: number, y: number, size: number) {
    const w = where(x, y);
    const v = w.vol * (0.6 + size * 0.3);
    voice('boom', w.pan, Math.min(1, v), (o) => {
      noiseB(o, 0.9, 0.7 + size * 0.25, 900, 90, 0.6, 'lowpass');
      toneB(o, 0.8, 0.5 + size * 0.2, 90, 28);
      if (size >= 2) noiseB(o, 0.5, 0.5, 2400, 300, 0.7, 'bandpass', 0.05);
    }, 1.3);
  }

  function handleEvent(e: SimEvent): void {
    if (!ensure()) return;
    switch (e.type) {
      case 'fire': {
        const w = where(e.x, e.y);
        switch (e.weapon) {
          case 'shell': voice('cannon', w.pan, w.vol * 0.9, (o) => { noiseB(o, 0.7, 0.18, 1800, 350, 0.8, 'lowpass'); toneB(o, 0.7, 0.2, 150, 40); noiseB(o, 0.25, 0.04, 4000, 2500, 1, 'highpass'); }, 0.3); break;
          case 'rocket': voice('rocket', w.pan, w.vol * 0.8, (o) => { noiseB(o, 0.7, 0.5, 3000, 700, 1.4, 'bandpass'); toneB(o, 0.25, 0.45, 600, 180, 'sawtooth'); }, 0.55); break;
          case 'bullet': voice('rifle', w.pan, w.vol * 0.55, (o) => { for (let i = 0; i < 3; i++) noiseB(o, 0.5, 0.035, 4200, 1800, 1.2, 'highpass', i * 0.045); }, 0.2); break;
          case 'bomb': voice('bomb', w.pan, w.vol * 0.7, (o) => { toneB(o, 0.5, 0.8, 1800, 260, 'sine'); toneB(o, 0.2, 0.8, 1795, 258, 'sine'); }, 0.9); break;
        }
        break;
      }
      case 'hit': {
        const w = where(e.x, e.y);
        switch (e.weapon) {
          case 'bullet': voice('hit', w.pan, w.vol * 0.35, (o) => noiseB(o, 0.5, 0.04, 3000, 1500, 1, 'bandpass'), 0.1); break;
          case 'shell': voice('hit', w.pan, w.vol * 0.7, (o) => { noiseB(o, 0.7, 0.22, 900, 200, 0.7, 'lowpass'); toneB(o, 0.5, 0.15, 120, 40); }, 0.3); break;
          case 'rocket': voice('hit', w.pan, w.vol * 0.8, (o) => { noiseB(o, 0.8, 0.3, 1200, 150, 0.7, 'lowpass'); toneB(o, 0.6, 0.25, 100, 35); }, 0.4); break;
          case 'bomb': voice('boom', w.pan, w.vol, (o) => { noiseB(o, 1, 0.9, 800, 70, 0.6, 'lowpass'); toneB(o, 0.9, 0.7, 75, 24); noiseB(o, 0.5, 0.4, 2600, 400, 0.8, 'bandpass', 0.03); }, 1.1); break;
        }
        break;
      }
      case 'destroyed':
        boom(e.x, e.y, e.size);
        if (e.team === ctx.localTeam && e.kind === 'building') haptic('big');
        break;
      case 'crushed': {
        const w = where(e.x, e.y);
        voice('hit', w.pan, Math.max(0.3, w.vol), (o) => { noiseB(o, 0.9, 0.18, 500, 120, 0.8, 'lowpass'); toneB(o, 0.5, 0.2, 95, 45, 'sawtooth'); toneB(o, 0.3, 0.05, 1400, 700, 'square'); }, 0.3);
        break;
      }
      case 'unitReady': {
        if (e.team !== ctx.localTeam) break;
        const now = performance.now();
        if (now - lastReady < 250) break;
        lastReady = now;
        const prod = UNITS[e.unit].producedAt;
        flat('misc', 0.7, (o) => {
          if (prod === 'factory') { toneB(o, 0.5, 0.25, 70, 150, 'sawtooth'); noiseB(o, 0.3, 0.22, 600, 250, 0.8, 'lowpass'); }
          else if (prod === 'barracks') { noiseB(o, 0.5, 0.03, 3500, 2500, 1, 'highpass'); noiseB(o, 0.5, 0.03, 3000, 2000, 1, 'highpass', 0.09); }
          else noiseB(o, 0.4, 0.4, 500, 3000, 1.1, 'bandpass');
          toneB(o, 0.45, 0.09, 660, 660, 'triangle', 0.14); toneB(o, 0.45, 0.14, 990, 990, 'triangle', 0.23);
        }, 0.5);
        break;
      }
      case 'buildingReady':
        if (e.team === ctx.localTeam) flat('misc', 0.7, (o) => { [520, 660, 880].forEach((f, i) => toneB(o, 0.5, i === 2 ? 0.2 : 0.1, f, f, 'triangle', i * 0.1)); }, 0.5);
        break;
      case 'buildingPlaced':
        if (e.team === ctx.localTeam) {
          flat('misc', 0.9, (o) => { noiseB(o, 0.9, 0.25, 500, 100, 0.7, 'lowpass'); toneB(o, 0.9, 0.2, 110, 45); toneB(o, 0.3, 0.12, 900, 500, 'square', 0.05); noiseB(o, 0.3, 0.1, 1800, 900, 3, 'bandpass', 0.08); }, 0.4);
          haptic('tick');
        }
        break;
      case 'sold':
        if (e.team === ctx.localTeam) flat('misc', 0.8, (o) => { toneB(o, 0.5, 0.07, 1200, 1200, 'triangle'); toneB(o, 0.5, 0.07, 1600, 1600, 'triangle', 0.08); toneB(o, 0.5, 0.12, 2000, 2000, 'triangle', 0.16); noiseB(o, 0.3, 0.1, 4000, 2000, 1, 'highpass', 0.04); }, 0.4);
        break;
      case 'promoted':
        if (e.team === ctx.localTeam) {
          flat('misc', 0.8, (o) => { [523, 659, 784, e.rank === 2 ? 1319 : 1047].forEach((f, i) => toneB(o, 0.45, 0.12, f, f, 'triangle', i * 0.07)); noiseB(o, 0.2, 0.3, 6000, 3000, 1, 'highpass', 0.25); }, 0.6);
          haptic('tick');
        }
        break;
      case 'lowPower':
        if (e.team === ctx.localTeam && e.on) flat('misc', 0.9, (o) => { for (let i = 0; i < 3; i++) { toneB(o, 0.5, 0.12, 330, 330, 'square', i * 0.28); toneB(o, 0.5, 0.12, 240, 240, 'square', i * 0.28 + 0.14); } }, 0.9);
        break;
      case 'unload': {
        if (e.team !== ctx.localTeam) break;
        const now = performance.now();
        if (now - lastCash < 400) break;
        lastCash = now;
        const w = where(e.x, e.y);
        voice('misc', w.pan, Math.max(0.15, w.vol) * 0.4, (o) => { toneB(o, 0.5, 0.05, 1500, 1800, 'triangle'); toneB(o, 0.4, 0.07, 2200, 2200, 'triangle', 0.05); }, 0.2);
        break;
      }
      case 'assist':
        if (e.team === ctx.localTeam) flat('misc', 0.35, (o) => toneB(o, 0.35, 0.06, 1000, 1200, 'sine'), 0.15);
        break;
      case 'underAttack':
      case 'waveIncoming':
        if (e.team === ctx.localTeam && performance.now() - lastAlarm > 8000) {
          lastAlarm = performance.now();
          flat('misc', 0.9, (o) => { for (let i = 0; i < 3; i++) toneB(o, 0.5, 0.16, 740, 520, 'square', i * 0.22); }, 0.9);
          if (e.type === 'underAttack') tenseScore += 8;
        }
        break;
      case 'gameOver':
        if (e.winner === ctx.localTeam) flat('misc', 0.9, (o) => { [523, 659, 784, 1047].forEach((f, i) => toneB(o, 0.5, 0.3, f, f, 'triangle', i * 0.14)); }, 1.2);
        else flat('misc', 0.9, (o) => { [392, 330, 262, 196].forEach((f, i) => toneB(o, 0.5, 0.4, f, f * 0.97, 'sawtooth', i * 0.2)); }, 1.4);
        break;
    }
    if (e.type === 'fire') {
      const w = where(e.x, e.y);
      if (w.vol > 0.25) tenseScore += 1;
    }
  }

  // ---------- starea muzicii ----------
  function updateMusic(dt: number) {
    if (!music) return;
    tenseScore *= Math.pow(0.88, dt); // se stinge singur
    const now = performance.now();
    let want: Mood = mood;
    if (ctx.musicForce) want = ctx.musicForce;
    else if (mood === 'calm' && tenseScore >= 10 && now - moodSince > 8000) want = 'tense';
    else if (mood === 'tense' && tenseScore < 2.5 && now - moodSince > 20000) want = 'calm';
    if (want !== mood) {
      mood = want;
      moodSince = now;
    }
    ctx.musicMood = mood;
    const playing = ctx.started && !ctx.gameOver;
    music.setMood(playing ? mood : null);
    const target = ctx.paused || ctx.helpOpen ? 0.35 : 1;
    musicFade += (target - musicFade) * (1 - Math.exp(-dt / 0.4));
    music.update(dt, musicFade);
  }

  // clic implicit pentru orice buton care n-a dat singur un sunet
  const onRootClick = (e: Event) => {
    const t = e.target as HTMLElement | null;
    if (!t?.closest || !t.closest('button, [role="button"], [role="switch"]')) return;
    if (performance.now() - lastSfx > 40) sfx('click');
    haptic('tick');
  };
  ctx.root.addEventListener('click', onRootClick);

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__fdfAudio = {
      state: () => S?.ac.state ?? 'none',
      music: () => music?.debug() ?? null,
      gains: () => (S ? { master: S.master.gain.value, music: S.musicBus.gain.value, sfx: S.sfxBus.gain.value } : null),
    };
  }

  function update(): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastFrame) / 1000);
    lastFrame = now;
    budget = { ...CAPS };
    if (!music) ensure();
    updateMusic(dt);
  }

  function dispose(): void {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    ctx.root.removeEventListener('click', onRootClick);
    unsubSound();
    music?.dispose();
    music = null;
  }

  return { update, dispose, handleEvent };
}
