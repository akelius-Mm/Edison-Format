// Procedural background music: original tracks sequenced live with Web Audio (no audio files).
//
// - menu: calm, cool and nostalgic (84 BPM, soft e-piano, music-box arpeggio, flute-like lead).
// - duel: driving and tense (148 BPM, synth-brass lead, pumping bass, rock kit, arpeggios), with a
//   "pinch" variation layered in once either player is at 2000 LP or less.
//
// Timing uses the AudioContext clock with a look-ahead scheduler (a short timer only decides
// *when to schedule*; every note is placed on the audio clock), so loops are sample-accurate.
// Every melody and chord progression here is original.
import { getSettings, onSettingsChange } from '../settings';
import { type Ctx, audioContext, graphFor, installAudioUnlock, makeImpulse, onAudioReady, resumeAudio } from './core';
import { type Send, driveCurve, envelope, fm, kRate, mtof, noise, route, tone } from './synth';

export type TrackId = 'menu' | 'duel';

/** Music level relative to the volume setting (sound effects use 0.55). */
const MUSIC_LEVEL = 0.24;
const LOOKAHEAD = 0.3;
const TICK_MS = 40;

// ---------------------------------------------------------------- per-context music chain
interface Chain {
  /** Music volume (settings.volume × MUSIC_LEVEL, 0 when music is off). */
  vol: GainNode;
  /** Send into the music's own hall reverb. */
  verb: GainNode;
}
const chains = new WeakMap<Ctx, Chain>();
function chainFor(ac: Ctx): Chain {
  let c = chains.get(ac);
  if (c) return c;
  const g = graphFor(ac);
  const vol = ac.createGain();
  vol.gain.value = 0;
  vol.connect(g.music);
  const verb = ac.createGain();
  const conv = ac.createConvolver();
  conv.buffer = makeImpulse(ac, 2.4, 2.8);
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 250;
  const wet = ac.createGain();
  wet.gain.value = 0.7;
  verb.connect(hp).connect(conv).connect(wet).connect(vol);
  c = { vol, verb };
  chains.set(ac, c);
  return c;
}

// ---------------------------------------------------------------- instruments
interface Parts {
  /** Always-on layer. */
  base: AudioNode;
  /** Layer that plays outside the pinch. */
  calm: AudioNode;
  /** Pinch-only layer. */
  hot: AudioNode;
  delay: AudioNode;
  verb: AudioNode;
  noise: AudioBuffer;
}

const sendTo = (to: AudioNode, amount: number): Send => ({ to, amount });

function kick(ac: Ctx, out: AudioNode, t: number, vol: number) {
  tone(ac, out, t, 150, 0.3, { f1: 44, glide: 0.12, vol, attack: 0.002 });
  // a little beater click so the kick reads on phone speakers
  tone(ac, out, t, 320, 0.035, { type: 'triangle', f1: 120, vol: vol * 0.3, attack: 0.001 });
}

function snare(ac: Ctx, p: Parts, out: AudioNode, t: number, vol: number) {
  noise(ac, p.noise, out, t, 0.18, { type: 'bandpass', f0: 1900, q: 0.7, vol, attack: 0.001, send: sendTo(p.verb, 0.25) });
  noise(ac, p.noise, out, t, 0.05, { type: 'highpass', f0: 5000, vol: vol * 0.45, attack: 0.001 });
  tone(ac, out, t, 215, 0.1, { type: 'triangle', f1: 160, vol: vol * 0.6 });
}

function hat(ac: Ctx, p: Parts, out: AudioNode, t: number, vol: number, open = false, pan = 0.25) {
  noise(ac, p.noise, out, t, open ? 0.24 : 0.035, { type: 'highpass', f0: 7500, vol: vol * (0.9 + Math.random() * 0.2), attack: 0.001, pan });
}

function rim(ac: Ctx, p: Parts, out: AudioNode, t: number, vol: number) {
  noise(ac, p.noise, out, t, 0.035, { type: 'bandpass', f0: 2800, q: 3, vol, attack: 0.001, send: sendTo(p.verb, 0.4) });
  tone(ac, out, t, 1750, 0.02, { type: 'triangle', vol: vol * 0.4 });
}

