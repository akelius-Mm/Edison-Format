// Persistent user settings & profile (localStorage, failure-tolerant).
import type { Difficulty } from '../ai/ai';

export interface Settings {
  playerName: string;
  /** The player picked a name (even "Duelist"): online play stops asking for one. */
  nameChosen: boolean;
  /** Avatar id (procedural avatar seed or preset key). */
  avatar: string;
  /** Sleeve id from SLEEVES registry. */
  sleeve: string;
  /** Playmat id from PLAYMATS registry. */
  playmat: string;
  /** Binder cover id (theme/binders.ts). */
  binder: string;
  /** 0.25 = very fast … 2 = slow. 1 is normal. 0 = instant. */
  animationSpeed: number;
  sound: boolean;
  /** Vibration / iPhone haptic ticks for taps, plays, damage and results. */
  haptics: boolean;
  volume: number;
  /** Background music: menu, duel and pinch tracks (built-in CC0 recordings or the player's own files). */
  music: boolean;
  /** When to stop and ask the player to respond: smart = only when it is likely relevant. */
  responsePrompts: 'smart' | 'always';
  defaultDifficulty: Difficulty;
  /** Player going first skips the first draw (Edison-era rule). */
  skipFirstDraw: boolean;
  /** Side decking between games of a best-of-3 (both players; off keeps the decks unchanged). */
  sideDecking: boolean;
  showLog: boolean;
  confirmEndTurn: boolean;
  /** Drag a card in your hand up onto the field to play it (duel/swipe.ts). */
  swipeToPlay: boolean;
  /** Opt-in: show official card artwork fetched from the YGOPRODeck database. */
  officialImages: boolean;
  /** Built-in music tracks the player switched off (track ids). */
  musicOff: string[];
  /** Play a friend: PeerJS signalling server ("host:port/path"); empty = the free PeerJS cloud. */
  netServer: string;
}

export const DEFAULT_SETTINGS: Settings = {
  playerName: 'Duelist',
  nameChosen: false,
  avatar: 'avatar-1',
  sleeve: 'matte-black',
  playmat: 'tournament-black',
  binder: 'padded-black',
  animationSpeed: 1,
  sound: true,
  haptics: true,
  volume: 0.6,
  music: true,
  responsePrompts: 'smart',
  defaultDifficulty: 'normal',
  // Edison (2008 TCG rules): the player going first draws on turn 1.
  skipFirstDraw: false,
  sideDecking: true,
  showLog: true,
  confirmEndTurn: false,
  swipeToPlay: true,
  officialImages: true,
  musicOff: [],
  netServer: '',
};

const KEY = 'edison.settings.v1';
/** One-time switch: Music used to be off and did nothing, so saved profiles get the new default once. */
const MUSIC_ON_KEY = 'edison.settings.musicOn.v1';
/** One-time switch: the first-turn draw used to default to the modern rule; saved profiles get the Edison rule once. */
const EDISON_DRAW_KEY = 'edison.settings.firstDraw.v1';
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
  if (!current) {
    const saved = loadJSON<Partial<Settings>>(KEY, {});
    if (!loadJSON(MUSIC_ON_KEY, false)) {
      delete saved.music;
      saveJSON(MUSIC_ON_KEY, true);
    }
    if (!loadJSON(EDISON_DRAW_KEY, false)) {
      delete saved.skipFirstDraw;
      saveJSON(EDISON_DRAW_KEY, true);
    }
    current = { ...DEFAULT_SETTINGS, ...saved };
  }
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
