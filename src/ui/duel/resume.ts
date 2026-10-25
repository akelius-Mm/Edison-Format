// The duel in progress, saved after every decision so it can be resumed after the app is closed.
//
// iOS often kills home-screen web apps in the background. A duel is deterministic given its seed,
// the decks and the human's decisions (see engine/replay.ts), so the record holds exactly that:
// the match setup (decks as card ids), the finished games of the match, the current game's seed
// and first player, and the decision log. Resuming rebuilds the game and replays the log instantly.
//
// Side decking: each game's actual decklists (both players, after siding) are kept in `played`
// (finished games) and `game.decks` (the game in progress), so a resumed game is rebuilt from the
// exact lists. A match left on the siding screen keeps the swaps made so far in `siding`.
// Records saved before siding have none of these and resume with the original decks.
//
// One slot only: starting a new resumable match replaces whatever was saved before.
import { CARDS } from '../../cards';
import type { DeckIds } from '../../decks/siding';
import type { CardData } from '../../engine/card';
import type { DeckList } from '../../engine/game';
import type { Decision } from '../../engine/replay';
import type { PlayerId } from '../../engine/types';
import type { GameResult } from '../../tournament/types';
import type { DuelSide } from './api';

export const ACTIVE_DUEL_KEY = 'edison.duel.active.v1';

export type ResumeKind = 'vsai' | 'locals' | 'events' | 'draft' | 'tournament' | 'friend';

/** Where a duel belongs: which mode, which match in it, and how to get back there. */
export interface ResumeTag {
  kind: ResumeKind;
  /** Identifies the match inside its mode, e.g. "locals:<night id>:<match id>". */
  key: string;
  /** The mode's route. Opening it with `resume=1` resumes the duel. */
  route: string;
  params?: Record<string, string>;
  /** Mode-specific data the mode needs to finish the match flow afterwards. */
  meta?: Record<string, unknown>;
}

export interface SavedSide {
  name: string;
  avatar: string;
  sleeve: string;
  control: DuelSide['control'];
  title?: string;
  /** Card ids. */
  main: string[];
  extra: string[];
  /** Side Deck card ids (missing in records saved before siding). */
  side?: string[];
}

export interface SavedGame {
  /** 0-based game number within the match. */
  index: number;
  seed: number;
  first: PlayerId | 'coin';
  skipFirstDraw: boolean;
  caption: string;
  /** The human's decisions so far, in order. */
  log: Decision[];
  /** Turn number at the last decision (for the resume card). */
  turn: number;
  /** The decks this game is played with, after siding (missing = the match's original decks). */
  decks?: [DeckIds, DeckIds];
}

/** A finished game's decks, and the cards each player showed (public at the end of the game). */
export interface PlayedGame {
  decks: [DeckIds, DeckIds];
  seen?: [string[], string[]];
}

/** The human is siding for game `index`: the deck as it stands so far. */
export interface SavedSiding {
  index: number;
  player: PlayerId;
  deck: DeckIds;
  /** Siding is finished (the go-first choice is next). */
  done?: boolean;
}

export interface SavedDuel {
  v: 1;
  tag: ResumeTag;
  savedAt: number;
  setup: {
    sides: [SavedSide, SavedSide];
    bestOf: 1 | 3;
    playmat: string;
    caption: string;
    requireWinner?: boolean;
    stats?: { deckKey: string; deckName: string };
    /** Draft / Sealed: siding moves cards freely between deck and pool. */
    limited?: boolean;
  };
  /** Match seed: AI siding derives from it, so a resumed match sides the same way. */
  seed?: number;
  /** Decks (and shown cards) of each finished game, by game index. */
  played?: (PlayedGame | null)[];
  /** Siding in progress between games. */
  siding?: SavedSiding | null;
  /** Finished games of the match. */
  games: GameResult[];
  /** The game in progress; null between games (the next game has not started). */
  game: SavedGame | null;
  /** The duel screen was open when this was saved (the app was closed mid-duel, not left). */
  live?: boolean;
}