function crash(ac: Ctx, p: Parts, out: AudioNode, t: number, vol: number) {
  noise(ac, p.noise, out, t, 1.6, { type: 'highpass', f0: 4200, vol, attack: 0.002, send: sendTo(p.verb, 0.3), pan: -0.3 });
}

function tom(ac: Ctx, out: AudioNode, t: number, f: number, vol: number) {
  tone(ac, out, t, f, 0.26, { f1: f * 0.62, vol, attack: 0.002 });
}

/** Sustained chord: detuned saws through a slowly breathing low-pass. One filter + one gain per chord. */
function pad(ac: Ctx, p: Parts, out: AudioNode, t: number, dur: number, notes: number[], vol: number, cut: number, type: OscillatorType = 'sawtooth') {
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 0.8;
  kRate(f.frequency);
  f.frequency.setValueAtTime(cut * 0.6, t);
  f.frequency.linearRampToValueAtTime(cut, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(cut * 0.7, t + dur);
  const g = ac.createGain();
  const a = Math.min(0.35, dur * 0.3);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  g.gain.setValueAtTime(vol, t + dur - 0.05);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.15);
  f.connect(g);
  route(ac, g, out, 0, sendTo(p.verb, 0.35));
  for (const m of notes) {
    for (const d of [-8, 8]) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = mtof(m);
      o.detune.value = d;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.2);
    }
  }
}

interface LeadOpts {
  types: OscillatorType[];
  vol: number;
  cut: number;
  attack?: number;
  vibrato?: number;
  pan?: number;
  sends: Send[];
}
/** Monophonic lead note with filter envelope and delayed vibrato. */
function lead(ac: Ctx, out: AudioNode, t: number, m: number, dur: number, o: LeadOpts) {
  const g = ac.createGain();
  const a = o.attack ?? 0.012;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + a);
  g.gain.setTargetAtTime(o.vol * 0.72, t + a, 0.09);
  g.gain.setTargetAtTime(0, t + dur, 0.045);
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 1.4;
  kRate(f.frequency);
  f.frequency.setValueAtTime(o.cut * 0.5, t);
  f.frequency.linearRampToValueAtTime(o.cut, t + a + 0.02);
  f.frequency.setTargetAtTime(o.cut * 0.65, t + a + 0.02, 0.18);
  f.connect(g);
  route(ac, g, out, o.pan, o.sends);
  const lfo = ac.createOscillator();
  lfo.frequency.value = 5.4;
  const depth = ac.createGain();
  depth.gain.setValueAtTime(0, t);
  depth.gain.setValueAtTime(0, t + 0.16);
  depth.gain.linearRampToValueAtTime(o.vibrato ?? 14, t + 0.42);
  lfo.connect(depth);
  const end = t + dur + 0.3;
  o.types.forEach((type, i) => {
    const osc = ac.createOscillator();
    osc.type = type;
    // first voice at pitch, second slightly detuned, third an octave down
    osc.frequency.value = mtof(i === 2 ? m - 12 : m);
    osc.detune.value = i === 1 ? 7 : i === 0 ? -5 : 0;
    depth.connect(osc.detune);
    osc.connect(f);
    osc.start(t);
    osc.stop(end);
  });
  lfo.start(t);
  lfo.stop(end);
}

function bass(ac: Ctx, out: AudioNode, t: number, m: number, dur: number, vol: number) {
  const f = mtof(m);
  tone(ac, out, t, f, dur, { type: 'sawtooth', vol, attack: 0.004, lp: 1300, lpEnd: 260, q: 3 });
  tone(ac, out, t, f, dur, { vol: vol * 0.8, attack: 0.004 });
}

function softBass(ac: Ctx, out: AudioNode, t: number, m: number, dur: number, vol: number) {
  tone(ac, out, t, mtof(m), dur, { type: 'triangle', vol, attack: 0.01, hold: dur * 0.5, lp: 700, lpEnd: 300 });
  tone(ac, out, t, mtof(m), dur, { vol: vol * 0.9, attack: 0.01, hold: dur * 0.5 });
}

