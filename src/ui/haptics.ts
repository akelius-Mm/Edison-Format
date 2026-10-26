// Haptic feedback.
//
// - Android and other browsers with the Vibration API: short vibration patterns per kind.
// - iPhone (Safari 18+ and home-screen apps, which have no navigator.vibrate): toggling an
//   `<input type="checkbox" switch>` makes iOS play its system switch "tick". A hidden one inside a
//   label is created once; clicking the label gives one tick. Stronger kinds are 2–3 ticks about
//   70 ms apart. iOS only plays it reliably inside a user gesture, so call `haptic()` synchronously
//   from tap handlers where possible.
//
// Throttled to one event per 40 ms; off when Settings → Haptics is off.
import { getSettings } from './settings';

export type HapticKind = 'light' | 'medium' | 'heavy' | 'impact' | 'success' | 'warning' | 'error' | 'selection';

/** Vibration API patterns (ms on / off / on …). */
const VIBRATE: Record<HapticKind, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 22,
  heavy: [34, 40, 22],
  /** A big hit (large LP loss): a strong knock with a rumble after it. */
  impact: [45, 35, 30, 35, 18],
  success: [16, 60, 26],
  warning: [24, 70, 24],
  error: [30, 60, 30, 60, 40],
};
/** iOS switch ticks per kind (each tick is the same system haptic). */
const TICKS: Record<HapticKind, number> = { selection: 1, light: 1, medium: 1, heavy: 2, impact: 3, success: 2, warning: 2, error: 3 };
const TICK_GAP_MS = 70;
const MIN_GAP_MS = 40;

let last = 0;
let label: HTMLLabelElement | null = null;

function canVibrate() {
  return typeof navigator !== 'undefined' && typeof (navigator as any).vibrate === 'function';
}

const isIOS = () => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** The hidden iOS switch, created once. */
function iosSwitch(): HTMLLabelElement | null {
  if (label && label.isConnected) return label;
  if (typeof document === 'undefined' || !document.body) return null;
  label = document.createElement('label');
  label.className = 'haptic-switch';
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  // keep the synthetic clicks to ourselves
  label.addEventListener('click', (e) => e.stopPropagation());
  document.body.appendChild(label);
  return label;
}

function tick() {
  iosSwitch()?.click();
}

/** Play a haptic of the given kind (if haptics are on and the device can). */
export function haptic(kind: HapticKind = 'light') {
  try {
    if (!getSettings().haptics) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - last < MIN_GAP_MS) return;
    last = now;
    hapticLog.push(kind);
    if (hapticLog.length > 50) hapticLog.shift();
    if (canVibrate()) {
      // browsers refuse (and log) vibration before the first tap on the page
      const ua = (navigator as any).userActivation;
      if (!ua || ua.hasBeenActive) (navigator as any).vibrate(VIBRATE[kind]);
      return;
    }
    if (!isIOS()) return;
    tick();
    for (let i = 1; i < TICKS[kind]; i++) setTimeout(tick, i * TICK_GAP_MS);
  } catch {
    /* never let feedback break the app */
  }
}

/** Haptic for losing (or dealing) `amount` LP: stronger for bigger hits. */
export function damageHaptic(amount: number): HapticKind {
  return amount >= 3000 ? 'impact' : amount >= 1500 ? 'heavy' : amount >= 500 ? 'medium' : 'light';
}

/** The most recent haptics requested (newest last), for tests and diagnostics. */
export const hapticLog: HapticKind[] = [];
