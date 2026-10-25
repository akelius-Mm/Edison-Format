// Locals Night: a Friday-night Edison tournament at a (fictional) card shop, spring 2010.
// Built on the tournament engine's shapes (Entrant, Match, GameResult) so the existing match
// flow and simulators plug straight in.
import type { Entrant, Match } from '../tournament/types';

export type { DeckSnapshot, Entrant, GameResult, Match } from '../tournament/types';

/** Archetype buckets of the Edison metagame (see meta.ts). */
export type MetaKey = 'plants' | 'blackwings' | 'lightsworn' | 'monarchs' | 'gladiators' | 'zombies' | 'xsabers' | 'teledad' | 'herobeat' | 'gadgets' | 'samurai' | 'rogue';

export type FieldSize = 16 | 24 | 32;

export interface Shop {
  id: string;
  name: string;
  /** One line of flavour, e.g. "Back room behind the comics, six folding tables". */
  blurb: string;
  /** Short street-style location line. */
  where: string;
}

export interface LocalsEntrant extends Entrant {
  meta: MetaKey;
  /** Set for recurring characters (see regulars.ts). */
  regular?: string;
  /** One-line flavour for regulars. */
  blurb?: string;
  /** Swiss round after which the player dropped (undefined = still in). */
  dropped?: number;
}

export interface LocalsMatch extends Match {
  /** Intentional draw (both players agreed to draw before playing). */
  intentional?: boolean;
  /** Time was called with the match unfinished. */
  time?: boolean;
}

export type LocalsPhase = 'swiss' | 'top' | 'done';
/** Where the current round is: pairings posted, results in, standings posted. */
export type RoundStep = 'pairings' | 'results' | 'standings';

export interface PrizeLine {
  /** Shown to the player and passed to grantPrize, e.g. "Locals Night · 1st place". */
  reason: string;
  packs: number;
  coins: number;
}

export interface LocalsNight {
  version: 1;
  id: string;
  /** Running night number (1 = your first Locals Night). */
  number: number;
  shop: Shop;
  /** ISO date, e.g. "2010-04-23". */
  date: string;
  /** "Friday, April 23, 2010" */
  dateLabel: string;
  size: FieldSize;
  /** Entry fee in DP (0 = free). */
  entryFee: number;
  bestOf: 3;
  entrants: LocalsEntrant[];
  humanId: string;
  swissRounds: number;
  topCut: 4 | 8;
  rounds: LocalsMatch[][];
  top: LocalsMatch[][];
  phase: LocalsPhase;
  step: RoundStep;
  /** When the current round's pairings went up (drives the round timer). */
  roundStartedAt: number;
  /** Round length in minutes. */
  roundMinutes: number;
  /** Match ids whose opponent deck the player has seen (the sit-down reveal). */
  revealed: string[];
  /** Match id for which the player declined an intentional draw. */
  idDeclined?: string;
  /** Mulberry32 state; every random decision draws from it so a night replays identically. */
  rng: number;
  placements?: string[];
  prizes?: PrizeLine[];
  prizesGranted?: boolean;
  recorded?: boolean;
}

export interface LocalsStanding {
  id: string;
  rank: number;
  /** Match points: 3 per win (byes included), 1 per draw. */
  mp: number;
  w: number;
  l: number;
  d: number;
  byes: number;
  /** Games won/lost across played matches (byes and intentional draws add none). */
  gw: number;
  gl: number;
  /** Match win %: points / (3 × rounds played). */
  mwp: number;
  /** Opponents' match win % (Konami tiebreaker 1). */
  omw: number;
  /** Opponents' opponents' match win % (Konami tiebreaker 2). */
  oomw: number;
  opponents: string[];
  dropped: boolean;
}

export interface HistoryEntry {
  id: string;
  number: number;
  shop: string;
  date: string;
  dateLabel: string;
  size: number;
  deckName: string;
  deckArchetype: string;
  place: number;
  /** Swiss record, e.g. "4-1" or "3-1-1". */
  record: string;
  topCut: number;
  madeCut: boolean;
  champion: { name: string; deck: string };
  packs: number;
  coins: number;
  finishedAt: number;
}

export interface RivalRecord {
  w: number;
  l: number;
  d: number;
}