function pluck(ac: Ctx, out: AudioNode, t: number, m: number, dur: number, vol: number, type: OscillatorType, sends: Send[], pan = 0) {
  tone(ac, out, t, mtof(m), dur, { type, vol, attack: 0.003, lp: 3800, lpEnd: 500, q: 2, send: sends, pan });
}

/** Distorted power-chord chug (root and fifth into a soft drive). */
function chug(ac: Ctx, out: AudioNode, t: number, m: number, dur: number, vol: number) {
  const pre = ac.createGain();
  pre.gain.value = 0.9;
  const sh = ac.createWaveShaper();
  sh.curve = driveCurve(ac) as any;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1700;
  f.Q.value = 0.9;
  const g = envelope(ac, t, dur, vol, 0.003, dur * 0.25);
  pre.connect(sh).connect(f).connect(g).connect(out);
  for (const k of [0, 7]) {
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m + k);
    o.connect(pre);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
}

/** Orchestral-style stab: bright saw chord with a fast filter fall and a noise burst. */
function stab(ac: Ctx, p: Parts, out: AudioNode, t: number, notes: number[], vol: number) {
  for (const m of notes) tone(ac, out, t, mtof(m), 0.45, { type: 'sawtooth', vol, attack: 0.004, lp: 5000, lpEnd: 500, send: sendTo(p.verb, 0.35) });
  noise(ac, p.noise, out, t, 0.12, { type: 'lowpass', f0: 3500, f1: 400, vol: vol * 1.2 });
}

function epiano(ac: Ctx, p: Parts, out: AudioNode, t: number, m: number, dur: number, vol: number, pan = 0) {
  fm(ac, out, t, mtof(m), dur, { ratio: 1, index: 1.2, indexEnd: 0.06, vol, attack: 0.004, pan, send: sendTo(p.verb, 0.3) });
  tone(ac, out, t, mtof(m + 12), 0.25, { vol: vol * 0.12, pan });
}

function musicBox(ac: Ctx, p: Parts, out: AudioNode, t: number, m: number, vol: number, pan: number) {
  fm(ac, out, t, mtof(m), 0.9, { ratio: 3.0, index: 0.35, indexEnd: 0.02, vol, attack: 0.002, pan, send: [sendTo(p.delay, 0.35), sendTo(p.verb, 0.3)] });
}

// ---------------------------------------------------------------- tracks
interface Chord {
  bass: number;
  tones: number[];
}
const ch = (bass: number, ...tones: number[]): Chord => ({ bass, tones });
/** Melody notes per bar: [step, midi, length in steps]. */
type Bar = [number, number, number][];

interface Step {
  ac: Ctx;
  p: Parts;
  bar: number;
  step: number;
  t: number;
  /** Seconds per 16th step. */
  sd: number;
  calm: boolean;
  hot: boolean;
}

interface TrackDef {
  id: TrackId;
  bpm: number;
  bars: number;
  /** Echo time in beats and feedback. */
  delayBeats: number;
  delayFb: number;
  step(s: Step): void;
}

