// Background music. Three slots: menu, duel and pinch (the duel once either player is at 2000 LP
// or less). For each slot the first available source plays:
//
//   1. "Your music": a file the player picked in Settings (stored on the device, see userMusic.ts),
//      looped with a crossfade from its end back into its start;
//   2. the built-in recorded track: CC0 lo-fi hip-hop loops (public/audio/music/, credits in
//      credits.ts), decoded once and looped sample-accurately on bar lines;
//   3. the procedural fallback below, sequenced live with Web Audio (no files):
//      - menu: calm, cool and nostalgic (84 BPM, soft e-piano, music-box arpeggio, flute-like lead);
//      - duel: driving and tense (148 BPM, synth-brass lead, pumping bass, rock kit, arpeggios),
//        with a "pinch" variation layered in for the pinch slot.
//
// Scene and slot changes crossfade. Procedural timing uses the AudioContext clock with a
// look-ahead scheduler (a short timer only decides *when to schedule*; every note is placed on the
// audio clock), so its loops are sample-accurate. Every procedural melody and chord progression is
// original.
import { getSettings, onSettingsChange } from '../settings';
import { type Ctx, audioContext, graphFor, installAudioUnlock, makeImpulse, onAudioReady, resumeAudio } from './core';
import { MUSIC_TRACKS, type MusicSlot, type MusicTrack, decodeAudio, dropMusicTrack, loadMusicTrack, trackById } from './samples';
import { type Send, driveCurve, envelope, fm, kRate, mtof, noise, route, tone } from './synth';
import { type UserTrackMeta, onUserMusicChange, userTrackData, userTracks } from './userMusic';

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

// ---------------------------------------------------------------- recorded / user tracks
/** RMS the recorded and user tracks are levelled to before the music volume (about -16 LUFS music). */
const TARGET_RMS = 0.11;
/** Built-in recordings relative to TARGET_RMS (balanced against the procedural tracks). */
const RECORDED_DB = -2;
/** Your music: commercial masters are dense, so a little lower again. */
const USER_DB = -3;
/** Crossfade between playlist tracks, seconds. */
const TRACK_XF = 4;
/** Start fetching / decoding the next track this long before the current one ends. */
const PRELOAD_S = 30;
/** Built-in tracks play their loop section this many times before the next track. */
const PASSES = 2;

/** Rough RMS of a buffer (every 4th sample of every channel). */
function bufferRms(b: AudioBuffer): number {
  let sum = 0;
  let n = 0;
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i += 4) {
      sum += d[i] * d[i];
      n++;
    }
  }
  return Math.sqrt(sum / Math.max(1, n));
}

/** Gain that brings a track to TARGET_RMS (limited to -14 … +8 dB), plus a trim. */
function levelFor(b: AudioBuffer, trimDb: number): number {
  const rms = bufferRms(b);
  const db = rms > 1e-5 ? 20 * Math.log10(TARGET_RMS / rms) : 0;
  return Math.pow(10, (Math.max(-14, Math.min(8, db)) + trimDb) / 20);
}

/** First and last audible moments of a buffer (seconds), so loops skip leading/trailing silence. */
function audibleSpan(b: AudioBuffer): [number, number] {
  const d = b.getChannelData(0);
  const d2 = b.numberOfChannels > 1 ? b.getChannelData(1) : d;
  let peak = 0;
  for (let i = 0; i < d.length; i += 16) peak = Math.max(peak, Math.abs(d[i]), Math.abs(d2[i]));
  const thr = Math.max(1e-4, peak * 0.003); // about 50 dB below the peak
  let a = 0;
  while (a < d.length && Math.abs(d[a]) < thr && Math.abs(d2[a]) < thr) a += 64;
  let z = d.length - 1;
  while (z > a && Math.abs(d[z]) < thr && Math.abs(d2[z]) < thr) z -= 64;
  return [Math.min(a, d.length - 1) / b.sampleRate, Math.max(a + 64, z) / b.sampleRate];
}

