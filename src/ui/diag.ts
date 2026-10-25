// Problem capture for playtesters: uncaught errors, recent log lines, the device and browser, and
// the duel on screen (seed, decks, decisions in the resume record format) for "Report a problem".
//
// Everything stays on this phone: errors are kept in localStorage (the last 20), log lines in
// memory. Nothing is uploaded; the report is only shared when the player taps Share or Copy.
import type { DuelOptions } from './duel/api';
import { loadActiveDuel, toSavedSide, type SavedDuel } from './duel/resume';
import type { Decision } from '../engine/replay';
import type { PlayerId } from '../engine/types';

declare const __BUILD_ID__: string;
export const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

const ERRORS_KEY = 'edison.errors.v1';
const MAX_ERRORS = 20;
const MAX_LINES = 80;

export interface CapturedError {
  t: number;
  msg: string;
  stack?: string;
  route: string;
  v: string;
  /** window.onerror, an unhandled rejection, or caught and reported by the app. */
  src: 'error' | 'rejection' | 'app';
  /** Thrown outside the app's own code (a browser extension, an in-app browser's injected script). */
  external?: boolean;
}

const lines: string[] = [];
const listeners = new Set<(e: CapturedError) => void>();

const route = () => location.hash || '#/';
const stamp = () => new Date().toISOString().slice(11, 23);

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmt(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

/** Add a line to the in-memory log the report carries. */
export function logLine(kind: string, text: string) {
  lines.push(`${stamp()} ${kind} ${clip(text, 400)}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function recentLines(): string[] {
  return lines.slice();
}

export function loadErrors(): CapturedError[] {
  try {
    const v = JSON.parse(localStorage.getItem(ERRORS_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function clearErrors() {
  try {
    localStorage.removeItem(ERRORS_KEY);
  } catch {
    /* ignore */
  }
}

function store(e: CapturedError) {
  try {
    const list = loadErrors();
    list.push(e);
    localStorage.setItem(ERRORS_KEY, JSON.stringify(list.slice(-MAX_ERRORS)));
  } catch {
    /* storage full or blocked: the error is still in memory for this session */
  }
}

/** Noise that is not a problem with the app. */
function benign(msg: string) {
  return /ResizeObserver loop|^Script error\.?$|Non-Error promise rejection captured with value: Object Not Found Matching Id/i.test(msg);
}

function capture(src: CapturedError['src'], err: unknown, fallback?: string, file?: string) {
  const e = err as Error | undefined;
  const msg = clip(e && typeof e === 'object' && 'message' in e ? `${e.name || 'Error'}: ${e.message}` : fallback || fmt(err), 500);
  const stack = typeof e?.stack === 'string' ? clip(e.stack, 2500) : undefined;
  const own = location.origin;
  const where = `${stack ?? ''} ${file ?? ''}`;
  const external = !!where.trim() && !where.includes(own) && !where.includes('/src/') && !where.includes('/assets/');
  const rec: CapturedError = { t: Date.now(), msg, stack, route: route(), v: BUILD, src, ...(external ? { external: true } : {}) };
  store(rec);
  logLine('ERR', msg);
  if (benign(msg) || external) return;
  for (const f of listeners) {
    try {
      f(rec);
    } catch {
      /* never throw from the error handler */
    }
  }
}

/** A problem the app caught (an error screen, a crashed duel): record it and offer a report. */
export function reportError(err: unknown, context = '') {
  if (context) logLine('ERR', context);
  capture('app', err);
}

/** Called for every captured error worth telling the player about. */
export function onCapturedError(f: (e: CapturedError) => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

let installed = false;

/** Global handlers: uncaught errors and rejections, console warnings and errors, navigation. */
export function installErrorCapture() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (ev) => {
    if (!(ev instanceof ErrorEvent)) return;
    capture('error', ev.error, ev.message, ev.filename);
  });
  window.addEventListener('unhandledrejection', (ev) => capture('rejection', ev.reason, `Unhandled rejection: ${fmt(ev.reason)}`));
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...a: unknown[]) => {
      logLine(level === 'error' ? 'E' : 'W', a.map(fmt).join(' '));
      orig(...a);
    };
  }
  window.addEventListener('hashchange', () => logLine('nav', route()));
  document.addEventListener('visibilitychange', () => logLine('app', document.visibilityState));
  window.addEventListener('online', () => logLine('net', 'online'));
  window.addEventListener('offline', () => logLine('net', 'offline'));
  logLine('app', `start ${BUILD} ${route()}`);
}

// ------------------------------------------------------------------ device and browser

export interface BrowserInfo {
  /** Opened from the Home Screen. */
  standalone: boolean;
  /** Messenger, Instagram, Facebook, TikTok… (null in a real browser). */
  inApp: string | null;
  ios: boolean;
  android: boolean;
  /** A short label, e.g. "Messenger in-app browser (iOS)". */
  label: string;
}

const IN_APP: [RegExp, string][] = [
  [/FBAN\/Messenger|MessengerForiOS|MessengerLite|\bOrca-Android\b/i, 'Messenger'],
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, 'Facebook'],
  [/musical_ly|BytedanceWebview|TikTok|trill_/i, 'TikTok'],
  [/Snapchat/i, 'Snapchat'],
  [/\bLine\//i, 'LINE'],
  [/MicroMessenger/i, 'WeChat'],
  [/Twitter|TwitterAndroid/i, 'X (Twitter)'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Pinterest/i, 'Pinterest'],
  [/\bDiscord\b/i, 'Discord'],
  [/\bGSA\//i, 'Google app'],
];

export function browserInfo(ua = navigator.userAgent): BrowserInfo {
  let standalone = false;
  try {
    standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    /* ignore */
  }
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const inApp = IN_APP.find(([re]) => re.test(ua))?.[1] ?? null;
  const os = ios ? 'iOS' : android ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'other';
  const browser = /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /EdgiOS|Edg\//.test(ua) ? 'Edge' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  const label = standalone ? `Home Screen app (${os})` : inApp ? `${inApp} in-app browser (${os})` : `${browser} tab (${os})`;
  return { standalone, inApp, ios, android, label };
}

// ------------------------------------------------------------------ the duel on screen

interface DuelDiag {
  opts: DuelOptions;
  seed: number;
  me: PlayerId;
  log: () => readonly Decision[];
  turn: () => number;
  lines: string[];
  extra?: () => Record<string, unknown>;
}

let duel: DuelDiag | null = null;

/** The duel screen registers itself while it is open. */
export function setDuelDiag(d: Omit<DuelDiag, 'lines'> | null) {
  duel = d ? { ...d, lines: [] } : null;
}

/** A line of the duel's own log (kept for the report). */
export function duelLogLine(turn: number, text: string) {
  if (!duel) return;
  duel.lines.push(`T${turn} ${clip(text, 200)}`);
  if (duel.lines.length > 60) duel.lines.splice(0, duel.lines.length - 60);
}

/** Online duels add their room details (the friend's decisions). */
export function setDuelDiagExtra(f: (() => Record<string, unknown>) | undefined) {
  if (duel) duel.extra = f;
}

export const inDuelNow = () => !!duel;

/**
 * The duel on screen as a resume record (resume.ts): seed, decks and the human's decisions, which
 * replay the game exactly. When the duel is a saved one, the saved record (with its match context)
 * comes along too.
 */
function duelReport(): Record<string, unknown> | null {
  if (!duel) return null;
  const d = duel;
  let record: SavedDuel | null = null;
  try {
    const o = d.opts;
    record = {
      v: 1,
      tag: { kind: 'vsai', key: 'report', route: 'duel' },
      savedAt: Date.now(),
      setup: { sides: [toSavedSide(o.sides[0]), toSavedSide(o.sides[1])], bestOf: 1, playmat: o.playmat, caption: o.caption ?? 'Duel' },
      games: [],
      game: { index: 0, seed: d.seed, first: o.firstPlayer ?? 'coin', skipFirstDraw: o.skipFirstDraw ?? false, caption: o.caption ?? '', log: d.log().slice(), turn: d.turn() },
    };
  } catch {
    /* best effort */
  }
  let extra: Record<string, unknown> = {};
  try {
    extra = d.extra?.() ?? {};
  } catch {
    /* ignore */
  }
  return { record, saved: loadActiveDuel(), recentLog: d.lines.slice(), spectating: !!d.opts.spectate, online: !!d.opts.remote, ...extra };
}

// ------------------------------------------------------------------ the report

export interface Report {
  kind: 'edison-report';
  v: 1;
  createdAt: string;
  note: string;
  app: { version: string; published?: string | null; url: string; route: string };
  device: Record<string, unknown>;
  errors: CapturedError[];
  log: string[];
  duel: Record<string, unknown> | null;
  /** Not in a duel: the saved duel, if any (resume problems). */
  savedDuel?: SavedDuel | null;
  progress: Record<string, boolean>;
}

let published: string | null | undefined;

/** The id of the version that is live on the site (version.json), fetched once. */
export async function publishedVersion(): Promise<string | null> {
  if (published !== undefined) return published;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    published = res.ok ? ((await res.json()) as { id?: string }).id ?? null : null;
  } catch {
    published = null;
  }
  return published;
}

function has(key: string) {
  try {
    return localStorage.getItem(key) != null;
  } catch {
    return false;
  }
}

export function buildReport(note: string): Report {
  const b = browserInfo();
  const inDuel = duelReport();
  const progress: Record<string, boolean> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^edison\.(duel|locals|events|tournament|friendsLocals|circuit\.season)\.active\.v1$|^edison\.(draft|circuit\.season)\.v1$/.test(k)) progress[k] = true;
    }
  } catch {
    /* ignore */
  }
  return {
    kind: 'edison-report',
    v: 1,
    createdAt: new Date().toISOString(),
    note,
    app: { version: BUILD, published: published ?? null, url: location.origin + location.pathname, route: route() },
    device: {
      label: b.label,
      userAgent: navigator.userAgent,
      standalone: b.standalone,
      inAppBrowser: b.inApp,
      viewport: `${innerWidth}×${innerHeight}`,
      screen: `${screen.width}×${screen.height}@${devicePixelRatio}x`,
      orientation: innerWidth > innerHeight ? 'landscape' : 'portrait',
      language: navigator.language,
      online: navigator.onLine,
      storage: has('edison.settings.v1') ? 'ok' : 'empty',
      serviceWorker: !!navigator.serviceWorker?.controller,
    },
    errors: loadErrors(),
    log: recentLines(),
    duel: inDuel,
    ...(inDuel ? {} : { savedDuel: loadActiveDuel() }),
    progress,
  };
}

/** The readable top of the report (the full JSON follows in the shared file or copied text). */
export function reportSummary(r: Report): string {
  const last = r.errors[r.errors.length - 1];
  const rec = (r.duel?.record ?? null) as SavedDuel | null;
  return [
    'Edison problem report',
    r.note ? `What happened: ${r.note}` : null,
    `Version ${r.app.version.slice(0, 12)}${r.app.published && r.app.published !== r.app.version ? ` (live: ${r.app.published.slice(0, 12)})` : ''}`,
    `${r.device.label} · ${r.device.viewport}`,
    `Screen ${r.app.route}`,
    `${r.errors.length} recent error${r.errors.length === 1 ? '' : 's'}${last ? ` · last: ${last.msg}` : ''}`,
    rec?.game ? `Duel: seed ${rec.game.seed}, turn ${rec.game.turn}, ${rec.game.log.length} decisions` : null,
  ]
    .filter(Boolean)
    .join('\n');
}
