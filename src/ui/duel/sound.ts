// Synthesized sound effects (Web Audio, no audio files).
export type SfxName =
  | 'draw'
  | 'summon'
  | 'synchro'
  | 'set'
  | 'activate'
  | 'resolve'
  | 'attack'
  | 'battle'
  | 'damage'
  | 'bigDamage'
  | 'recover'
  | 'destroy'
  | 'phase'
  | 'turn'
  | 'coin'
  | 'negate'
  | 'target'
  | 'flip'
  | 'win'
  | 'lose'
  | 'click'
  | 'error';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<string, number>();
  enabled = true;
  volume = 0.6;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    // Browsers refuse to start audio before any user gesture; avoid console noise until then.
    const ua = (navigator as any).userActivation;
    if (ua && !ua.hasBeenActive) return null;
    try {
      if (!this.ctx) {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC() as AudioContext;
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.master!.gain.value = this.volume * 0.55;
      return this.ctx;
    } catch {
      return null;
    }
  }

  dispose() {
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }

  private noise(ac: AudioContext) {
    if (!this.noiseBuf) {
      const len = ac.sampleRate * 1.5;
      const b = ac.createBuffer(1, len, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    const src = ac.createBufferSource();
    src.buffer = this.noiseBuf;
    return src;
  }

  private tone(ac: AudioContext, t0: number, f0: number, dur: number, opts: { type?: OscillatorType; f1?: number; vol?: number; attack?: number } = {}) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(f0, t0);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t0 + dur);
    const v = opts.vol ?? 0.3;
    const a = opts.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private hiss(ac: AudioContext, t0: number, dur: number, opts: { type?: BiquadFilterType; f0?: number; f1?: number; q?: number; vol?: number; attack?: number } = {}) {
    const n = this.noise(ac);
    const f = ac.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.Q.value = opts.q ?? 1;
    f.frequency.setValueAtTime(opts.f0 ?? 1000, t0);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t0 + dur);
    const g = ac.createGain();
    const v = opts.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    n.connect(f).connect(g).connect(this.master!);
    n.start(t0, Math.random() * 0.5);
    n.stop(t0 + dur + 0.05);
  }

  play(name: SfxName) {
    const ac = this.ensure();
    if (!ac || !this.master) return;
    const now = ac.currentTime;
    // simple rate limit so bursts (e.g. 5 cards drawn) don't stack into noise
    const prev = this.last.get(name) ?? 0;
    if (now - prev < 0.04) return;
    this.last.set(name, now);
    const t = now + 0.005;
    switch (name) {
      case 'draw':
        this.hiss(ac, t, 0.14, { f0: 1800, f1: 5200, q: 1.4, vol: 0.18 });
        this.tone(ac, t + 0.02, 1400, 0.05, { type: 'triangle', vol: 0.05 });
        break;
      case 'flip':
        this.hiss(ac, t, 0.1, { f0: 3000, f1: 1200, q: 2, vol: 0.15 });
        break;
      case 'set':
        this.tone(ac, t, 160, 0.16, { type: 'sine', f1: 70, vol: 0.4 });
        this.hiss(ac, t, 0.08, { type: 'lowpass', f0: 900, vol: 0.18 });
        break;
      case 'summon':
        this.tone(ac, t, 330, 0.35, { type: 'triangle', f1: 660, vol: 0.18 });
        this.tone(ac, t + 0.05, 495, 0.4, { type: 'sine', f1: 990, vol: 0.12 });
        this.hiss(ac, t, 0.35, { f0: 600, f1: 4000, q: 0.8, vol: 0.12 });
        this.tone(ac, t + 0.12, 140, 0.25, { type: 'sine', f1: 60, vol: 0.35 });
        break;
      case 'synchro':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(ac, t + i * 0.07, f, 0.5, { type: 'triangle', vol: 0.13 }));
        this.hiss(ac, t, 0.8, { f0: 2000, f1: 9000, q: 0.6, vol: 0.12, attack: 0.2 });
        this.tone(ac, t + 0.35, 110, 0.6, { type: 'sine', f1: 45, vol: 0.4 });
        break;
      case 'activate':
        [880, 1175, 1568].forEach((f, i) => this.tone(ac, t + i * 0.045, f, 0.32, { type: 'sine', vol: 0.12 }));
        this.hiss(ac, t, 0.25, { f0: 4000, f1: 8000, q: 1, vol: 0.06 });
        break;
      case 'resolve':
        this.tone(ac, t, 1046, 0.4, { type: 'sine', vol: 0.09 });
        this.tone(ac, t, 1568, 0.3, { type: 'sine', vol: 0.05 });
        break;
      case 'attack':
        this.hiss(ac, t, 0.3, { f0: 400, f1: 3000, q: 1.2, vol: 0.28, attack: 0.08 });
        this.tone(ac, t, 220, 0.25, { type: 'sawtooth', f1: 110, vol: 0.06 });
        break;
      case 'battle':
        this.hiss(ac, t, 0.25, { type: 'highpass', f0: 2500, vol: 0.25 });
        this.tone(ac, t, 1250, 0.18, { type: 'square', f1: 900, vol: 0.06 });
        this.tone(ac, t, 95, 0.3, { type: 'sine', f1: 50, vol: 0.4 });
        break;
      case 'damage':
        this.tone(ac, t, 130, 0.35, { type: 'sine', f1: 55, vol: 0.45 });
        this.tone(ac, t, 220, 0.2, { type: 'sawtooth', f1: 90, vol: 0.07 });
        break;
      case 'bigDamage':
        this.tone(ac, t, 110, 0.7, { type: 'sine', f1: 35, vol: 0.55 });
        this.hiss(ac, t, 0.6, { type: 'lowpass', f0: 1200, f1: 150, vol: 0.35 });
        this.tone(ac, t, 180, 0.4, { type: 'sawtooth', f1: 60, vol: 0.09 });
        break;
      case 'recover':
        [660, 880, 1320].forEach((f, i) => this.tone(ac, t + i * 0.06, f, 0.35, { type: 'sine', vol: 0.1 }));
        break;
      case 'destroy':
        this.hiss(ac, t, 0.55, { type: 'lowpass', f0: 5000, f1: 300, vol: 0.32 });
        this.hiss(ac, t, 0.25, { type: 'highpass', f0: 3000, vol: 0.12 });
        this.tone(ac, t, 300, 0.4, { type: 'triangle', f1: 80, vol: 0.12 });
        break;
      case 'phase':
        this.tone(ac, t, 784, 0.18, { type: 'sine', vol: 0.07 });
        this.tone(ac, t + 0.06, 1175, 0.2, { type: 'sine', vol: 0.05 });
        break;
      case 'turn':
        this.tone(ac, t, 392, 0.3, { type: 'triangle', vol: 0.14 });
        this.tone(ac, t + 0.14, 523, 0.45, { type: 'triangle', vol: 0.14 });
        this.tone(ac, t + 0.14, 784, 0.45, { type: 'sine', vol: 0.06 });
        break;
      case 'coin':
        this.tone(ac, t, 2093, 0.5, { type: 'sine', vol: 0.12 });
        this.tone(ac, t, 3136, 0.3, { type: 'sine', vol: 0.06 });
        break;
      case 'negate':
        this.tone(ac, t, 150, 0.32, { type: 'square', f1: 110, vol: 0.09 });
        this.tone(ac, t + 0.08, 120, 0.3, { type: 'square', f1: 90, vol: 0.07 });
        break;
      case 'target':
        this.tone(ac, t, 1500, 0.08, { type: 'square', vol: 0.04 });
        this.tone(ac, t + 0.09, 1500, 0.08, { type: 'square', vol: 0.04 });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(ac, t + i * 0.13, f, i === 3 ? 0.9 : 0.25, { type: 'triangle', vol: 0.16 }));
        this.tone(ac, t + 0.39, 523, 0.9, { type: 'sine', vol: 0.1 });
        break;
      case 'lose':
        [392, 311, 262].forEach((f, i) => this.tone(ac, t + i * 0.22, f, i === 2 ? 0.9 : 0.3, { type: 'triangle', vol: 0.14 }));
        break;
      case 'click':
        this.tone(ac, t, 1800, 0.03, { type: 'square', vol: 0.03 });
        break;
      case 'error':
        this.tone(ac, t, 200, 0.15, { type: 'square', vol: 0.05 });
        break;
    }
  }
}