// --- Duel: D minor, 148 BPM, 16 bars (A section + B section).
const D = {
  Dm: ch(38, 62, 65, 69),
  Bb: ch(34, 62, 65, 70),
  C: ch(36, 60, 64, 67),
  Am: ch(33, 60, 64, 69),
  Gm: ch(31, 62, 67, 70),
  A: ch(33, 61, 64, 69),
  Asus: ch(33, 62, 64, 69),
};
const DUEL_CHORDS: Chord[] = [D.Dm, D.Bb, D.C, D.Am, D.Dm, D.Bb, D.Gm, D.A, D.Bb, D.C, D.Am, D.Dm, D.Gm, D.Bb, D.Asus, D.A];
const DUEL_MELODY: Bar[] = [
  [[0, 69, 3], [3, 74, 3], [6, 76, 2], [8, 77, 6], [14, 76, 2]],
  [[0, 74, 3], [3, 72, 3], [6, 70, 2], [8, 77, 4], [12, 74, 4]],
  [[0, 76, 6], [6, 79, 2], [8, 77, 2], [10, 76, 2], [12, 72, 4]],
  [[0, 69, 8], [8, 76, 4], [12, 72, 4]],
  [[0, 69, 3], [3, 74, 3], [6, 76, 2], [8, 77, 4], [12, 81, 4]],
  [[0, 79, 3], [3, 77, 3], [6, 74, 2], [8, 77, 4], [12, 79, 4]],
  [[0, 79, 4], [4, 81, 2], [6, 82, 2], [8, 81, 4], [12, 79, 4]],
  [[0, 76, 6], [6, 73, 2], [8, 69, 8]],
  [[0, 77, 8], [8, 74, 4], [12, 77, 4]],
  [[0, 79, 8], [8, 76, 4], [12, 72, 4]],
  [[0, 81, 6], [6, 79, 2], [8, 76, 8]],
  [[0, 77, 4], [4, 76, 4], [8, 74, 8]],
  [[0, 74, 3], [3, 79, 3], [6, 81, 2], [8, 82, 6], [14, 81, 2]],
  [[0, 79, 4], [4, 77, 4], [8, 74, 4], [12, 77, 4]],
  [[0, 74, 8], [8, 76, 8]],
  [[0, 73, 4], [4, 76, 4], [8, 81, 8]],
];
const DUEL_BASS = [0, 0, 12, 0, 0, 12, 0, 7];
const ARP8 = [0, 1, 2, 3, 2, 1, 2, 3];
const ARP16 = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 1, 3, 2, 4, 3, 1];

const duel: TrackDef = {
  id: 'duel',
  bpm: 148,
  bars: 16,
  delayBeats: 0.75,
  delayFb: 0.28,
  step({ ac, p, bar, step, t, sd, calm, hot }) {
    const c = DUEL_CHORDS[bar];
    const b = p.base;
    // --- base layer: kit, bass, pad, lead
    if (step === 0) pad(ac, p, b, t, sd * 16, c.tones, 0.022, 1500);
    if (step === 0 || step === 8 || step === 10 || (step === 14 && bar % 4 === 3)) kick(ac, b, t, step === 0 ? 0.5 : 0.42);
    if (step === 4 || step === 12) snare(ac, p, b, t, 0.26);
    if (step % 2 === 0) hat(ac, p, b, t, step % 4 === 0 ? 0.06 : 0.04, step === 14 && bar % 2 === 1);
    if (step % 2 === 0) bass(ac, b, t, c.bass + DUEL_BASS[step / 2], sd * 1.7, 0.13);
    for (const [s, m, len] of DUEL_MELODY[bar]) {
      if (s === step) lead(ac, b, t, m, len * sd * 0.95, { types: ['sawtooth', 'sawtooth', 'square'], vol: 0.07, cut: 2600, sends: [sendTo(p.delay, 0.18), sendTo(p.verb, 0.22)] });
    }
    // --- calm layer: an 8th-note arpeggio
    if (calm && step % 2 === 0) {
      const tones = [...c.tones, c.tones[0] + 12];
      pluck(ac, p.calm, t, tones[ARP8[step / 2]], sd * 1.6, 0.035, 'square', [sendTo(p.delay, 0.3)], step % 4 ? 0.3 : -0.3);
    }
    // --- pinch layer: double-time hats, gallop bass, chugs, fast arp, crashes and stabs
    if (hot) {
      const x = p.hot;
      if (step % 2 === 1) hat(ac, p, x, t, 0.035, false, -0.25);
      if (step === 3 || step === 6 || step === 11 || step === 14) kick(ac, x, t, 0.32);
      if (step % 2 === 1) tone(ac, x, t, mtof(c.bass), sd * 0.8, { type: 'sawtooth', vol: 0.09, attack: 0.003, lp: 650 });
      if (step % 2 === 0) chug(ac, x, t, c.bass + 12, sd * 1.4, 0.045);
      const tones = [c.tones[0] + 12, c.tones[1] + 12, c.tones[2] + 12, c.tones[0] + 24, c.tones[1] + 24];
      pluck(ac, x, t, tones[ARP16[step]], sd * 1.2, 0.022, 'sawtooth', [sendTo(p.delay, 0.22)], step % 2 ? 0.4 : -0.4);
      if (step === 0 && bar % 4 === 0) crash(ac, p, x, t, 0.07);
      if (step === 0 && bar % 2 === 0) stab(ac, p, x, t, [c.tones[0], c.tones[1], c.tones[2], c.tones[0] + 12], 0.03);
      if (bar % 8 === 7 && step >= 12) tom(ac, x, t, [220, 185, 150, 120][step - 12], 0.3);
      if (step === 15) snare(ac, p, x, t, 0.09);
    }
  },
};

