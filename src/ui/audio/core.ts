// Shared Web Audio plumbing: one AudioContext for sound effects and music, the iOS unlock on the
// first tap, pausing while the page is hidden, a shared room reverb and an output safety clipper.

export type Ctx = BaseAudioContext;

export interface AudioGraph {
  ctx: Ctx;
  /** Everything ends here: soft clipper → speakers. */
  out: GainNode;
  /** Send into the shared room reverb (sound effects). */
  reverb: GainNode;
  /** Music bus input. Its gain is used for ducking under big sound effects. */
  music: GainNode;
  /** 2 s of white noise, shared by every noise voice. */
  noise: AudioBuffer;
}

const graphs = new WeakMap<Ctx, AudioGraph>();
const fades = new WeakMap<Ctx, GainNode>();
let hideTimer = 0;

/** Input level that maps to the end of the clip curve (louder input is held at full scale). */
const CLIP_RANGE = 1.5;
let clipData: Float32Array | null = null;
/** Linear up to 0.75, then a tanh knee that approaches (never passes) full scale. */
function clipCurve(): Float32Array {
  if (clipData) return clipData;
  const n = 2048;
  clipData = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * CLIP_RANGE;
    const a = Math.abs(x);
    const y = a <= 0.75 ? a : 0.75 + 0.25 * Math.tanh((a - 0.75) / 0.25);
    clipData[i] = Math.sign(x) * y;
  }
  return clipData;
}

/** Stereo noise burst with an exponential tail: a cheap, smooth room impulse. */
export function makeImpulse(ctx: Ctx, seconds: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      // gentle low-pass on the noise so the tail sounds warm rather than hissy
      lp += ((Math.random() * 2 - 1) - lp) * (0.55 - 0.35 * k);
      d[i] = lp * Math.pow(1 - k, decay);
    }
  }
  return buf;
}

/** The node graph for a context (live or offline). Built once per context. */
export function graphFor(ctx: Ctx): AudioGraph {
  const have = graphs.get(ctx);
  if (have) return have;
  // Safety soft-clipper instead of a DynamicsCompressor: stateless (no start-up gain dip, no
  // auto make-up gain), identical in every browser, and transparent below about -2.5 dBFS.
  const out = ctx.createGain();
  out.gain.value = 1 / CLIP_RANGE;
  const clip = ctx.createWaveShaper();
  clip.curve = clipCurve() as any;
  // master fade: lets the app fade out before it is paused (leaving the app) and back in on return, instead of a hard cut
  const fade = ctx.createGain();
  fades.set(ctx, fade);
  out.connect(clip).connect(fade).connect(ctx.destination);

  const reverb = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 220;
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, 1.6, 3.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(hp).connect(conv).connect(wet).connect(out);

  const music = ctx.createGain();
  music.connect(out);

  const len = ctx.sampleRate * 2;
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

  const g: AudioGraph = { ctx, out, reverb, music, noise };
  graphs.set(ctx, g);
  return g;
}

/** Briefly lower the music under a big sound effect. */
export function duckMusic(ctx: Ctx, depth = 0.45, hold = 0.5, release = 0.9) {
  const g = graphFor(ctx).music.gain;
  const now = ctx.currentTime;
  const floor = Math.max(0.05, 1 - depth);
  g.cancelScheduledValues(now);
  g.setValueAtTime(Math.min(1, Math.max(floor, g.value)), now);
  g.linearRampToValueAtTime(floor, now + 0.05);
  g.setValueAtTime(floor, now + 0.05 + hold);
  g.linearRampToValueAtTime(1, now + 0.05 + hold + release);
}

// ---------------------------------------------------------------- the one live context
let live: AudioContext | null = null;
let suspendedForHidden = false;
let installed = false;
const readyListeners = new Set<() => void>();

function hasActivation(): boolean {
  const ua = (navigator as any).userActivation;
  // Browsers without the API (older Safari) create a suspended context silently, which is fine.
  return !ua || ua.hasBeenActive || ua.isActive;
}

/**
 * The shared AudioContext, created lazily. Returns null until the user has interacted with the
 * page (creating one earlier only produces console warnings and a suspended context).
 */
export function audioContext(): AudioContext | null {
  if (live) return live;
  if (typeof window === 'undefined' || !hasActivation()) return null;
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    live = new AC({ latencyHint: 'interactive' }) as AudioContext;
    const notify = () => {
      if (live?.state === 'running') for (const f of [...readyListeners]) f();
    };
    live.onstatechange = notify;
    graphFor(live); // build the shared graph (reverb impulse, noise) up front, not on the first sound
    queueMicrotask(notify);
    installAudioUnlock();
    return live;
  } catch {
    return null;
  }
}

export const audioRunning = () => live?.state === 'running';

/** Resume the shared context if the page is visible. Safe to call often. */
export function resumeAudio() {
  const c = live;
  if (!c || document.hidden || c.state === 'running' || c.state === 'closed') return;
  c.resume().catch(() => {
    /* needs a gesture: the next tap retries */
  });
}

/** Called whenever the shared context starts running (after the unlock tap, after returning to the app). */
export function onAudioReady(fn: () => void) {
  readyListeners.add(fn);
  return () => readyListeners.delete(fn);
}

function playSilence(c: AudioContext) {
  // iOS only unlocks output after something actually plays inside the gesture.
  try {
    const b = c.createBuffer(1, 1, c.sampleRate);
    const s = c.createBufferSource();
    s.buffer = b;
    s.connect(c.destination);
    s.start(0);
  } catch {
    /* ignore */
  }
}

function onGesture() {
  if (document.hidden) return;
  if (live && live.state === 'running') return;
  const ua = (navigator as any).userActivation;
  // pointerdown from a finger is not an activation in Chrome; wait for the touchend/click.
  if (ua && !ua.isActive && !ua.hasBeenActive) return;
  const c = audioContext();
  if (!c) return;
  suspendedForHidden = false;
  playSilence(c);
  resumeAudio();
}

function onVisibility() {
  const c = live;
  if (!c) return;
  const fade = fades.get(c);
  if (document.hidden) {
    if (c.state === 'running') {
      suspendedForHidden = true;
      // a short fade, then pause: no click or cut-off when the app goes to the background
      if (fade) {
        const t = c.currentTime;
        fade.gain.cancelScheduledValues(t);
        fade.gain.setValueAtTime(fade.gain.value, t);
        fade.gain.linearRampToValueAtTime(0, t + 0.18);
      }
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        if (document.hidden && c.state === 'running') c.suspend().catch(() => {});
      }, fade ? 220 : 0);
    }
  } else {
    window.clearTimeout(hideTimer);
    if (fade) {
      const t = c.currentTime;
      fade.gain.cancelScheduledValues(t);
      fade.gain.setValueAtTime(fade.gain.value, t);
      fade.gain.linearRampToValueAtTime(1, t + 0.45);
    }
    if (suspendedForHidden || c.state !== 'running') {
      suspendedForHidden = false;
      resumeAudio();
    }
  }
}

/** Install the first-tap unlock and the hidden-page pause. Idempotent. */
export function installAudioUnlock() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, onGesture, opts);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onVisibility);
}
