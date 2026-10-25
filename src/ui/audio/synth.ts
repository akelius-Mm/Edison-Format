// Small synthesis toolkit shared by the sound effects and the music sequencer.
// Every voice is fire-and-forget: it builds its nodes, schedules them at `t` and stops itself.
import type { Ctx } from './core';

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const EPS = 0.0001;

/**
 * Update a swept parameter once per 128-sample block instead of every sample. Filter sweeps
 * sound the same, and it saves a lot of CPU (per-sample biquad coefficients are expensive).
 */
export function kRate(p: AudioParam): AudioParam {
  try {
    if ('automationRate' in p) (p as any).automationRate = 'k-rate';
  } catch {
    /* not supported: stays a-rate */
  }
  return p;
}

export interface Send {
  /** Extra destination (reverb / delay input) and how much of the voice to send there. */
  to: AudioNode;
  amount: number;
}

export interface VoiceOpts {
  vol?: number;
  attack?: number;
  /** Seconds held at full level before the decay. */
  hold?: number;
  /** Decay steepness (default 4.5; higher = snappier). */
  shape?: number;
  /** -1 (left) … 1 (right). */
  pan?: number;
  send?: Send | Send[] | null;
}

const decayCurves = new Map<number, Float32Array>();
/** Normalised exponential decay from 1 that lands exactly on 0 (steepness k: 4.5 ≈ -40 dB before the end). */
function decayCurve(k: number): Float32Array {
  let c = decayCurves.get(k);
  if (!c) {
    c = new Float32Array(32);
    const end = Math.exp(-k);
    for (let i = 0; i < c.length; i++) c[i] = (Math.exp((-k * i) / (c.length - 1)) - end) / (1 - end);
    decayCurves.set(k, c);
  }
  return c;
}

/**
 * Percussive envelope: fast attack, optional hold, then a smooth exponential decay that reaches
 * silence exactly at t+dur. `shape` sets how steep the decay is (higher = snappier).
 */
export function envelope(ac: Ctx, t: number, dur: number, v: number, attack = 0.005, hold = 0, shape = 4.5): GainNode {
  const g = ac.createGain();
  const a = Math.max(0.001, Math.min(attack, dur * 0.5));
  const h = Math.min(hold, Math.max(0, dur - a - 0.01));
  const peak = Math.max(EPS * 2, v);
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  const d0 = t + a + h + 0.0005;
  const curve = decayCurve(shape).map((x) => x * peak);
  g.gain.setValueCurveAtTime(curve, d0, Math.max(0.005, t + dur - d0));
  return g;
}

/** Route a voice to its destination, with optional pan and effect send. */
export function route(ac: Ctx, node: AudioNode, out: AudioNode, pan?: number, send?: Send | Send[] | null) {
  let last = node;
  if (pan && (ac as any).createStereoPanner) {
    const p = ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    last.connect(p);
    last = p;
  }
  last.connect(out);
  if (!send) return;
  for (const sd of Array.isArray(send) ? send : [send]) {
    if (!(sd.amount > 0)) continue;
    const s = ac.createGain();
    s.gain.value = sd.amount;
    last.connect(s).connect(sd.to);
  }
}

export interface ToneOpts extends VoiceOpts {
  type?: OscillatorType;
  /** End frequency (exponential glide over `glide` seconds, default the whole note). */
  f1?: number;
  glide?: number;
  detune?: number;
  /** Optional low-pass: start cutoff, end cutoff, resonance. */
  lp?: number;
  lpEnd?: number;
  q?: number;
}

export function tone(ac: Ctx, out: AudioNode, t: number, f0: number, dur: number, o: ToneOpts = {}) {
  const osc = ac.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.glide ?? dur));
  if (o.detune) osc.detune.value = o.detune;
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = o.q ?? 0.7;
    if (o.lpEnd) kRate(f.frequency);
    f.frequency.setValueAtTime(o.lp, t);
    if (o.lpEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.lpEnd), t + dur);
    node.connect(f);
    node = f;
  }
  const g = envelope(ac, t, dur, o.vol ?? 0.2, o.attack ?? 0.005, o.hold ?? 0, o.shape);
  node.connect(g);
  route(ac, g, out, o.pan, o.send);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

export interface NoiseOpts extends VoiceOpts {
  type?: BiquadFilterType;
  f0?: number;
  f1?: number;
  /** Time of the filter sweep (default: whole sound). */
  sweep?: number;
  q?: number;
  /** Optional second filter stage (e.g. a high-pass to clear rumble). */
  hp?: number;
}

export function noise(ac: Ctx, buf: AudioBuffer, out: AudioNode, t: number, dur: number, o: NoiseOpts = {}) {
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  if (o.f1) kRate(f.frequency);
  f.frequency.setValueAtTime(o.f0 ?? 1000, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + (o.sweep ?? dur));
  let node: AudioNode = src.connect(f);
  if (o.hp) {
    const h2 = ac.createBiquadFilter();
    h2.type = 'highpass';
    h2.frequency.value = o.hp;
    node = node.connect(h2);
  }
  const g = envelope(ac, t, dur, o.vol ?? 0.2, o.attack ?? 0.003, o.hold ?? 0, o.shape);
  node.connect(g);
  route(ac, g, out, o.pan, o.send);
  const off = Math.random() * Math.max(0, buf.duration - dur - 0.1);
  src.start(t, off);
  src.stop(t + dur + 0.03);
}

export interface FmOpts extends VoiceOpts {
  /** Modulator / carrier frequency ratio (non-integer = metallic). */
  ratio?: number;
  /** Modulation index at the start and the end. */
  index?: number;
  indexEnd?: number;
  f1?: number;
}

/** Two-operator FM: bells, chimes, metal. */
export function fm(ac: Ctx, out: AudioNode, t: number, freq: number, dur: number, o: FmOpts = {}) {
  const car = ac.createOscillator();
  const mod = ac.createOscillator();
  const depth = ac.createGain();
  const ratio = o.ratio ?? 1.4;
  car.frequency.setValueAtTime(freq, t);
  mod.frequency.setValueAtTime(freq * ratio, t);
  if (o.f1) {
    car.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    mod.frequency.exponentialRampToValueAtTime(o.f1 * ratio, t + dur);
  }
  const i0 = (o.index ?? 2) * freq;
  const i1 = Math.max(1, (o.indexEnd ?? 0.1) * freq);
  depth.gain.setValueAtTime(i0, t);
  depth.gain.exponentialRampToValueAtTime(i1, t + dur);
  mod.connect(depth).connect(car.frequency);
  const g = envelope(ac, t, dur, o.vol ?? 0.15, o.attack ?? 0.002, o.hold ?? 0, o.shape);
  car.connect(g);
  route(ac, g, out, o.pan, o.send);
  car.start(t);
  mod.start(t);
  car.stop(t + dur + 0.03);
  mod.stop(t + dur + 0.03);
}

const shapers = new WeakMap<Ctx, Float32Array>();
/** Soft-clip curve (cached per context). */
export function driveCurve(ac: Ctx): Float32Array {
  let c = shapers.get(ac);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 3) / Math.tanh(3);
    }
    shapers.set(ac, c);
  }
  return c;
}
