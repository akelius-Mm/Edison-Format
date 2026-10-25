// Synthesized sound effects (Web Audio, no audio files). Every sound here is original.
// Shares one AudioContext with the music (see ../audio/core.ts).
import { type Ctx, audioContext, duckMusic, graphFor, resumeAudio } from '../audio/core';
import { type Send, fm, mtof, noise, tone } from '../audio/synth';

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

/** Minimum gap (seconds) before the same sound may fire again, so bursts don't stack. */
const GAP: Partial<Record<SfxName, number>> = {
  draw: 0.05,
  destroy: 0.12,
  damage: 0.1,
  bigDamage: 0.1,
  synchro: 0.3,
  summon: 0.08,
  activate: 0.08,
  win: 1,
  lose: 1,
  turn: 0.3,
};
/**
 * Per-sound level trim in dB, balanced by rendering every sound offline and measuring it
 * (at volume 0.6: heavy hits peak near -7 dBFS, medium -10, light -15, UI ticks -25).
 */
const TRIM_DB: Record<SfxName, number> = {
  draw: 13,
  set: 2,
  flip: 15,
  summon: 4.5,
  synchro: 6,
  activate: 11,
  resolve: 11,
  attack: 13,
  battle: 1,
  damage: 3,
  bigDamage: 3.5,
  recover: 10.5,
  destroy: 4,
  phase: 6,
  turn: 11,
  coin: 14,
  negate: 6,
  target: 11,
  win: 8.5,
  lose: 14,
  click: 9,
  error: 10,
};

/** Sounds that share a rate-limit slot. */
const SLOT: Partial<Record<SfxName, string>> = { damage: 'hit', bigDamage: 'hit', win: 'end', lose: 'end' };

const vary = (x: number, pct: number) => x * (1 + (Math.random() * 2 - 1) * pct);

interface Ticker {
  bus: GainNode;
  end: number;
}

export class Sfx {
  private fixed: Ctx | null;
  private master: GainNode | null = null;
  private masterCtx: Ctx | null = null;
  private last = new Map<string, number>();
  private ticker: Ticker | null = null;
  private lastSpin = -10;
  enabled = true;
  volume = 0.6;

  /** `context` renders into a given (e.g. offline) context instead of the shared live one. */
  constructor(opts: { context?: BaseAudioContext } = {}) {
    this.fixed = opts.context ?? null;
  }

  private ensure(): Ctx | null {
    if (!this.enabled) return null;
    let ac: Ctx | null = this.fixed;
    if (!ac) {
      const live = audioContext();
      if (!live) return null;
      if (live.state !== 'running') {
        // Locked (no tap yet) or paused while hidden: don't queue sounds to burst out later.
        resumeAudio();
        return null;
      }
      ac = live;
    }
    if (!this.master || this.masterCtx !== ac) {
      this.master = ac.createGain();
      this.master.connect(graphFor(ac).out);
      this.masterCtx = ac;
    }
    this.master.gain.value = this.volume * 0.55;
    return ac;
  }

  dispose() {
    this.stopTicker();
    try {
      this.master?.disconnect();
    } catch {
      /* ignore */
    }
    this.master = null;
    this.masterCtx = null;
  }

