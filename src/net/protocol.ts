// "Play a friend" wire protocol: room codes and the messages two phones exchange.
//
// Both phones run the same deterministic Game (same seed, decks and seats: the host is seat 0,
// the guest seat 1). Each phone answers the decisions of its own seat and sends every answer as a
// replay entry (engine/replay.ts Decision) with a per-game sequence number; the other phone feeds
// it to the remote seat after checking the entry's state digest against its own board.
//
// All messages are JSON objects with a `t` field. Every message that carries state is idempotent,
// so after a dropped connection or a reload each side simply re-sends its current state and the
// log entries the other side is missing (see room.ts).
import type { Decision } from '../engine/replay';
import type { PlayerId } from '../engine/types';

/** Bump when the messages or the lockstep rules change incompatibly. */
export const PROTOCOL_VERSION = 1;

/** Room code alphabet without look-alikes (no I, L, O, 0, 1). */
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const DIGITS = '23456789';

/** "KQTM-4825": 4 letters, 4 digits (about 10^9 codes). */
export function newRoomCode(rand: () => number = Math.random): string {
  let a = '';
  let b = '';
  for (let i = 0; i < 4; i++) a += LETTERS[Math.floor(rand() * LETTERS.length)];
  for (let i = 0; i < 4; i++) b += DIGITS[Math.floor(rand() * DIGITS.length)];
  return `${a}-${b}`;
}

/** Normalise typed input ("kqtm 4825", "KQTM4825") to "KQTM-4825"; null when it can't be a code. */
export function normalizeRoomCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (s.length !== 8) return null;
  const a = s.slice(0, 4);
  const b = s.slice(4);
  if (![...a].every((c) => LETTERS.includes(c)) || ![...b].every((c) => DIGITS.includes(c))) return null;
  return `${a}-${b}`;
}

/** The signalling id the host registers for a room. */
export function roomPeerId(code: string): string {
  return `edison-format-v${PROTOCOL_VERSION}-${code.toLowerCase()}`;
}

export interface NetPlayer {
  name: string;
  avatar: string;
  sleeve: string;
  /** Stable per install: tells a reload of the same phone from a different person. */
  clientId: string;
}

/** Card ids. */
export interface WireDeck {
  name: string;
  main: string[];
  extra: string[];
}

export interface LobbyState {
  deckKey: string | null;
  deck: WireDeck | null;
  ready: boolean;
  /** Host only: match length. */
  bestOf?: 1 | 3;
}

/** Everything both phones need to play the match. Seat 0 = host, seat 1 = guest. */
export interface MatchStart {
  id: string;
  /** Game n uses gameSeed(seed, n). */
  seed: number;
  bestOf: 1 | 3;
  skipFirstDraw: boolean;
  players: [NetPlayer, NetPlayer];
  /** Game 1 decks. */
  decks: [WireDeck, WireDeck];
}

export interface GameEnd {
  winner: PlayerId | null;
  reason: string;
  turns: number;
  /** How the game ended outside the engine. */
  kind?: 'concede' | 'claim' | 'desync';
}

export type Msg =
  | { t: 'hello'; proto: number; build: string; sid: string; role: 'host' | 'guest'; player: NetPlayer; match: string | null; game: number | null; have: number }
  | { t: 'lobby'; state: LobbyState }
  | { t: 'start'; match: MatchStart }
  /** Decklist for game `g` (game 1 decks come with start; later games may be sided). */
  | { t: 'deck'; m: string; g: number; deck: WireDeck }
  /** Who goes first in game `g` (the loser of the previous game chooses; 'coin' after a draw). */
  | { t: 'first'; m: string; g: number; first: PlayerId | 'coin' }
  /** One decision of the sender's seat: entry `n` (0-based) of game `g`. */
  | { t: 'd'; m: string; g: number; n: number; e: Decision }
  /** "I have `have` of your entries for game `g`": the receiver re-sends from there. */
  | { t: 'sync'; m: string; g: number; have: number }
  /** The game ended outside the engine (concede, disconnect claim, desync). */
  | { t: 'end'; m: string; g: number; end: GameEnd; detail?: string }
  /** Back to the lobby for a rematch (after the match, or after a desync). */
  | { t: 'rematch'; m: string }
  | { t: 'leave'; reason?: 'left' | 'busy' | 'version' }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number };

/** Seed of game `index` (0-based) of a match. */
export function gameSeed(matchSeed: number, index: number): number {
  let x = (matchSeed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) & 0x7fffffff;
}

export function parseMsg(raw: unknown): Msg | null {
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return m && typeof m === 'object' && typeof (m as Msg).t === 'string' ? (m as Msg) : null;
  } catch {
    return null;
  }
}