type Kind = 'user' | 'recorded' | 'proc';
interface Voice {
  readonly key: string;
  readonly kind: Kind;
  readonly done: boolean;
  pump(until: number, now: number): void;
  fadeOut(now: number, dur: number): void;
  setPinch(on: boolean): void;
  /** Playback position inside the track (seconds), for resuming. */
  position(now: number): number;
  /** Seconds until the track has played through (Infinity when it loops for ever). */
  remaining(now: number): number;
}

/** The procedural sequencer as a voice. */
class ProcVoice implements Voice {
  readonly kind = 'proc' as const;
  readonly key: string;
  private p: TrackPlayer;
  constructor(ac: Ctx, chain: Chain, id: TrackId, t0: number, fadeIn: number) {
    this.key = `proc:${id}`;
    this.p = new TrackPlayer(ac, chain, TRACKS[id], t0, fadeIn);
  }
  get done() {
    return this.p.done;
  }
  pump(until: number, now: number) {
    this.p.pump(until, now);
  }
  fadeOut(now: number, dur: number) {
    this.p.fadeOut(now, dur);
  }
  setPinch(on: boolean) {
    this.p.setPinch(on);
  }
  position() {
    return 0;
  }
  remaining() {
    return Infinity;
  }
}

/**
 * A decoded track. Built-in tracks have exact loop points and use the source node's own
 * sample-accurate looping (`passes` times round, or for ever). Your music plays the whole
 * (silence-trimmed) file; when it repeats, each pass overlaps the next with a crossfade.
 */
class LoopVoice implements Voice {
  done = false;
  private out: GainNode;
  private srcs: { src: AudioBufferSourceNode; end: number }[] = [];
  private next = 0;
  private left: number;
  private span: [number, number];
  private xf: number;
  private stopAt: number | null = null;

  constructor(
    private ac: Ctx,
    chain: Chain,
    readonly key: string,
    readonly kind: Kind,
    private buf: AudioBuffer,
    private loop: { loopStart: number; loopEnd: number } | null,
    private t0: number,
    fadeIn: number,
    level: number,
    private offset = 0,
    private passes = Infinity,
  ) {
    this.left = passes;
    this.out = ac.createGain();
    this.out.gain.setValueAtTime(0.0001, t0);
    this.out.gain.linearRampToValueAtTime(level, t0 + Math.max(0.02, fadeIn));
    this.out.connect(chain.vol);
    if (loop) {
      this.span = [loop.loopStart, Math.min(loop.loopEnd, buf.duration)];
      this.xf = 0;
      const len = this.span[1] - this.span[0];
      this.offset = offset % (len * (Number.isFinite(passes) ? passes : 1));
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = this.span[0];
      src.loopEnd = this.span[1];
      src.connect(this.out);
      src.start(t0, this.span[0] + (this.offset % len));
      this.srcs.push({ src, end: Infinity });
    } else {
      this.span = audibleSpan(buf);
      const len = this.span[1] - this.span[0];
      this.xf = Math.max(0.05, Math.min(3, len / 4));
      this.offset = offset % Math.max(0.1, len - this.xf);
      this.next = t0;
      this.queue(t0 + 1, true);
    }
  }

  private get len() {
    return this.span[1] - this.span[0];
  }

  /** Your music: keep the next overlapping pass scheduled ahead of time. */
  private queue(until: number, first = false) {
    const [a] = this.span;
    while (this.next < until && this.stopAt === null && this.left > 0) {
      const off = first ? this.offset : 0;
      const dur = this.len - off;
      const src = this.ac.createBufferSource();
      src.buffer = this.buf;
      const g = this.ac.createGain();
      const t = this.next;
      const last = this.left === 1;
      // each pass fades in over the previous pass's fade-out (the first one uses the voice fade)
      g.gain.setValueAtTime(first ? 1 : 0.0001, t);
      if (!first) g.gain.linearRampToValueAtTime(1, t + this.xf);
      if (!last) {
        g.gain.setValueAtTime(1, t + dur - this.xf);
        g.gain.linearRampToValueAtTime(0.0001, t + dur);
      }
      src.connect(g).connect(this.out);
      src.start(t, a + off, dur);
      this.srcs.push({ src, end: t + dur });
      this.next = t + dur - this.xf;
      this.left--;
      first = false;
    }
    const now = this.ac.currentTime;
    this.srcs = this.srcs.filter((s) => s.end > now - 1);
  }

