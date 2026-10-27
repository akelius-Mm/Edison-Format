// "Friends Locals" wire protocol: a private Swiss tournament for 3–8 friends, each on their own
// phone, built on the "Play a friend" network layer.
//
// Star topology: the organiser's phone registers the tournament id (tourneyPeerId) and every
// player's phone dials it (src/net/hub.ts on the organiser, a NetSession guest on each player).
// The organiser computes pairings and standings and broadcasts a per-player view (`tview`). Each
// pairing plays its match directly between the two phones in a match room derived from the
// tournament code, round and table (matchRoomCode), with the normal room/lockstep protocol
// (room.ts). When a match ends both players send their result and the decision logs (`trg`, one
// message per game) and the organiser verifies it by replaying the logs headlessly (verify.ts).
//
// Spectators dial one of the two players of a match (spectatePeerId) and receive the decision
// stream read-only (`ws` / `wg` / `wd`, see spectate.ts).
//
// Every message is idempotent and re-sent on reconnect: the player re-sends its registration, its
// unacknowledged reports and its draw offers; the organiser re-sends the current view.
//
// Names: the organiser makes every name unique in the event ("Alex", "Alex 2"). A player renames
// itself with `tname`; the organiser can rename anyone (TourneyHost.rename).
//
// Added after TOURNEY_PROTO 1 shipped, without a bump: `tname` and the optional `tj.build` field.
// They are additive, and phones on different builds never talk anyway (the hello compares
// builds), so the tournament id (tourneyPeerId) stays the same.
import type { Decision } from '../engine/replay';
import type { PlayerId } from '../engine/types';
import type { GameResult } from '../tournament/types';
import { NAME_MAX, PROTOCOL_VERSION, type GameEnd, type MatchStart, type NetPlayer, type WireDeck } from './protocol';

/** Bump when the tournament messages change incompatibly. */
export const TOURNEY_PROTO = 1;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

export { NAME_MAX, cleanName } from './protocol';

/** `name`, or `name 2`, `name 3`… so that it differs from every name in `taken` (case-insensitive). */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((x) => x.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const tail = ` ${n}`;
    const x = `${Array.from(name).slice(0, NAME_MAX - tail.length).join('').trim()}${tail}`;
    if (!used.has(x.toLowerCase())) return x;
  }
}

/** The signalling id the organiser registers for a tournament code. */
export function tourneyPeerId(code: string): string {
  return `edison-format-v${PROTOCOL_VERSION}-t${TOURNEY_PROTO}-${code.toLowerCase()}`;
}

/** Room code of a match: derived from the tournament code, stage, round, table and replay attempt. */
export function matchRoomCode(code: string, m: { stage: 'swiss' | 'top'; round: number; table: number; attempt?: number }): string {
  return `${code}-${m.stage === 'swiss' ? 's' : 't'}${m.round}t${m.table}${m.attempt ? `r${m.attempt}` : ''}`;
}

/** Where a player of a match accepts spectators (`seat` 0 hosts the match room, 1 joins it). */
export function spectatePeerId(roomCode: string, seat: PlayerId): string {
  return `edison-format-v${PROTOCOL_VERSION}-w-${roomCode.toLowerCase()}-${seat}`;
}

export interface TSettings {
  bestOf: 1 | 3;
  /** Swiss rounds; null = from the player count (like the Locals table). */
  rounds: number | null;
  /** Single-elimination cut after Swiss (0 = none). */
  topCut: 0 | 4 | 8;
  /** Optional round timer in minutes (0 = off). */
  timerMin: number;
  /** Keep deck names hidden from the other players until the event ends. */
  hideDecks: boolean;
  /** Pair the next round by itself once every result is in. */
  autoPair: boolean;
  skipFirstDraw: boolean;
}

export const DEFAULT_SETTINGS: TSettings = { bestOf: 1, rounds: null, topCut: 0, timerMin: 0, hideDecks: false, autoPair: false, skipFirstDraw: true };

export type TPhase = 'lobby' | 'swiss' | 'top' | 'done';

