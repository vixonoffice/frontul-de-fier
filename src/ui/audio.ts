// Sunete sintetizate cu WebAudio (fără fișiere): focuri, explozii, semnale de interfață.
// Volumul scade cu distanța față de centrul camerei, ca luptele îndepărtate să se audă înfundat.
import type { UiContext, UiModule } from './context';
import type { SimEvent, Vec } from '../sim/types';

const MAX_PER_TICK = 4;

export function initAudio(ctx: UiContext): UiModule {
  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let budget = MAX_PER_TICK;
  let lastAlarm = -1e9;

  function ensure(): boolean {
    if (ac) return ac.state === 'running';
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = 0.5;
    const comp = ac.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac.state === 'running';
  }
  // browserele pornesc sunetul doar după un gest al jucătorului
  const unlock = () => {
    ensure();
    void ac?.resume();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  function camCenter(): Vec {
    const q = ctx.renderer.viewQuad();
    let x = 0, y = 0;
    for (const p of q) { x += p.x; y += p.y; }
    return { x: x / Math.max(1, q.length), y: y / Math.max(1, q.length) };
  }
  function volAt(x: number, y: number): number {
    const c = camCenter();
    const d = Math.hypot(x - c.x, y - c.y);
    return Math.max(0, 1 - d / 34);
  }

  function burst(vol: number, dur: number, freq: number, q: number, type: BiquadFilterType = 'lowpass'): void {
    if (!ac || !master || !noise || vol <= 0.02) return;
    const t = ac.currentTime;
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }
  function tone(vol: number, dur: number, f0: number, f1: number, type: OscillatorType = 'sine', delay = 0): void {
    if (!ac || !master || vol <= 0.02) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function handleEvent(e: SimEvent): void {
    if (!ac || ac.state !== 'running') return;
    switch (e.type) {
      case 'fire': {
        if (budget <= 0) return;
        const v = volAt(e.x, e.y);
        if (v <= 0.02) return;
        budget--;
        if (e.weapon === 'shell') { burst(v * 0.55, 0.16, 1800, 0.8); tone(v * 0.5, 0.14, 150, 45); }
        else { burst(v * 0.35, 0.45, 2600, 1.5, 'bandpass'); tone(v * 0.12, 0.4, 500, 180, 'sawtooth'); }
        break;
      }
      case 'destroyed': {
        const v = volAt(e.x, e.y) * (0.6 + e.size * 0.3);
        burst(v * 0.9, 0.7 + e.size * 0.25, 900, 0.6);
        tone(v * 0.8, 0.5 + e.size * 0.2, 90, 28);
        break;
      }
      case 'unitReady':
        if (e.team === ctx.localTeam) { tone(0.16, 0.09, 660, 660, 'triangle'); tone(0.16, 0.14, 990, 990, 'triangle', 0.09); }
        break;
      case 'buildingReady':
        if (e.team === ctx.localTeam) { tone(0.16, 0.1, 520, 520, 'triangle'); tone(0.16, 0.1, 660, 660, 'triangle', 0.1); tone(0.16, 0.18, 880, 880, 'triangle', 0.2); }
        break;
      case 'buildingPlaced':
        if (e.team === ctx.localTeam) { burst(0.3, 0.25, 500, 0.7); tone(0.3, 0.2, 110, 50); }
        break;
      case 'underAttack':
      case 'waveIncoming':
        if (e.team === ctx.localTeam && performance.now() - lastAlarm > 8000) {
          lastAlarm = performance.now();
          for (let i = 0; i < 3; i++) tone(0.14, 0.16, 740, 520, 'square', i * 0.22);
        }
        break;
      case 'gameOver':
        if (e.winner === ctx.localTeam) [523, 659, 784, 1047].forEach((f, i) => tone(0.2, 0.3, f, f, 'triangle', i * 0.14));
        else [392, 330, 262, 196].forEach((f, i) => tone(0.2, 0.4, f, f * 0.97, 'sawtooth', i * 0.2));
        break;
    }
  }

  function update(): void {
    budget = MAX_PER_TICK;
  }

  function dispose(): void {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    void ac?.close();
  }

  return { update, dispose, handleEvent };
}