export function loadActiveDuel(): SavedDuel | null {
  try {
    const raw = localStorage.getItem(ACTIVE_DUEL_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedDuel;
    if (!d || d.v !== 1 || !d.tag?.key || !Array.isArray(d.setup?.sides) || d.setup.sides.length !== 2 || !Array.isArray(d.games)) return null;
    if (d.game && !Array.isArray(d.game.log)) return null;
    return d;
  } catch {
    return null;
  }
}

/** Save quietly: a full or blocked storage just means this duel cannot be resumed. */
export function saveActiveDuel(d: SavedDuel): boolean {
  try {
    localStorage.setItem(ACTIVE_DUEL_KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function clearActiveDuel() {
  try {
    localStorage.removeItem(ACTIVE_DUEL_KEY);
  } catch {
    /* ignore */
  }
}

/** The saved duel for this match, if any. */
export function activeDuelFor(key: string): SavedDuel | null {
  const d = loadActiveDuel();
  return d && d.tag.key === key ? d : null;
}

/**
 * Drop a saved duel of this mode that no longer belongs to its live match (the round was
 * conceded, auto-played or the event closed). `liveKey` is the key of the match the mode would
 * play now, or null when there is none. Returns the saved duel when it is still valid.
 */
export function reconcileActiveDuel(kind: ResumeKind, liveKey: string | null): SavedDuel | null {
  const d = loadActiveDuel();
  if (!d || d.tag.kind !== kind) return null;
  if (d.tag.key === liveKey) return d;
  clearActiveDuel();
  return null;
}

export function toSavedSide(s: DuelSide): SavedSide {
  return {
    name: s.name,
    avatar: s.avatar,
    sleeve: s.sleeve,
    control: s.control,
    title: s.title,
    main: s.deck.main.map((c) => c.id),
    extra: s.deck.extra.map((c) => c.id),
    ...(s.deck.side?.length ? { side: s.deck.side.map((c) => c.id) } : {}),
  };
}

const look = (ids: string[]) => {
  const out: CardData[] = [];
  for (const id of ids) {
    const c = CARDS[id];
    if (!c) return null;
    out.push(c);
  }
  return out;
};

/** Card lists from ids; null when a card no longer exists. */
export function deckFromIds(d: DeckIds): DeckList | null {
  const main = look(d.main);
  const extra = look(d.extra);
  const side = look(d.side ?? []);
  if (!main || !extra || !side) return null;
  return side.length ? { main, extra, side } : { main, extra };
}

export const deckToIds = (d: DeckList): DeckIds => ({ main: d.main.map((c) => c.id), extra: d.extra.map((c) => c.id), side: (d.side ?? []).map((c) => c.id) });

/** Rebuild a side; null when a card no longer exists. */
export function fromSavedSide(s: SavedSide): DuelSide | null {
  const deck = deckFromIds({ main: s.main, extra: s.extra, side: s.side ?? [] });
  if (!deck) return null;
  return { name: s.name, avatar: s.avatar, sleeve: s.sleeve, control: s.control, title: s.title, deck };
}

/** "vs Rei Mori · Game 2 · Turn 7" */
export function duelSummary(d: SavedDuel): { opponent: string; line: string } {
  const human = d.setup.sides[0].control === 'human' ? 0 : 1;
  const opponent = d.setup.sides[1 - human].name;
  const parts = [`vs ${opponent}`];
  const gameNo = (d.game?.index ?? d.games.length) + 1;
  if (d.setup.bestOf === 3 || gameNo > 1) parts.push(`Game ${gameNo}`);
  if (d.game && d.game.turn > 0) parts.push(`Turn ${d.game.turn}`);
  else if (!d.game && d.siding) parts.push('Siding');
  else if (!d.game && d.games.length) parts.push('Next game');
  return { opponent, line: parts.join(' · ') };
}

export const MODE_LABEL: Record<ResumeKind, string> = {
  vsai: 'Duel vs AI',
  locals: 'Locals Night',
  events: 'Event',
  draft: 'Draft',
  tournament: 'Tournament',
  friend: 'Play a friend',
};
