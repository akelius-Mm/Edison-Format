// Which boosters a draft can use, and the event setup (players, packs, matches, AI, Edison Pack
// contents) with its validation. The "Edison Pack" is a 15-card pack built from the Edison pool;
// real boosters are the Edison-legal core sets (released by the April 2010 cut-off) that are
// complete enough to draft. New sets join automatically once their cards are scripted.
import { isEdisonLegalDate, playableSet, playableSets, READY_SHARE } from '../collection/catalog';
import { PACK_FORMATS } from '../collection/packs';
import { edisonPoolFor } from './cards';

/** Plan entry for the simulator's own 15-card pack. */
export const EDISON_PACK = 'EDISON';
export const EDISON_PACK_SIZE = 15;

/** The three core sets on shelves for Edison locals (spring 2010), used by the built-in presets. */
export const SHELF_SETS = ['ABPF', 'SOVR', 'ANPR'] as const;

/** A real set is offered once this share of its printed cards is playable. */
export const DRAFT_READY_SHARE = READY_SHARE;

/** Cards in a real booster: as printed (9) or a 15-card "draft booster" (9 + 6 extra commons). */
export type RealSize = 9 | 15;

export interface PackOption {
  code: string;
  name: string;
  /** Short label ("Edison", "ABPF"). */
  short: string;
  cardsPerPack: number;
  /** Real sets: implemented / printed cards. */
  playable: number;
  printed: number;
  released?: string;
  /** Can be drafted now (complete enough, or forced by the dev override). */
  ready: boolean;
}

/** Every Edison-legal core booster (never The Shining Darkness or later), newest first. */
export function draftSetCodes(): string[] {
  return playableSets()
    .filter((s) => (s.data.format === 'core' || s.data.format === 'core-tshd') && isEdisonLegalDate(s.data.released))
    .sort((a, b) => b.data.released.localeCompare(a.data.released))
    .map((s) => s.code);
}

export function packOption(code: string, devAll = false, realSize: RealSize = 9): PackOption {
  if (code === EDISON_PACK)
    return { code, name: 'Edison Pack', short: 'Edison', cardsPerPack: EDISON_PACK_SIZE, playable: 1, printed: 1, ready: true };
  const s = playableSet(code);
  if (!s || !isEdisonLegalDate(s.data.released)) return { code, name: s?.data.name ?? code, short: code, cardsPerPack: 9, playable: 0, printed: 1, ready: false };
  const playable = s.playable.length;
  const printed = Math.max(1, s.printed);
  const printedSize = PACK_FORMATS[s.data.format].cardsPerPack;
  return {
    code,
    name: s.data.name,
    short: code,
    cardsPerPack: realSize === 15 ? Math.max(15, printedSize) : printedSize,
    playable,
    printed,
    released: s.data.released,
    ready: (devAll && playable > 0) || playable / printed >= DRAFT_READY_SHARE,
  };
}

/** Edison Pack first, then every legal core set, newest first. */
export function packOptions(devAll = false, realSize: RealSize = 9): PackOption[] {
  return [packOption(EDISON_PACK), ...draftSetCodes().map((c) => packOption(c, devAll, realSize))];
}

export const packSize = (code: string, realSize: RealSize = 9) => (code === EDISON_PACK ? EDISON_PACK_SIZE : packOption(code, false, realSize).cardsPerPack);
export const isRealPack = (code: string) => code !== EDISON_PACK;
export const planCards = (plan: string[], realSize: RealSize = 9) => plan.reduce((a, c) => a + packSize(c, realSize), 0);

export type PresetId = 'edison' | 'abpf' | 'core3' | 'y2009' | 'synchro';
export const PRESETS: { id: PresetId; label: string; sets: string[] }[] = [
  { id: 'edison', label: 'Edison Pack', sets: [EDISON_PACK] },
  { id: 'abpf', label: 'All ABPF', sets: ['ABPF'] },
  { id: 'core3', label: 'ABPF · SOVR · ANPR', sets: [...SHELF_SETS] },
  { id: 'y2009', label: '2009 sets', sets: ['CRMS', 'RGBT', 'ANPR'] },
  { id: 'synchro', label: 'Synchro era', sets: ['TDGS', 'CSOC', 'CRMS'] },
];

/** Packs per player a setup may use. */
export const PACK_RANGE = { draft: [2, 8], sealed: [3, 12] } as const;

/** Default packs per player: 9-card boosters need more packs to reach a 40-card deck. */
export function defaultCount(mode: 'draft' | 'sealed', anyReal: boolean, realSize: RealSize = 9): number {
  const small = anyReal && realSize === 9;
  if (mode === 'sealed') return small ? 8 : 6;
  return small ? 5 : 4;
}

