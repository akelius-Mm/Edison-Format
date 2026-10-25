// Shared Web Audio plumbing: one AudioContext for sound effects and music, the iOS unlock on the
// first tap, pausing while the page is hidden, a shared room reverb and an output limiter.

export type Ctx = BaseAudioContext;

export interface AudioGraph {
  ctx: Ctx;
  /** Everything ends here: soft limiter → speakers. */
  out: GainNode;
  /** Send into the shared room reverb (sound effects). */
  reverb: GainNode;
  /** Music bus input. Its gain is used for ducking under big sound effects. */
  music: GainNode;
  /** 2 s of white noise, shared by every noise voice. */
  noise: AudioBuffer;
}

const graphs = new WeakMap<Ctx, AudioGraph>();

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
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 3;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.18;
  limiter.connect(ctx.destination);
  const out = ctx.createGain();
  out.connect(limiter);

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
    live.onstatechange = () => {
      if (live?.state === 'running') for (const f of [...readyListeners]) f();
    };
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
  if (document.hidden) {
    if (c.state === 'running') {
      suspendedForHidden = true;
      c.suspend().catch(() => {});
    }
  } else if (suspendedForHidden || c.state !== 'running') {
    suspendedForHidden = false;
    resumeAudio();
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