// --- Menu: E minor colours, 84 BPM, 16 bars; the flute-like melody enters on the second half.
const M = {
  Cmaj7: ch(36, 55, 59, 64, 67),
  D6: ch(38, 54, 57, 59, 62),
  Bm7: ch(35, 54, 57, 62, 66),
  Em7: ch(40, 55, 59, 62, 67),
  Am9: ch(33, 55, 60, 64, 71),
  D: ch(38, 57, 62, 66, 69),
  Gmaj7: ch(31, 54, 59, 62, 67),
  B7sus: ch(35, 52, 57, 64, 66),
  B7: ch(35, 51, 57, 63, 66),
};
const MENU_CHORDS: Chord[] = [M.Cmaj7, M.D6, M.Bm7, M.Em7, M.Am9, M.D, M.Gmaj7, M.B7sus, M.Cmaj7, M.D6, M.Bm7, M.Em7, M.Am9, M.D, M.Gmaj7, M.B7];
const MENU_MELODY: Bar[] = [
  [[0, 76, 6], [6, 74, 2], [8, 71, 8]],
  [[0, 69, 4], [4, 71, 4], [8, 74, 6], [14, 76, 2]],
  [[0, 78, 8], [8, 76, 4], [12, 74, 4]],
  [[0, 71, 12]],
  [[0, 72, 4], [4, 76, 4], [8, 79, 6], [14, 78, 2]],
  [[0, 76, 4], [4, 74, 4], [8, 69, 8]],
  [[0, 71, 4], [4, 74, 4], [8, 78, 8]],
  [[0, 75, 6], [6, 78, 2], [8, 83, 8]],
];
const MENU_ARP = [0, 1, 2, 3, 4, 3, 2, 1];
const SWING = 0.2;

const menu: TrackDef = {
  id: 'menu',
  bpm: 84,
  bars: 16,
  delayBeats: 0.75,
  delayFb: 0.35,
  step({ ac, p, bar, step, t, sd }) {
    const c = MENU_CHORDS[bar];
    const b = p.base;
    const sw = step % 4 === 2 ? sd * SWING : 0;
    const ts = t + sw;
    if (step === 0) pad(ac, p, b, t, sd * 16, c.tones, 0.018, 1100, 'triangle');
    // e-piano comping
    if (step === 0) c.tones.forEach((m, i) => epiano(ac, p, b, t + i * 0.012, m, sd * 9, 0.04, (i - 1.5) * 0.2));
    if (step === 6 || (step === 10 && bar % 2 === 1)) c.tones.slice(1).forEach((m, i) => epiano(ac, p, b, ts + i * 0.01, m, sd * 5, 0.028, (i - 1) * 0.25));
    // bass
    if (step === 0) softBass(ac, b, t, c.bass + 12, sd * 6, 0.12);
    if (step === 10) softBass(ac, b, ts, c.bass + (bar % 2 ? 19 : 12), sd * 4, 0.09);
    if (step === 14 && bar % 2 === 0) softBass(ac, b, ts, c.bass + 24, sd * 2, 0.06);
    // light kit
    if (step === 0 || step === 10) kick(ac, b, ts, 0.3);
    if (step === 7 && bar % 4 === 3) kick(ac, b, t, 0.18);
    if (step === 4 || step === 12) rim(ac, p, b, t, 0.08);
    if (step % 4 === 2) hat(ac, p, b, ts, 0.035);
    if (step % 2 === 1) hat(ac, p, b, t, 0.012, false, -0.2);
    // music-box arpeggio on the offbeat 8ths
    if (step % 2 === 0) {
      const tones = [...c.tones.map((m) => m + 12), c.tones[0] + 24];
      const m = tones[MENU_ARP[step / 2] % tones.length];
      musicBox(ac, p, p.calm, ts, m, bar < 8 ? 0.035 : 0.022, step % 4 ? 0.35 : -0.35);
    }
    // melody on the second half of the loop
    if (bar >= 8) {
      for (const [s, m, len] of MENU_MELODY[bar - 8]) {
        if (s === step) lead(ac, b, t, m, len * sd * 0.92, { types: ['triangle', 'sine'], vol: 0.075, cut: 3000, attack: 0.05, vibrato: 10, sends: [sendTo(p.delay, 0.25), sendTo(p.verb, 0.35)] });
      }
    }
  },
};