/** Spread a list of sets over `count` packs in order (ABPF ×2, SOVR ×2, ANPR …). */
export function spreadPlan(sets: string[], count: number): string[] {
  const out: string[] = [];
  const per = Math.floor(count / sets.length);
  let extra = count - per * sets.length;
  for (const s of sets) {
    const n = per + (extra-- > 0 ? 1 : 0);
    for (let i = 0; i < n; i++) out.push(s);
  }
  return out;
}

export function presetPlan(id: PresetId, count: number): string[] {
  return spreadPlan(PRESETS.find((p) => p.id === id)!.sets, count);
}

export function presetOf(plan: string[]): PresetId | null {
  for (const p of PRESETS) {
    const want = presetPlan(p.id, plan.length);
    if (want.every((c, i) => c === plan[i])) return p.id;
  }
  return null;
}

/** Resize a plan, repeating its last pack when it grows. */
export function resizePlan(plan: string[], count: number): string[] {
  const out = plan.slice(0, count);
  while (out.length < count) out.push(out[out.length - 1] ?? EDISON_PACK);
  return out;
}

/** "Edison Pack", "ABPF ×5", "ABPF · SOVR · ANPR". */
export function planLabel(plan: string[]): string {
  const uniq = [...new Set(plan)];
  if (uniq.length === 1) return uniq[0] === EDISON_PACK ? 'Edison Pack' : `${uniq[0]} ×${plan.length}`;
  return uniq.map((c) => (c === EDISON_PACK ? 'Edison' : c)).join(' · ');
}

// ------------------------------------------------------------------ Edison Pack contents

/** What the Edison Pack draws from: every Edison-legal card, only 2009–2010 sets, or a checklist. */
export type EdisonPoolKind = 'all' | 'recent' | 'custom';
export const RECENT_FROM = '2009-01-01';

export interface EdisonSetChoice {
  code: string;
  name: string;
  released: string;
  playable: number;
}

/** Edison-legal booster products the Edison Pack can be limited to, newest first. */
export function edisonSetChoices(): EdisonSetChoice[] {
  return playableSets()
    .filter((s) => isEdisonLegalDate(s.data.released) && s.playable.length > 0)
    .sort((a, b) => b.data.released.localeCompare(a.data.released))
    .map((s) => ({ code: s.code, name: s.data.name, released: s.data.released, playable: s.playable.length }));
}

/** Set codes the Edison Pack is limited to, or null for the whole Edison pool. */
export function edisonSetsFor(kind: EdisonPoolKind, custom: string[]): string[] | null {
  if (kind === 'all') return null;
  const legal = edisonSetChoices();
  if (kind === 'recent') return legal.filter((s) => s.released >= RECENT_FROM).map((s) => s.code);
  const want = new Set(custom);
  return legal.filter((s) => want.has(s.code)).map((s) => s.code);
}

/** An Edison Pack needs at least this many different cards to stay varied. */
export const MIN_EDISON_POOL = 80;

// ------------------------------------------------------------------ event setup

export type Seats = 4 | 6 | 8;
export type TourneyKind = 'swiss' | 'single';
export type AiLevel = 'easy' | 'normal' | 'hard';
export const SEAT_OPTIONS: Seats[] = [4, 6, 8];
export const SWISS_ROUNDS = 3;

/** Everything a player can tune about a Draft or Sealed event. */
export interface EventSetup {
  mode: 'draft' | 'sealed';
  /** Booster for each pack round. */
  plan: string[];
  seats: Seats;
  bestOf: 1 | 3;
  tourney: TourneyKind;
  ai: AiLevel;
  /** Free basic monsters may top a deck up to 40. */
  fillers: boolean;
  realSize: RealSize;
  edisonPool: EdisonPoolKind;
  /** Checklist for edisonPool = 'custom'. */
  edisonSets: string[];
}

/** Options shared by Draft and Sealed (everything but the mode and plan). */
export type EventOptions = Omit<EventSetup, 'mode' | 'plan'>;

export const DEFAULT_OPTIONS: EventOptions = {
  seats: 8,
  bestOf: 1,
  tourney: 'swiss',
  ai: 'normal',
  fillers: true,
  realSize: 9,
  edisonPool: 'all',
  edisonSets: [],
};

export function defaultPlan(mode: 'draft' | 'sealed') {
  return presetPlan('edison', defaultCount(mode, false));
}

/** Rounds in the event's tournament: 3 Swiss rounds, or enough single-elimination rounds for one champion. */
export function roundsFor(seats: number, tourney: TourneyKind = 'swiss') {
  return tourney === 'single' ? Math.max(1, Math.ceil(Math.log2(seats))) : SWISS_ROUNDS;
}

