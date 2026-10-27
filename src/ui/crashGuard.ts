// Crash-loop breaker for screens that do heavy work from saved state (the live event screen).
//
// When the browser kills the page (iOS: "A problem repeatedly occurred on …"), no code runs: no
// error handler, no pagehide. So before a risky step we leave a mark in localStorage and remove it
// once the step is over. A mark still there the next time the screen opens means that step killed
// the app last time, and the screen offers a way out (try again, or abandon) instead of running
// the same step straight into the same crash.
//
// Leaving the app normally (background, closing the tab) is not a crash: the mark is dropped then.

const KEY = 'edison.crashguard.v1';

export interface RiskyMark {
  /** What the mark belongs to, e.g. "events:<event id>". */
  scope: string;
  /** What was being done, in words ("opening the event", "pairing round 5"). */
  what: string;
  at: number;
}

function read(): RiskyMark | null {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || 'null') as RiskyMark | null;
    return m && typeof m.scope === 'string' && typeof m.what === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** Mark the start of a risky step. */
export function beginRisky(scope: string, what: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ scope, what, at: Date.now() } satisfies RiskyMark));
  } catch {
    /* storage full: no guard */
  }
}

/** The step finished (or the app is leaving normally). */
export function endRisky(scope?: string) {
  const m = read();
  if (!m || (scope && m.scope !== scope)) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The step that was running in `scope` when the app died, or null. */
export function interruptedStep(scope: string): RiskyMark | null {
  const m = read();
  return m && m.scope === scope ? m : null;
}

/** Run `fn` as a risky step: marked before, unmarked after (also when it throws). */
export function risky<T>(scope: string, what: string, fn: () => T): T {
  beginRisky(scope, what);
  try {
    return fn();
  } finally {
    endRisky(scope);
  }
}

let installed = false;
/** Going to the background or closing normally is not a crash. */
export function installCrashGuard() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && endRisky());
  window.addEventListener('pagehide', () => endRisky());
}

// ---------------------------------------------------------------- app-wide breaker
// The same idea for the whole app: a mark is left while the app is open and on screen, and dropped
// when it goes to the background or closes normally. A mark still there when the app starts means the
// browser killed it while it was on screen (on iPhone, almost always for using too much memory).
const BOOT_KEY = 'edison.boot.v1';

export interface BootCrash {
  /** The screen the app was on when it died. */
  hash: string;
  at: number;
}

/**
 * Call once at startup, before the first screen opens. Returns the screen the app died on last time,
 * or null when it closed normally.
 */
export function bootGuard(): BootCrash | null {
  let crashed: BootCrash | null = null;
  try {
    const m = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null') as BootCrash | null;
    if (m && typeof m.hash === 'string' && typeof m.at === 'number') crashed = m;
  } catch {
    /* unreadable: treat as a normal start */
  }
  const mark = () => {
    try {
      localStorage.setItem(BOOT_KEY, JSON.stringify({ hash: location.hash, at: Date.now() } satisfies BootCrash));
    } catch {
      /* storage full: no guard */
    }
  };
  const unmark = () => {
    try {
      localStorage.removeItem(BOOT_KEY);
    } catch {
      /* ignore */
    }
  };
  mark();
  window.addEventListener('hashchange', () => document.visibilityState === 'visible' && mark());
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? unmark() : mark()));
  window.addEventListener('pagehide', unmark);
  window.addEventListener('pageshow', mark);
  return crashed;
}