const TRACKS: Record<TrackId, TrackDef> = { menu, duel };

// ---------------------------------------------------------------- one playing track
class TrackPlayer {
  readonly out: GainNode;
  private parts: Parts;
  private calmG: GainNode;
  private hotG: GainNode;
  private delayIn: GainNode;
  private k = 0;
  private sd: number;
  private pinch = false;
  private want = false;
  private xEnd = -1;
  private stopAt: number | null = null;
  done = false;

  constructor(
    private ac: Ctx,
    chain: Chain,
    readonly def: TrackDef,
    private t0: number,
    fadeIn: number,
  ) {
    this.sd = 60 / def.bpm / 4;
    this.out = ac.createGain();
    this.out.gain.setValueAtTime(0.0001, t0);
    this.out.gain.linearRampToValueAtTime(1, t0 + Math.max(0.02, fadeIn));
    this.out.connect(chain.vol);
    const base = ac.createGain();
    this.calmG = ac.createGain();
    this.hotG = ac.createGain();
    this.hotG.gain.value = 0;
    for (const n of [base, this.calmG, this.hotG]) n.connect(this.out);
    // tempo-synced echo with a darkening feedback loop
    this.delayIn = ac.createGain();
    const dl = ac.createDelay(2);
    dl.delayTime.value = (60 / def.bpm) * def.delayBeats;
    const fb = ac.createGain();
    fb.gain.value = def.delayFb;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    this.delayIn.connect(dl).connect(lp).connect(fb).connect(dl);
    lp.connect(this.out);
    this.parts = { base, calm: this.calmG, hot: this.hotG, delay: this.delayIn, verb: chain.verb, noise: graphFor(ac).noise };
  }

  setPinch(on: boolean) {
    this.want = on && this.def.id === 'duel';
  }

  /** Schedule every step that starts before `until`. Steps already in the past are skipped, never bunched. */
  pump(until: number, now: number) {
    while (!this.done) {
      const t = this.t0 + this.k * this.sd;
      if (t >= until) break;
      if (this.stopAt !== null && t >= this.stopAt) {
        this.finish();
        break;
      }
      const step = this.k % 16;
      const bar = Math.floor(this.k / 16) % this.def.bars;
      if (step === 0 && this.want !== this.pinch) this.switchAt(t);
      if (t >= now - 0.01) {
        const cross = t < this.xEnd;
        this.def.step({ ac: this.ac, p: this.parts, bar, step, t, sd: this.sd, calm: !this.pinch || cross, hot: this.pinch || cross });
      }
      this.k++;
    }
  }

  /** Crossfade the calm and pinch layers, starting on a bar line. */
  private switchAt(t: number) {
    this.pinch = this.want;
    const bar = this.sd * 16;
    const ramp = (g: GainNode, from: number, to: number, dur: number) => {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(from, t);
      g.gain.linearRampToValueAtTime(to, t + dur);
    };
    if (this.pinch) {
      ramp(this.hotG, 0, 1, 0.3);
      ramp(this.calmG, 1, 0, bar);
    } else {
      ramp(this.hotG, 1, 0, bar);
      ramp(this.calmG, 0, 1, bar * 0.5);
    }
    this.xEnd = t + bar;
  }