/** A player as everyone sees them. */
export interface TPlayerView {
  id: string;
  name: string;
  avatar: string;
  sleeve: string;
  /** Null when hidden (host option) or not registered yet. */
  deckName: string | null;
  /** A legal deck is registered. */
  hasDeck: boolean;
  /** Why the registered deck was refused (shown to its owner). */
  deckProblem?: string;
  ready: boolean;
  /** Random tiebreak of last resort. */
  seed: number;
  /** Round after which the player dropped. */
  dropped?: number;
  organiser?: boolean;
  /** Connected to the organiser right now. */
  online?: boolean;
}

export type MatchHow = 'verified' | 'confirmed' | 'concede' | 'drop' | 'id' | 'organiser' | 'time' | 'bye';

export interface TMatch {
  id: string;
  stage: 'swiss' | 'top';
  round: number;
  table: number;
  a: string;
  /** null = bye. */
  b: string | null;
  label: string;
  /** Game winners in a/b orientation (0 = a, the match room host). */
  games: GameResult[];
  result: 'a' | 'b' | 'draw' | null;
  intentional?: boolean;
  time?: boolean;
  /** Match seed (game n uses gameSeed(seed, n)). */
  seed: number;
  /** Bumped when the organiser has a match replayed: a fresh room, reports reset. */
  attempt: number;
  /** How the result was settled. */
  how?: MatchHow;
  /** Players whose report for this attempt reached the organiser. */
  reported: string[];
  /** The organiser must decide: reports disagree, or a report did not verify. */
  dispute?: { reason: string; detail?: string } | null;
  /** Players who offered an intentional draw. */
  idOffers?: string[];
}

/** Everything a player's phone is told about the event (the organiser keeps decks and logs). */
export interface TView {
  v: 1;
  tid: string;
  code: string;
  /** Increases with every change: the newest view wins. */
  rev: number;
  organiser: string;
  createdAt: number;
  settings: TSettings;
  phase: TPhase;
  players: TPlayerView[];
  rounds: TMatch[][];
  top: TMatch[][];
  swissRounds: number;
  topCut: 0 | 2 | 4 | 8;
  roundStartedAt: number;
  /** Final order once the event is done (index 0 = champion). */
  placements?: string[];
}

/** One game of a match as a player's phone saw it: enough to replay it headlessly. */
export interface ReportGame {
  index: number;
  seed: number;
  first: PlayerId | 'coin';
  /** The decks this game was played with (after siding), seat 0 = a. */
  decks: [WireDeck, WireDeck];
  /** Decisions by seat. */
  logs: [Decision[], Decision[]];
  end: GameEnd;
}

export interface Report {
  mid: string;
  attempt: number;
  skipFirstDraw: boolean;
  games: ReportGame[];
}

export type TourneyMsg =
  /** Player → organiser on every (re)connect and on every lobby change: who I am, my deck, ready. */
  | { t: 'tj'; tp: number; tid: string; player: NetPlayer; deck: WireDeck | null; ready: boolean; build?: string }
  /** Organiser → player: the current state of the event. */
  | { t: 'tview'; tid: string; view: TView }
  /** Player → organiser: game `g.index` of the report for match `mid` (one message per game). */
  | { t: 'trg'; tid: string; mid: string; attempt: number; n: number; skipFirstDraw: boolean; g: ReportGame }
  /** Player → organiser: leave the lobby (before the start) or drop from the event. */
  | { t: 'tdrop'; tid: string }
  /** Player → organiser: offer (or withdraw) an intentional draw. */
  | { t: 'tido'; tid: string; mid: string; on: boolean }
  /** Organiser → player: you cannot join this event. */
  | { t: 'tref'; tid: string; reason: 'started' | 'full' | 'version' | 'closed' }
  /** Player → organiser: call me this from now on (the organiser makes it unique and broadcasts the view). */
  | { t: 'tname'; tid: string; name: string }
  // ---- spectating (spectate.ts): player → spectator
  | { t: 'ws'; start: MatchStart }
  | { t: 'wg'; g: number; seed: number; first: PlayerId | 'coin' | null; decks: [WireDeck | null, WireDeck | null]; end: GameEnd | null }
  | { t: 'wd'; g: number; s: PlayerId; n: number; e: Decision }
  /** Spectator → player: how many entries it holds per game and seat (the player sends the rest). */
  | { t: 'wh'; have: [number, number][] };