  pump(until: number, now: number) {
    if (this.done) return;
    if ((this.stopAt !== null && now >= this.stopAt) || (!this.loop && this.left <= 0 && this.srcs.every((s) => s.end <= now))) {
      this.finish();
      return;
    }
    if (!this.loop) this.queue(until + 1);
  }

  setPinch() {
    /* separate tracks: the controller crossfades between them */
  }

  position(now: number) {
    const el = Math.max(0, now - this.t0) + this.offset;
    const period = this.loop ? this.len : this.len - this.xf;
    return period > 0 ? el % (period * (Number.isFinite(this.passes) ? this.passes : 1)) : 0;
  }

  remaining(now: number) {
    if (!Number.isFinite(this.passes)) return Infinity;
    const el = Math.max(0, now - this.t0) + this.offset;
    const total = this.loop ? this.passes * this.len : this.passes * (this.len - this.xf) + this.xf;
    return total - el;
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
    for (const { src } of this.srcs) {
      try {
        src.stop();
      } catch {
        /* not started or already stopped */
      }
    }
    this.srcs = [];
    try {
      this.out.disconnect();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- playlists
type Scene = 'menu' | 'duel';
const groupOf = (slot: MusicSlot): Scene => (slot === 'menu' ? 'menu' : 'duel');

/** A playable entry of a slot's playlist. */
export interface PlaylistTrack {
  key: string;
  kind: 'user' | 'recorded';
  slot: MusicSlot;
  title: string;
  artist: string;
  track?: MusicTrack;
  userId?: number;
}

export interface NowPlaying {
  slot: MusicSlot;
  kind: Kind;
  title: string;
  artist: string;
  /** Another track is available to skip to. */
  canSkip: boolean;
}

/** Fisher-Yates shuffle that never starts with `avoid` (when there is a choice). */
function shuffled(keys: string[], avoid?: string): string[] {
  const a = [...keys];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (a.length > 1 && a[0] === avoid) [a[0], a[1]] = [a[1], a[0]];
  return a;
}

interface SlotState {
  /** Shuffled play order (keys) and the position of the next one to take. */
  order: string[];
  pos: number;
  /** The track this slot plays (or played last). */
  current?: string;
  /** The next track, chosen ahead so it can be preloaded. */
  upcoming?: string;
  /** The track to start with when the slot comes on (chosen ahead so it can be preloaded). */
  entry?: string;
}

class MusicController {
  private scene: Scene | null = null;
  private cur: Voice | null = null;
  private curSlot: MusicSlot | null = null;
  private old: Voice[] = [];
  private timer = 0;
  private pinch = false;
  private inited = false;
  private pending: { fade?: number; delay?: number } = {};
  /** Decoded tracks by key ('rec:first-snow', 'user:12') with their level. */
  private bufs = new Map<string, { buf: AudioBuffer; level: number }>();
  private loading = new Set<string>();
  private failed = new Set<string>();
  private user: UserTrackMeta[] = [];
  private userKnown = false;
  private slots = new Map<MusicSlot, SlotState>();
  /** Where each track was when it last faded out, to pick up there (duel ↔ pinch). */
  private resume = new Map<string, { pos: number; at: number }>();
  private skipWanted = false;
  private lastTidy = 0;
  private npListeners = new Set<(np: NowPlaying | null) => void>();
  private npLast = '';

  private init() {
    if (this.inited) return;
    this.inited = true;
    installAudioUnlock();
    onAudioReady(() => this.sync());
    onSettingsChange(() => {
      // switched-off tracks drop out of the queue (the playing one finishes first)
      for (const st of this.slots.values()) st.upcoming = undefined;
      this.preload();
      this.sync();
    });
    document.addEventListener('visibilitychange', () => this.sync());
    // tracks that failed offline (not cached yet) get another chance once the network is back
    window.addEventListener('online', () => {
      for (const k of [...this.failed]) if (k.startsWith('rec:')) this.failed.delete(k);
      this.sync();
    });
    onUserMusicChange((slot) => {
      const st = this.slots.get(slot);
      if (st) (st.order = []), (st.upcoming = undefined);
      this.refreshUser();
    });
    this.refreshUser();
  }

  private refreshUser() {
    void userTracks().then((m) => {
      this.user = m;
      this.userKnown = true;
      for (const [k] of this.bufs) if (k.startsWith('user:') && !m.some((t) => `user:${t.id}` === k)) this.bufs.delete(k);
      this.preload();
      this.sync();
    });
  }

  /** Choose what should be playing: 'menu', 'duel' or nothing. Crossfades between tracks. */
  setScene(id: Scene | null, opts: { fade?: number; delay?: number } = {}) {
    this.init();
    if (id === this.scene) return;
    this.scene = id;
    if (id === 'duel') this.pinch = false;
    this.pending = opts;
    this.preload();
    this.sync();
  }

  /** Pinch on/off (either player at ≤ 2000 LP). */
  setPinch(on: boolean) {
    if (on === this.pinch) return;
    this.pinch = on;
    this.preload();
    this.sync();
  }

  /** The duel is over: clear the floor quickly so the win / lose sting plays on its own. */
  duelEnd() {
    this.setScene(null, { fade: 0.6 });
  }

  /** What is playing now: 'rec:first-snow', 'user:3', 'proc:duel' … or null. */
  get playing(): string | null {
    return this.cur?.key ?? null;
  }

  /** Title and artist of what is playing, or null. */
  nowPlaying(): NowPlaying | null {
    const v = this.cur;
    if (!v || !this.curSlot) return null;
    if (v.kind === 'proc') return { slot: this.curSlot, kind: 'proc', title: v.key === 'proc:menu' ? 'Menu theme' : 'Duel theme', artist: 'Generated in the app', canSkip: false };
    const t = this.trackFor(v.key);
    if (!t) return null;
    return { slot: t.slot, kind: t.kind, title: t.title, artist: t.artist, canSkip: this.playlist(t.slot).length > 1 };
  }

  /** Called whenever the playing track changes. */
  onNowPlaying(fn: (np: NowPlaying | null) => void) {
    this.npListeners.add(fn);
    return () => this.npListeners.delete(fn);
  }

  private notify() {
    const np = this.nowPlaying();
    const sig = JSON.stringify(np);
    if (sig === this.npLast) return;
    this.npLast = sig;
    for (const f of [...this.npListeners]) f(np);
  }

  /** Move on to the next track of the playlist now. */
  skip() {
    if (!this.cur || !this.curSlot || this.cur.kind === 'proc') return;
    if (this.playlist(this.curSlot).length < 2) return;
    this.skipWanted = true;
    this.advance(this.curSlot, true);
  }

  /** Hand over a file Settings already decoded (to check it), so it isn't decoded twice. */
  primeUser(id: number, buf: AudioBuffer) {
    this.bufs.set(`user:${id}`, { buf, level: levelFor(buf, USER_DB) });
    this.failed.delete(`user:${id}`);
  }

  // ------------------------------------------------------------ playlist bookkeeping
  /** The tracks a slot can play: your files if there are any, else the switched-on built-in tracks. */
  playlist(slot: MusicSlot): PlaylistTrack[] {
    const mine = this.user.filter((t) => t.slot === slot);
    let list: PlaylistTrack[];
    if (mine.length) {
      list = mine.map((t) => ({ key: `user:${t.id}`, kind: 'user' as const, slot, title: t.name.replace(/\.[a-z0-9]{2,5}$/i, ''), artist: 'Your music', userId: t.id }));
    } else {
      const off = new Set(getSettings().musicOff ?? []);
      const all = MUSIC_TRACKS.filter((t) => t.slot === slot);
      const on = all.filter((t) => !off.has(t.id));
      list = (on.length ? on : all).map((t) => ({ key: `rec:${t.id}`, kind: 'recorded' as const, slot, title: t.title, artist: t.artist, track: t }));
    }
    return list.filter((t) => !this.failed.has(t.key));
  }

  private trackFor(key: string): PlaylistTrack | undefined {
    if (key.startsWith('rec:')) {
      const t = trackById(key.slice(4));
      return t && { key, kind: 'recorded', slot: t.slot, title: t.title, artist: t.artist, track: t };
    }
    const u = this.user.find((t) => `user:${t.id}` === key);
    return u && { key, kind: 'user', slot: u.slot, title: u.name.replace(/\.[a-z0-9]{2,5}$/i, ''), artist: 'Your music', userId: u.id };
  }

  private state(slot: MusicSlot): SlotState {
    let st = this.slots.get(slot);
    if (!st) this.slots.set(slot, (st = { order: [], pos: 0 }));
    return st;
  }

  /** The next track of a slot after `after` (shuffled, never the same twice in a row). */
  private peekNext(slot: MusicSlot, after?: string): string | undefined {
    const keys = this.playlist(slot).map((t) => t.key);
    if (!keys.length) return undefined;
    if (keys.length === 1) return keys[0];
    const st = this.state(slot);
    if (st.upcoming && keys.includes(st.upcoming) && st.upcoming !== after) return st.upcoming;
    for (let guard = 0; guard < 3; guard++) {
      while (st.pos < st.order.length) {
        const k = st.order[st.pos++];
        if (keys.includes(k) && k !== after) return (st.upcoming = k);
      }
      st.order = shuffled(keys, after);
      st.pos = 0;
    }
    return (st.upcoming = keys.find((k) => k !== after));
  }

  private load(key: string) {
    if (this.bufs.has(key) || this.loading.has(key) || this.failed.has(key)) return;
    const t = this.trackFor(key);
    if (!t) return;
    this.loading.add(key);
    void (async () => {
      try {
        let buf: AudioBuffer;
        if (t.kind === 'user') {
          const data = await userTrackData(t.userId!);
          if (!data) throw new Error('missing');
          buf = await decodeAudio(data);
        } else buf = await loadMusicTrack(t.track!.id);
        this.bufs.set(key, { buf, level: levelFor(buf, t.kind === 'user' ? USER_DB : RECORDED_DB) });
      } catch {
        this.failed.add(key);
        const st = this.slots.get(t.slot);
        if (st && st.upcoming === key) st.upcoming = undefined;
      } finally {
        this.loading.delete(key);
        this.sync();
      }
    })();
  }

  /** The track a slot should play on (re)entry: its last one if it was cut short a moment ago. */
  private entryTrack(slot: MusicSlot, now: number): string | undefined {
    const st = this.state(slot);
    const keys = this.playlist(slot).map((t) => t.key);
    if (st.current && keys.includes(st.current)) {
      const r = this.resume.get(st.current);
      if (r && now - r.at < 60) return st.current;
    }
    if (!st.entry || !keys.includes(st.entry)) st.entry = this.peekNext(slot, st.current);
    return st.entry;
  }

  /** Start fetching / decoding what the scene needs next. */
  private preload() {
    if (!this.scene || !getSettings().music || typeof window === 'undefined' || !this.userKnown) return;
    const ac = audioContext();
    const now = ac?.currentTime ?? 0;
    const slots: MusicSlot[] = this.scene === 'duel' ? ['duel', 'pinch'] : ['menu'];
    for (const slot of slots) {
      if (this.curSlot === slot && this.cur) continue;
      const k = this.entryTrack(slot, now);
      if (k) this.load(k);
    }
  }

  /** Free decoded tracks nothing is about to play. */
  private tidy(now: number) {
    if (now - this.lastTidy < 5) return;
    this.lastTidy = now;
    const keep = new Set<string>();
    if (this.cur) keep.add(this.cur.key);
    for (const v of this.old) keep.add(v.key);
    const slots: MusicSlot[] = this.scene === 'duel' ? ['duel', 'pinch'] : this.scene === 'menu' ? ['menu'] : [];
    for (const s of slots) {
      const st = this.state(s);
      for (const k of [st.current, st.upcoming, st.entry]) if (k) keep.add(k);
    }
    for (const k of [...this.bufs.keys()]) {
      if (keep.has(k) || this.loading.has(k)) continue;
      this.bufs.delete(k);
      if (k.startsWith('rec:')) dropMusicTrack(k.slice(4));
    }
  }

  private wantSlot(): MusicSlot | null {
    if (!getSettings().music || !this.scene) return null;
    return this.scene === 'duel' ? (this.pinch ? 'pinch' : 'duel') : 'menu';
  }

  // ------------------------------------------------------------ playing
  private sync() {
    const s = getSettings();
    const ac = audioContext();
    if (!ac) return;
    let slot = this.wantSlot();
    if (ac.state !== 'running') {
      if (slot) resumeAudio();
      return;
    }
    const chain = chainFor(ac);
    const now = ac.currentTime;
    chain.vol.gain.setTargetAtTime(s.music ? s.volume * MUSIC_LEVEL : 0, now, 0.08);
    const opts = this.pending;
    if (!slot) {
      this.pending = {};
      this.retire(now, opts.fade ?? 1.4);
      this.ensureTimer();
      this.notify();
      return;
    }
    if (!this.userKnown) return;
    // no pinch tracks left (all failed): the duel playlist carries on (procedural: its pinch layer)
    let procPinch = false;
    if (slot === 'pinch' && !this.playlist('pinch').length) {
      slot = 'duel';
      procPinch = true;
    }
    const sameScene = !!this.cur && !!this.curSlot && groupOf(this.curSlot) === groupOf(slot);
    if (this.cur && this.curSlot === slot) {
      // already on this slot: drop a track that left the playlist (file removed), else carry on
      if (this.cur.kind === 'proc') {
        if (!this.playlist(slot).length) {
          this.cur.setPinch(this.wantSlot() === 'pinch');
          this.ensureTimer();
          this.notify();
          return;
        }
      } else if (this.playlist(slot).some((t) => t.key === this.cur!.key)) {
        this.ensureTimer();
        this.notify();
        return;
      }
    }
    const list = this.playlist(slot);
    if (!list.length) {
      // nothing recorded can play: the procedural theme
      this.pending = {};
      const id: TrackId = slot === 'menu' ? 'menu' : 'duel';
      if (this.cur?.key !== `proc:${id}`) {
        this.retire(now, opts.fade ?? (sameScene ? 2 : 1.4));
        this.cur = new ProcVoice(ac, chain, id, now + 0.06 + (opts.delay ?? 0), sameScene ? 1.6 : this.old.length ? 1.2 : 2.5);
        this.curSlot = slot;
      }
      this.cur.setPinch(procPinch || this.wantSlot() === 'pinch');
      this.ensureTimer();
      this.notify();
      return;
    }
    const key = this.entryTrack(slot, now);
    if (!key) return;
    if (!this.bufs.has(key)) {
      this.load(key);
      // keep the duel going while the pinch track loads; otherwise clear the floor meanwhile
      if (this.cur && !sameScene) this.retire(now, opts.fade ?? 1.4);
      this.ensureTimer();
      this.notify();
      return;
    }
    this.pending = {};
    this.start(ac, chain, slot, key, now, opts.fade ?? (sameScene ? 2 : 1.4), sameScene ? 1.6 : this.old.length ? 1.2 : 2.5, opts.delay ?? 0);
  }

  private start(ac: Ctx, chain: Chain, slot: MusicSlot, key: string, now: number, fadeOut: number, fadeIn: number, delay = 0) {
    const b = this.bufs.get(key)!;
    const t = this.trackFor(key)!;
    this.retire(now, fadeOut);
    const st = this.state(slot);
    if (st.entry === key) st.entry = undefined;
    if (st.upcoming === key) st.upcoming = undefined;
    st.current = key;
    const r = this.resume.get(key);
    const offset = r && now - r.at < 60 ? r.pos : 0;
    this.resume.delete(key);
    const single = this.playlist(slot).length < 2;
    const passes = single ? Infinity : t.kind === 'recorded' ? PASSES : 1;
    this.cur = new LoopVoice(ac, chain, key, t.kind, b.buf, t.track ?? null, now + 0.06 + delay, fadeIn, b.level, offset, passes);
    this.curSlot = slot;
    this.ensureTimer();
    this.notify();
  }

  /** Crossfade to the slot's next track if it is ready (`now` = skip; otherwise near the end). */
  private advance(slot: MusicSlot, now = false) {
    const ac = audioContext();
    if (!ac || ac.state !== 'running' || !this.cur) return;
    const next = this.peekNext(slot, this.cur.key);
    if (!next || next === this.cur.key) {
      this.skipWanted = false;
      return;
    }
    if (!this.bufs.has(next)) {
      this.load(next);
      return;
    }
    this.skipWanted = false;
    const t = ac.currentTime;
    const xf = now ? 1.5 : Math.max(0.5, Math.min(TRACK_XF, this.cur.remaining(t)));
    this.resume.delete(this.cur.key);
    const cur = this.cur;
    this.start(ac, chainFor(ac), slot, next, t, xf, xf);
    this.resume.delete(cur.key); // a finished track starts from the top next time
  }

  private retire(now: number, fade: number) {
    if (!this.cur) return;
    this.resume.set(this.cur.key, { pos: this.cur.position(now), at: now });
    this.cur.fadeOut(now, fade);
    this.old.push(this.cur);
    this.cur = null;
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
      const cur = this.cur;
      if (cur && cur.kind !== 'proc' && this.curSlot) {
        const left = cur.remaining(now);
        if (left < PRELOAD_S) {
          const next = this.peekNext(this.curSlot, cur.key);
          if (next) this.load(next);
        }
        if (this.skipWanted || left <= TRACK_XF + LOOKAHEAD) this.advance(this.curSlot, this.skipWanted);
      }
      this.cur?.pump(until, now);
      this.old = this.old.filter((p) => {
        p.pump(until, now);
        return !p.done;
      });
      this.tidy(now);
    }
    if (this.cur || this.old.length) this.timer = window.setTimeout(this.tick, TICK_MS);
  };
}

export const music = new MusicController();

/**
 * Render `seconds` of a procedural track into a given (offline) context, for level checks and
 * tests. `pinch` starts the duel track in its pinch variation.
 */
export function renderMusic(ac: BaseAudioContext, id: TrackId, seconds: number, opts: { pinch?: boolean; volume?: number } = {}) {
  const chain = chainFor(ac);
  chain.vol.gain.value = (opts.volume ?? 0.6) * MUSIC_LEVEL;
  const p = new TrackPlayer(ac, chain, TRACKS[id], 0, 0.02);
  p.setPinch(!!opts.pinch);
  p.pump(seconds, 0);
}

/**
 * Schedule a built-in track (by id), or with `buffer` a decoded file as "your music", into a
 * given (offline) context at the level it plays in the app. `offset` starts that many seconds into
 * the track, e.g. just before the loop point to hear the seam.
 */
export async function renderRecordedMusic(ac: BaseAudioContext, id: string, opts: { volume?: number; offset?: number; buffer?: AudioBuffer } = {}) {
  const chain = chainFor(ac);
  chain.vol.gain.value = (opts.volume ?? 0.6) * MUSIC_LEVEL;
  const user = !!opts.buffer;
  const buf = opts.buffer ?? (await loadMusicTrack(id));
  const kind: Kind = user ? 'user' : 'recorded';
  const t = trackById(id);
  const v = new LoopVoice(ac, chain, `${user ? 'user' : 'rec'}:${id}`, kind, buf, user ? null : t ?? null, 0, 0.02, levelFor(buf, user ? USER_DB : RECORDED_DB), opts.offset ?? 0);
  v.pump((ac as OfflineAudioContext).length / ac.sampleRate, 0);
}