  // ------------------------------------------------------------------ LP counter
  /**
   * The rolling LP counter: soft digital ticks for `durationMs` (the length of the number roll),
   * fast at first and easing off, then one settle tick when the number lands. A new call replaces
   * a ticker that is still running.
   */
  lpTicker(durationMs: number, up = false) {
    this.stopTicker();
    if (!(durationMs >= 80)) return;
    const ac = this.ensure();
    if (!ac || !this.master) return;
    const t0 = ac.currentTime + 0.005;
    const dur = durationMs / 1000;
    const bus = ac.createGain();
    bus.connect(this.master);

    // One oscillator, gated into ticks by gain automation: cheap even for long rolls.
    const osc = ac.createOscillator();
    osc.type = 'square';
    const f0 = up ? 1500 : 2150;
    const f1 = up ? 2150 : 1450;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.linearRampToValueAtTime(f1, t0 + dur);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 1.4;
    const gate = ac.createGain();
    gate.gain.setValueAtTime(0, t0);
    osc.connect(bp).connect(gate).connect(bus);
    const v = 0.3;
    let t = 0;
    let n = 0;
    while (t < dur - 0.028) {
      const ti = t0 + t;
      const lv = v * (n % 2 ? 0.8 : 1);
      gate.gain.setValueAtTime(0, ti);
      gate.gain.linearRampToValueAtTime(lv, ti + 0.0015);
      gate.gain.setTargetAtTime(0, ti + 0.0015, 0.0045);
      // ticks start rapid and slow down as the number settles
      t += 0.024 + 0.04 * Math.pow(t / dur, 1.5);
      n++;
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    // settle: a slightly rounder double tick
    const te = t0 + dur;
    fm(ac, bus, te, up ? 2093 : 1568, 0.12, { ratio: 2, index: 0.7, indexEnd: 0.05, vol: 0.14 });
    tone(ac, bus, te, up ? 4186 : 3136, 0.04, { vol: 0.04 });
    this.ticker = { bus, end: te + 0.15 };
  }

  private stopTicker() {
    const tk = this.ticker;
    this.ticker = null;
    if (!tk) return;
    const ac = tk.bus.context;
    const now = ac.currentTime;
    if (now >= tk.end) {
      tk.bus.disconnect();
      return;
    }
    tk.bus.gain.cancelScheduledValues(now);
    tk.bus.gain.setValueAtTime(tk.bus.gain.value, now);
    tk.bus.gain.linearRampToValueAtTime(0, now + 0.015);
    window.setTimeout(() => {
      try {
        tk.bus.disconnect();
      } catch {
        /* ignore */
      }
    }, 60);
  }

  // ------------------------------------------------------------------ one-shots
  play(name: SfxName) {
    const ac = this.ensure();
    if (!ac || !this.master) return;
    const now = ac.currentTime;
    const slot = SLOT[name] ?? name;
    const prev = this.last.get(slot) ?? -10;
    if (now - prev < (GAP[name] ?? 0.04)) return;
    this.last.set(slot, now);
    this.voice(ac, name, now + 0.005);
  }

  private brass(ac: Ctx, out: AudioNode, t: number, m: number, dur: number, vol: number, rv: Send, pan = 0) {
    // two detuned saws whose filter opens with the attack: a short synth-brass note
    for (const d of [-7, 7]) {
      tone(ac, out, t, mtof(m), dur, { type: 'sawtooth', detune: d, vol: vol * 0.5, attack: 0.025, hold: dur * 0.4, lp: 3200, lpEnd: 700, q: 1.2, send: rv, pan });
    }
  }

  private voice(ac: Ctx, name: SfxName, t: number) {
    const g = graphFor(ac);
    const o = ac.createGain();
    o.gain.value = Math.pow(10, TRIM_DB[name] / 20);
    o.connect(this.master!);
    const N = g.noise;
    const rv = (amount: number): Send => ({ to: g.reverb, amount });
    switch (name) {
      case 'draw': {
        // card sliding off the deck: bright swish with a quick upward sweep, then a tiny landing tick
        const p = vary(1, 0.07);
        noise(ac, N, o, t, 0.13, { type: 'bandpass', f0: 1300 * p, f1: 6500 * p, sweep: 0.09, q: 1.1, vol: 0.34, attack: 0.004, hp: 650, pan: vary(-0.1, 1) * 0.3 });
        tone(ac, o, t + 0.004, 850 * p, 0.07, { type: 'triangle', f1: 1700 * p, vol: 0.03 });
        noise(ac, N, o, t + 0.095, 0.03, { type: 'bandpass', f0: 3300, q: 2.5, vol: 0.07 });
        break;
      }
      case 'set': {
        // soft felt thud: a card laid face-down on a playmat
        tone(ac, o, t, 140, 0.17, { f1: 58, vol: 0.5, attack: 0.003 });
        noise(ac, N, o, t, 0.09, { type: 'lowpass', f0: 750, f1: 240, q: 0.8, vol: 0.3, attack: 0.002 });
        noise(ac, N, o, t, 0.025, { type: 'bandpass', f0: 2300, q: 1.2, vol: 0.045 });
        break;
      }
      case 'flip': {
        // card flick: a snap, then the card turning through the air
        noise(ac, N, o, t, 0.035, { type: 'bandpass', f0: 3900, f1: 2600, q: 2.2, vol: 0.24, attack: 0.002 });
        noise(ac, N, o, t + 0.05, 0.075, { type: 'bandpass', f0: 2100, f1: 5400, q: 1.6, vol: 0.2, attack: 0.004 });
        tone(ac, o, t + 0.05, 1300, 0.03, { type: 'triangle', f1: 1950, vol: 0.04 });
        break;
      }
      case 'summon': {
        // low punch under a bright two-note chime
        tone(ac, o, t, 160, 0.26, { f1: 46, glide: 0.18, vol: 0.52, attack: 0.003 });
        noise(ac, N, o, t, 0.06, { type: 'lowpass', f0: 2200, f1: 300, vol: 0.22 });
        noise(ac, N, o, t, 0.25, { type: 'bandpass', f0: 700, f1: 5000, q: 0.9, vol: 0.07, attack: 0.07 });
        fm(ac, o, t + 0.03, 1318.5, 0.9, { ratio: 3.01, index: 0.9, indexEnd: 0.05, vol: 0.11, send: rv(0.35), pan: -0.15 });
        fm(ac, o, t + 0.065, 1975.5, 0.8, { ratio: 2, index: 0.6, vol: 0.07, send: rv(0.35), pan: 0.15 });
        tone(ac, o, t + 0.03, 2637, 0.45, { vol: 0.025, send: rv(0.4) });
        break;
      }
      case 'synchro': {
        // rising shimmer and sparkle run, resolving on a wide major-add9 chord with a sub drop
        const r = rv(0.45);
        noise(ac, N, o, t, 0.85, { type: 'bandpass', f0: 500, f1: 9000, sweep: 0.8, q: 1.4, vol: 0.13, attack: 0.6, send: r });
        for (const d of [-9, 9]) tone(ac, o, t, 220, 0.85, { type: 'sawtooth', f1: 880, glide: 0.8, detune: d, vol: 0.045, attack: 0.55, lp: 900, lpEnd: 5000, send: r });
        [74, 76, 78, 81, 83, 86, 88, 90, 93, 95, 98].forEach((m, i) =>
          fm(ac, o, t + 0.05 + i * 0.065, mtof(m), 0.2, { ratio: 2, index: 0.5, vol: 0.028 + i * 0.004, pan: i % 2 ? 0.35 : -0.35, send: r }),
        );
        const t2 = t + 0.78;
        tone(ac, o, t2, 73.4, 0.9, { f1: 36, glide: 0.5, vol: 0.55, attack: 0.004 });
        noise(ac, N, o, t2, 0.5, { type: 'lowpass', f0: 3200, f1: 200, vol: 0.2, send: r });
        [62, 69, 74, 78, 81, 88].forEach((m, i) =>
          tone(ac, o, t2 + i * 0.008, mtof(m), 1.25, {
            type: i < 2 ? 'sawtooth' : 'triangle',
            vol: i < 2 ? 0.035 : 0.06,
            lp: i < 2 ? 2600 : undefined,
            lpEnd: 700,
            attack: 0.01,
            hold: 0.15,
            send: r,
            pan: (i - 2.5) * 0.14,
          }),
        );
        fm(ac, o, t2, mtof(86), 1.3, { ratio: 3.5, index: 0.8, vol: 0.05, send: r });
        duckMusic(ac, 0.5, 1.2, 1);
        break;
      }
      case 'activate': {
        // magical "shing": bright metallic FM ring with an airy glint
        const r = rv(0.5);
        fm(ac, o, t, 2093, 0.6, { ratio: 1.414, index: 3, indexEnd: 0.2, vol: 0.09, send: r, pan: -0.1 });
        fm(ac, o, t + 0.012, 3136, 0.5, { ratio: 2.76, index: 1.5, indexEnd: 0.1, vol: 0.05, send: r, pan: 0.15 });
        noise(ac, N, o, t, 0.32, { type: 'highpass', f0: 5500, vol: 0.1, attack: 0.004, send: r });
        tone(ac, o, t, 1400, 0.25, { type: 'triangle', f1: 2800, glide: 0.08, vol: 0.04 });
        break;
      }
      case 'resolve': {
        const r = rv(0.35);
        fm(ac, o, t, 1046.5, 0.45, { ratio: 2, index: 0.4, vol: 0.07, send: r });
        tone(ac, o, t + 0.05, 1568, 0.35, { vol: 0.04, send: r });
        break;
      }
      case 'attack': {
        // whoosh of a monster lunging across the field
        noise(ac, N, o, t, 0.42, { type: 'bandpass', f0: 250, f1: 2600, sweep: 0.3, q: 1.3, vol: 0.34, attack: 0.16, pan: -0.3 });
        noise(ac, N, o, t + 0.06, 0.36, { type: 'bandpass', f0: 500, f1: 4200, sweep: 0.3, q: 2, vol: 0.12, attack: 0.14, pan: 0.3 });
        tone(ac, o, t, 90, 0.38, { type: 'sawtooth', f1: 150, vol: 0.06, attack: 0.15, lp: 420 });
        break;
      }
      case 'battle': {
        // impact: thump + crunch + crack + a short metallic clang
        tone(ac, o, t, 130, 0.32, { f1: 42, glide: 0.2, vol: 0.6, attack: 0.002 });
        noise(ac, N, o, t, 0.2, { type: 'lowpass', f0: 4000, f1: 300, vol: 0.42, attack: 0.001 });
        noise(ac, N, o, t, 0.05, { type: 'highpass', f0: 3500, vol: 0.18, attack: 0.001 });
        fm(ac, o, t, 620, 0.3, { ratio: 1.53, index: 4, indexEnd: 0.3, vol: 0.05, send: rv(0.25) });
        break;
      }
      case 'damage': {
        tone(ac, o, t, 95, 0.42, { f1: 38, glide: 0.3, vol: 0.62, attack: 0.003 });
        tone(ac, o, t, 190, 0.22, { type: 'sawtooth', f1: 70, vol: 0.1, lp: 900, lpEnd: 200 });
        noise(ac, N, o, t, 0.18, { type: 'lowpass', f0: 1400, f1: 180, vol: 0.28 });
        break;
      }
      case 'bigDamage': {
        tone(ac, o, t, 85, 0.85, { f1: 30, glide: 0.6, vol: 0.7, attack: 0.003 });
        tone(ac, o, t, 170, 0.5, { type: 'sawtooth', f1: 55, vol: 0.12, lp: 1200, lpEnd: 120, detune: -10 });
        tone(ac, o, t, 172, 0.5, { type: 'square', f1: 56, vol: 0.05, lp: 900, lpEnd: 120 });
        noise(ac, N, o, t, 0.7, { type: 'lowpass', f0: 2600, f1: 110, vol: 0.42, send: rv(0.3) });
        noise(ac, N, o, t, 0.04, { type: 'highpass', f0: 3000, vol: 0.2 });
        duckMusic(ac, 0.45, 0.4, 0.8);
        break;
      }
      case 'recover': {
        // warm rising glide with a soft major arpeggio
        const r = rv(0.4);
        tone(ac, o, t, 330, 0.7, { type: 'triangle', f1: 660, glide: 0.45, vol: 0.08, attack: 0.08, lp: 2000 });
        [67, 71, 74, 79].forEach((m, i) => tone(ac, o, t + 0.05 + i * 0.07, mtof(m), 0.7 - i * 0.05, { vol: 0.075, attack: 0.03, send: r, pan: (i - 1.5) * 0.15 }));
        fm(ac, o, t + 0.3, mtof(86), 0.6, { ratio: 2, index: 0.3, vol: 0.03, send: r });
        noise(ac, N, o, t, 0.6, { type: 'highpass', f0: 6000, vol: 0.025, attack: 0.25, send: r });
        break;
      }
      case 'destroy': {
        // glassy shatter: crack, scattered high shards, a little low crunch
        const r = rv(0.35);
        tone(ac, o, t, 140, 0.25, { f1: 55, vol: 0.4 });
        noise(ac, N, o, t, 0.4, { type: 'highpass', f0: 2800, vol: 0.22, attack: 0.002, send: r });
        noise(ac, N, o, t, 0.14, { type: 'bandpass', f0: 900, f1: 400, q: 1, vol: 0.2 });
        for (let i = 0; i < 14; i++) {
          const dt = Math.random() * Math.random() * 0.22;
          const f = 2400 + Math.random() * 5200;
          const d = 0.05 + Math.random() * 0.2;
          const pan = Math.random() * 1.4 - 0.7;
          if (i % 2) fm(ac, o, t + dt, f, d, { ratio: 2.41, index: 0.5, vol: 0.022 + Math.random() * 0.03, pan, send: r });
          else tone(ac, o, t + dt, f, d, { type: i % 3 ? 'sine' : 'triangle', vol: 0.02 + Math.random() * 0.03, pan, send: r });
        }
        break;
      }
      case 'phase': {
        tone(ac, o, t, 1760, 0.05, { vol: 0.06, attack: 0.002 });
        tone(ac, o, t, 880, 0.03, { type: 'triangle', vol: 0.03 });
        noise(ac, N, o, t, 0.015, { type: 'bandpass', f0: 4000, q: 2, vol: 0.03 });
        break;
      }
      case 'turn': {
        // clear two-note cue rising a fifth
        const r = rv(0.35);
        noise(ac, N, o, t, 0.25, { type: 'bandpass', f0: 800, f1: 3000, q: 0.8, vol: 0.04, attack: 0.08 });
        fm(ac, o, t, 880, 0.42, { ratio: 2, index: 0.7, vol: 0.1, send: r, pan: -0.1 });
        tone(ac, o, t, 440, 0.3, { type: 'triangle', vol: 0.05 });
        fm(ac, o, t + 0.13, 1318.5, 0.7, { ratio: 2, index: 0.7, vol: 0.11, send: r, pan: 0.1 });
        tone(ac, o, t + 0.13, 659.25, 0.5, { type: 'triangle', vol: 0.05 });
        break;
      }
      case 'coin': {
        const r = rv(0.3);
        if (t - this.lastSpin < 2.5) {
          // second call of a toss: the coin lands with a ring and two small bounces
          this.lastSpin = -10;
          fm(ac, o, t, 2637, 0.9, { ratio: 2.76, index: 1.2, indexEnd: 0.05, vol: 0.035, send: r });
          fm(ac, o, t + 0.11, 2637, 0.4, { ratio: 2.76, index: 0.8, vol: 0.016, send: r });
          fm(ac, o, t + 0.19, 2637, 0.25, { ratio: 2.76, index: 0.6, vol: 0.008, send: r });
          tone(ac, o, t, 180, 0.08, { f1: 90, vol: 0.05 });
        } else {
          // spinning: metallic ticks alternating between the two faces, slowing as it rises
          this.lastSpin = t;
          let dt = 0;
          for (let i = 0; i < 16; i++) {
            fm(ac, o, t + dt, i % 2 ? 2600 : 3150, 0.05, { ratio: 2.76, index: 1, vol: 0.05 - i * 0.0015, pan: i % 2 ? 0.2 : -0.2, send: r });
            dt += 0.032 + i * 0.0035;
          }
        }
        break;
      }
      case 'negate': {
        // sharp descending denial: a dissonant pair sliding down two octaves
        noise(ac, N, o, t, 0.03, { type: 'highpass', f0: 2500, vol: 0.18 });
        tone(ac, o, t, 740, 0.32, { type: 'sawtooth', f1: 185, glide: 0.28, vol: 0.1, lp: 3000, lpEnd: 500 });
        tone(ac, o, t, 784, 0.32, { type: 'square', f1: 196, glide: 0.28, vol: 0.06, lp: 2400, lpEnd: 400 });
        tone(ac, o, t + 0.02, 110, 0.3, { f1: 55, vol: 0.35 });
        break;
      }
      case 'target': {
        tone(ac, o, t, 1568, 0.06, { type: 'triangle', vol: 0.06 });
        tone(ac, o, t + 0.07, 2093, 0.09, { type: 'triangle', vol: 0.06 });
        noise(ac, N, o, t, 0.02, { type: 'bandpass', f0: 5000, q: 2, vol: 0.03 });
        break;
      }
      case 'win': {
        // original fanfare: quick rising pickup, a IV chord, then a bright held I chord
        const r = rv(0.35);
        duckMusic(ac, 0.7, 2.2, 1.5);
        [67, 72, 76].forEach((m, i) => this.brass(ac, o, t + i * 0.1, m, 0.14, 0.1, r, (i - 1) * 0.2));
        for (const m of [65, 69, 72, 79]) this.brass(ac, o, t + 0.34, m, 0.3, 0.07, r);
        for (const m of [60, 64, 67, 72, 76]) this.brass(ac, o, t + 0.68, m, 1.4, 0.07, r);
        tone(ac, o, t + 0.68, 65.4, 0.6, { f1: 45, vol: 0.4 });
        fm(ac, o, t + 0.68, mtof(91), 1.6, { ratio: 3.5, index: 0.8, vol: 0.05, send: r });
        noise(ac, N, o, t + 0.68, 1.4, { type: 'highpass', f0: 6000, vol: 0.05, attack: 0.005, send: r });
        break;
      }
      case 'lose': {
        // original minor cadence: iv → i with the filter closing and a falling low tone
        const r = rv(0.4);
        duckMusic(ac, 0.75, 2.4, 1.5);
        for (const m of [53, 56, 60]) this.brass(ac, o, t, m, 0.5, 0.07, r);
        for (const m of [48, 55, 63]) this.brass(ac, o, t + 0.52, m, 1.5, 0.07, r);
        tone(ac, o, t + 0.52, 261.6, 1.4, { type: 'triangle', f1: 130.8, glide: 1.2, vol: 0.06 });
        fm(ac, o, t + 0.52, mtof(75), 1.6, { ratio: 2, index: 0.4, vol: 0.03, send: r });
        break;
      }
      case 'click': {
        tone(ac, o, t, 2000, 0.025, { vol: 0.04, attack: 0.001 });
        noise(ac, N, o, t, 0.01, { type: 'bandpass', f0: 5000, q: 2, vol: 0.03 });
        break;
      }
      case 'error': {
        tone(ac, o, t, 196, 0.08, { type: 'square', vol: 0.05, lp: 1200 });
        tone(ac, o, t + 0.1, 185, 0.1, { type: 'square', vol: 0.05, lp: 1200 });
        break;
      }
    }
  }
}