  fadeOut(now: number, dur: number) {
    if (this.stopAt !== null) return;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(0.0001, g.value), now);
    g.linearRampToValueAtTime(0.0001, now + dur);
    this.stopAt = now + dur;
  }

  private finish() {
    this.done = true;
    const out = this.out;
    // let the last scheduled notes and echoes die out silently before unhooking
    window.setTimeout(() => {
      try {
        out.disconnect();
      } catch {
        /* ignore */
      }
    }, (LOOKAHEAD + 0.5) * 1000);
  }
}

// ---------------------------------------------------------------- controller
class MusicController {
  private scene: TrackId | null = null;
  private cur: TrackPlayer | null = null;
  private old: TrackPlayer[] = [];
  private timer = 0;
  private pinch = false;
  private inited = false;
  private pending: { fade?: number; delay?: number } = {};

  private init() {
    if (this.inited) return;
    this.inited = true;
    installAudioUnlock();
    onAudioReady(() => this.sync());
    onSettingsChange(() => this.sync());
    document.addEventListener('visibilitychange', () => this.sync());
  }

  /** Choose what should be playing: 'menu', 'duel' or nothing. Crossfades between tracks. */
  setScene(id: TrackId | null, opts: { fade?: number; delay?: number } = {}) {
    this.init();
    if (id === this.scene) return;
    this.scene = id;
    if (id === 'duel') this.pinch = false;
    this.pending = opts;
    this.sync();
  }

  /** Pinch layer on/off (either player at ≤ 2000 LP). Takes effect on the next bar line. */
  setPinch(on: boolean) {
    if (on === this.pinch) return;
    this.pinch = on;
    this.cur?.setPinch(on);
  }

  /** The duel is over: clear the floor quickly so the win / lose sting plays on its own. */
  duelEnd() {
    this.setScene(null, { fade: 0.6 });
  }

  get playing(): TrackId | null {
    return this.cur?.def.id ?? null;
  }

  private sync() {
    const s = getSettings();
    const want = s.music ? this.scene : null;
    const ac = audioContext();
    if (!ac) return;
    if (ac.state !== 'running') {
      if (want) resumeAudio();
      return;
    }
    const chain = chainFor(ac);
    const now = ac.currentTime;
    chain.vol.gain.setTargetAtTime(s.music ? s.volume * MUSIC_LEVEL : 0, now, 0.08);
    const opts = this.pending;
    this.pending = {};
    if (this.cur?.def.id !== want) {
      if (this.cur) {
        this.cur.fadeOut(now, opts.fade ?? 1.4);
        this.old.push(this.cur);
        this.cur = null;
      }
      if (want) {
        this.cur = new TrackPlayer(ac, chain, TRACKS[want], now + 0.06 + (opts.delay ?? 0), this.old.length ? 1.2 : 2.5);
        this.cur.setPinch(this.pinch);
      }
    }
    this.ensureTimer();
  }

  private ensureTimer() {
    if (this.timer || document.hidden) return;
    if (!this.cur && !this.old.length) return;
    this.timer = window.setTimeout(this.tick, 0);
  }

  private tick = () => {
    this.timer = 0;
    const ac = audioContext();
    if (!ac || document.hidden) return; // visibilitychange restarts the timer
    if (ac.state === 'running') {
      const now = ac.currentTime;
      const until = now + LOOKAHEAD;
      this.cur?.pump(until, now);
      this.old = this.old.filter((p) => {
        p.pump(until, now);
        return !p.done;
      });
    }
    if (this.cur || this.old.length) this.timer = window.setTimeout(this.tick, TICK_MS);
  };
}

export const music = new MusicController();

/**
 * Render `seconds` of a track into a given (offline) context, for level checks and tests.
 * `pinch` starts the duel track in its pinch variation.
 */
export function renderMusic(ac: BaseAudioContext, id: TrackId, seconds: number, opts: { pinch?: boolean; volume?: number } = {}) {
  const chain = chainFor(ac);
  chain.vol.gain.value = (opts.volume ?? 0.6) * MUSIC_LEVEL;
  const p = new TrackPlayer(ac, chain, TRACKS[id], 0, 0.02);
  p.setPinch(!!opts.pinch);
  p.pump(seconds, 0);
}