/** Cards each player must get (picks or sealed pool) so a 40-card Main Deck is possible. */
export const MIN_EVENT_CARDS = { draft: 45, sealed: 54 } as const;
/** Without free filler monsters every Main Deck card has to come from the pool. */
export const MIN_EVENT_CARDS_NO_FILLER = { draft: 60, sealed: 66 } as const;

export const minCardsFor = (mode: 'draft' | 'sealed', fillers: boolean) => (fillers ? MIN_EVENT_CARDS : MIN_EVENT_CARDS_NO_FILLER)[mode];

/** Cards in the Edison Pack pool for a setup. */
export function edisonPoolSize(x: Pick<EventSetup, 'edisonPool' | 'edisonSets'>): number {
  return edisonPoolFor(edisonSetsFor(x.edisonPool, x.edisonSets)).length;
}

export interface SetupCheck {
  ok: boolean;
  /** Picks (Draft) or cards (Sealed) per player. */
  cards: number;
  min: number;
  problems: string[];
  /** "6 players · 5 packs × 9 · 45 picks each" */
  summary: string;
}

/** Can this setup be played, and a one-line description of it. */
export function checkSetup(x: EventSetup, dev = false): SetupCheck {
  const cards = planCards(x.plan, x.realSize);
  const min = minCardsFor(x.mode, x.fillers);
  const n = x.plan.length;
  const sizes = [...new Set(x.plan.map((c) => packSize(c, x.realSize)))].sort((a, b) => a - b);
  const problems: string[] = [];
  const [lo, hi] = PACK_RANGE[x.mode];
  if (n < lo || n > hi) problems.push(`Use ${lo}–${hi} packs per player.`);
  if (cards < min) problems.push(`Needs at least ${min} ${x.mode === 'draft' ? 'picks' : 'cards'} for a 40-card deck${x.fillers ? '' : ' without basic monsters'}. Add a pack.`);
  const notReady = [...new Set(x.plan.filter((c) => !packOption(c, dev).ready))];
  if (notReady.length) problems.push(`${notReady.join(', ')} ${notReady.length === 1 ? 'isn’t' : 'aren’t'} ready yet.`);
  if (x.plan.includes(EDISON_PACK) && x.edisonPool !== 'all') {
    const size = edisonPoolSize(x);
    if (size < MIN_EDISON_POOL) problems.push(`The Edison Pack needs more sets: ${size} cards, at least ${MIN_EDISON_POOL}.`);
  }
  const each = `${n} pack${n === 1 ? '' : 's'} × ${sizes.join('/')}`;
  const summary = x.mode === 'sealed' ? `${each} · ${cards} cards to build from` : `${x.seats} players · ${each} · ${cards} picks`;
  return { ok: !problems.length, cards, min, problems, summary };
}

/** "8 players · Best of 1 · Swiss" style line for the Customize row. */
export function optionsLabel(o: EventOptions): string {
  return [
    `${o.seats} players`,
    o.bestOf === 3 ? 'Best of 3' : 'Best of 1',
    o.tourney === 'single' ? 'Single elimination' : 'Swiss',
    o.ai !== 'normal' ? `${o.ai === 'easy' ? 'Easy' : 'Hard'} AI` : '',
    o.fillers ? '' : 'No fillers',
  ]
    .filter(Boolean)
    .join(' · ');
}

// ------------------------------------------------------------------ quick plan actions

/** Grow `gen(n)` one pack at a time until it hands out enough cards (within the pack range). */
export function fitPlan(gen: (n: number) => string[], n: number, x: Pick<EventSetup, 'mode' | 'realSize' | 'fillers'>): string[] {
  const [lo, hi] = PACK_RANGE[x.mode];
  let k = Math.max(lo, Math.min(hi, n));
  let plan = gen(k);
  while (planCards(plan, x.realSize) < minCardsFor(x.mode, x.fillers) && k < hi) plan = gen(++k);
  return plan;
}

/** Every pack the same as pack 1. */
export const sameForAll = (plan: string[]) => (n: number) => Array.from({ length: n }, () => plan[0] ?? EDISON_PACK);

/** The newest ready sets, one per round (cycling): ABPF, SOVR, ANPR, … */
export const newestFirst = (dev: boolean) => (n: number) => {
  const sets = draftSetCodes().filter((c) => packOption(c, dev).ready);
  const pool = sets.length ? sets : [EDISON_PACK];
  return Array.from({ length: n }, (_, i) => pool[i % pool.length]);
};

/** A random ready booster (or Edison Pack) for every round. */
export const randomMix = (dev: boolean, rnd: () => number = Math.random) => (n: number) => {
  const pool = packOptions(dev).filter((o) => o.ready).map((o) => o.code);
  return Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)]);
};
