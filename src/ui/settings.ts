// Persistent user settings & profile (localStorage, failure-tolerant).
import type { Difficulty } from '../ai/ai';

export interface Settings {
  playerName: string;
  /** Avatar id (procedural avatar seed or preset key). */
  avatar: string;
  /** Sleeve id from SLEEVES registry. */
  sleeve: string;
  /** Playmat id from PLAYMATS registry. */
  playmat: string;
  /** 0.25 = very fast … 2 = slow. 1 is normal. 0 = instant. */
  animationSpeed: number;
  sound: boolean;
  volume: number;
  music: boolean;
  /** When to stop and ask the player to respond: smart = only when it is likely relevant. */
  responsePrompts: 'smart' | 'always';
  defaultDifficulty: Difficulty;
  /** Player going first skips the first draw (Edison-era rule). */
  skipFirstDraw: boolean;
  showLog: boolean;
  confirmEndTurn: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  playerName: 'Duelist',
  avatar: 'avatar-1',
  sleeve: 'classic-red',
  playmat: 'edison-night',
  animationSpeed: 1,
  sound: true,
  volume: 0.6,
  music: false,
  responsePrompts: 'smart',
  defaultDifficulty: 'normal',
  skipFirstDraw: true,
  showLog: true,
  confirmEndTurn: false,
};

const KEY = 'edison.settings.v1';
let current: Settings | null = null;
const listeners = new Set<(s: Settings) => void>();

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: ignore */
  }
}

export function getSettings(): Settings {
  if (!current) current = { ...DEFAULT_SETTINGS, ...loadJSON<Partial<Settings>>(KEY, {}) };
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...getSettings(), ...patch };
  saveJSON(KEY, current);
  for (const l of listeners) l(current);
}

export function onSettingsChange(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
