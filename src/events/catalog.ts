// The 2010 Organized Play ladder: Locals → Regional Qualifier → Shonen Jump Championship →
// Nationals. Field sizes, Swiss rounds, top cuts, venues, prize support and circuit points.
import { SHOPS, swissRoundsFor as localsSwiss, topCutFor as localsCut } from '../locals/shops';
import { hash } from '../locals/rng';
import type { Shop } from '../locals/types';

export type EventKind = 'locals' | 'regional' | 'sjc' | 'nationals';
export const EVENT_KINDS: EventKind[] = ['locals', 'regional', 'sjc', 'nationals'];

export interface Venue extends Shop {
  /** Real city name, e.g. "Edison, NJ". Empty for a local card shop. */
  city: string;
}

export interface EventSpec {
  kind: EventKind;
  label: string;
  short: string;
  /** One-line pitch for the hub. */
  pitch: string;
  /** Field sizes the player can pick at check-in (first = smallest). */
  sizes: number[];
  defaultSize: number;
  /** Rough range for copy, e.g. "64–128". */
  sizeRange: string;
  roundMinutes: number;
  /** 0 = local, 4 = the world stage. Drives deck quality, AI skill and difficulty. */
  tier: number;
  /** Invite needed to enter during a season. */
  inviteOnly?: boolean;
  icon: 'clipboard' | 'flag' | 'bolt' | 'medal' | 'crown';
  /** Card art for the hub row. */
  art: string;
}

export const EVENT_SPECS: Record<EventKind, EventSpec> = {
  locals: {
    kind: 'locals',
    label: 'Locals',
    short: 'Locals',
    pitch: 'Friday night at the card shop',
    sizes: [16, 24, 32],
    defaultSize: 24,
    sizeRange: '16–32',
    roundMinutes: 45,
    tier: 0,
    icon: 'clipboard',
    art: 'Black Rose Dragon',
  },
  regional: {
    kind: 'regional',
    label: 'Regional Qualifier',
    short: 'Regional',
    pitch: 'A Saturday in a convention hall, Nationals invites on the line',
    sizes: [64, 96, 128],
    defaultSize: 96,
    sizeRange: '64–128',
    roundMinutes: 50,
    tier: 1,
    icon: 'flag',
    art: 'Black-Winged Dragon',
  },
  sjc: {
    kind: 'sjc',
    label: 'Shonen Jump Championship',
    short: 'SJC',
    pitch: 'The big open: hundreds of duelists, two days, one trophy',
    sizes: [224, 384, 512],
    defaultSize: 384,
    sizeRange: '200–512',
    roundMinutes: 50,
    tier: 2,
    icon: 'bolt',
    art: 'Judgment Dragon',
  },
  nationals: {
    kind: 'nationals',
    label: 'National Championship',
    short: 'Nationals',
    pitch: 'Invite-only: the best of the country, one National Champion',
    sizes: [128],
    defaultSize: 128,
    sizeRange: '128',
    roundMinutes: 50,
    tier: 3,
    inviteOnly: true,
    icon: 'medal',
    art: 'Stardust Dragon',
  },
};

/** Swiss rounds for a field: Konami's 2010 table for locals, longer days at the big events. */
export function swissRoundsFor(kind: EventKind, size: number) {
  switch (kind) {
    case 'locals':
      return localsSwiss(size);
    case 'regional':
      return size <= 96 ? 7 : 8;
    case 'sjc':
      return size <= 300 ? 9 : 10;
    case 'nationals':
      return 8;
  }
}

export function topCutFor(kind: EventKind, size: number): number {
  switch (kind) {
    case 'locals':
      return localsCut(size);
    case 'regional':
      return 16;
    case 'sjc':
      return size <= 256 ? 32 : 64;
    case 'nationals':
      return 32;
  }
}

/** Regional Top 8 (fields under 100) or Top 16 earns a Nationals invite. */
export function regionalInviteCut(size: number) {
  return size < 100 ? 8 : 16;
}
/** SJC finishes that also earn a Nationals invite. */
export const SJC_INVITE_CUT = 32;
/** Circuit standings at-large invites: the Top 16 when Nationals registration closes. */
export const CIRCUIT_INVITE_RANK = 16;

export function formatLine(kind: EventKind, size: number) {
  return `${swissRoundsFor(kind, size)} Swiss rounds · Top ${topCutFor(kind, size)}`;
}

// ------------------------------------------------------------------ venues

const REGIONAL_VENUES: Venue[] = [
  { id: 'reg-columbus', city: 'Columbus, OH', name: 'Regional Qualifier · Columbus, OH', where: 'Convention center · Hall C', blurb: 'Two hundred chairs, one PA system, and a line for registration out the door by 9 a.m.' },
  { id: 'reg-dallas', city: 'Dallas, TX', name: 'Regional Qualifier · Dallas, TX', where: 'Hotel ballroom · North wing', blurb: 'Carpeted ballroom, long folding tables and a judge station by the coffee urns.' },
  { id: 'reg-sacramento', city: 'Sacramento, CA', name: 'Regional Qualifier · Sacramento, CA', where: 'Expo hall · Building B', blurb: 'Vendors along the back wall, side events all afternoon, the Top 16 under the big lights.' },
  { id: 'reg-atlanta', city: 'Atlanta, GA', name: 'Regional Qualifier · Atlanta, GA', where: 'Trade mart · Level 2', blurb: 'Hot outside, freezing inside. Pairings go up on three boards at once.' },
  { id: 'reg-newark', city: 'Newark, NJ', name: 'Regional Qualifier · Newark, NJ', where: 'Community center · Main hall', blurb: 'The northeast crowd shows up early and trades until the head judge calls seating.' },
  { id: 'reg-chicago', city: 'Chicago, IL', name: 'Regional Qualifier · Chicago, IL', where: 'Convention hall · Room 4', blurb: 'Seven rounds, a Top 16, and the train home after midnight.' },
];

const SJC_VENUES: Venue[] = [
  { id: 'sjc-edison', city: 'Edison, NJ', name: 'SJC Edison, NJ', where: 'Expo center · Two days', blurb: 'The event the format is named after. Feature tables on a stage, coverage writers at every round.' },
  { id: 'sjc-dallas', city: 'Dallas, TX', name: 'SJC Dallas, TX', where: 'Convention center · Two days', blurb: 'Day one is a marathon of Swiss. Day two is single elimination under the lights.' },
  { id: 'sjc-indianapolis', city: 'Indianapolis, IN', name: 'SJC Indianapolis, IN', where: 'Convention center · Two days', blurb: 'Hundreds of duelists, a ballroom of side events, and Championship packs for the cut.' },
];

const NATIONALS_VENUE: Venue = {
  id: 'nats',
  city: 'Indianapolis, IN',
  name: 'National Championship · Indianapolis, IN',
  where: 'Convention center · Invitation only',
  blurb: 'Regional qualifiers, SJC finishers and the circuit leaders. The season ends here: one National Champion.',
};

/** Pick a venue for an event (stable per key). */
export function venueFor(kind: EventKind, key: string): Venue {
  const k = hash(`${kind}-${key}`);
  switch (kind) {
    case 'locals': {
      const s = SHOPS[k % SHOPS.length];
      return { ...s, city: '' };
    }
    case 'regional':
      return REGIONAL_VENUES[k % REGIONAL_VENUES.length];
    case 'sjc':
      return SJC_VENUES[k % SJC_VENUES.length];
    case 'nationals':
      return NATIONALS_VENUE;
  }
}

export const venueList = (kind: EventKind) => (kind === 'regional' ? REGIONAL_VENUES : kind === 'sjc' ? SJC_VENUES : []);

// ------------------------------------------------------------------ dates

const DAY = 86400000;
/** Week 1 of a season starts Friday, March 19, 2010; the SJC (week 5) lands on April 17. */
export const SEASON_START = Date.UTC(2010, 2, 19);

/** Event day within a week: Friday for Locals, Saturday for everything else. */
export function eventDate(kind: EventKind, week: number) {
  const d = new Date(SEASON_START + (week - 1) * 7 * DAY + (kind === 'locals' ? 0 : DAY));
  const iso = d.toISOString().slice(0, 10);
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return { iso, label };
}

/** Stand-alone events borrow a date from the Edison window by a running number. */
export function standaloneDate(kind: EventKind, number: number) {
  return eventDate(kind, 1 + ((number - 1) % 24));
}

// ------------------------------------------------------------------ prizes and circuit points

export interface PlaceBand {
  /** Placing bracket, e.g. 1, 2, 4, 8, 16 (top cut bands) — the best this many. */
  upTo: number;
  label: string;
  points: number;
  packs: number;
  coins: number;
}

export interface PrizeTable {
  /** Bands within the top cut, best first. */
  cut: PlaceBand[];
  /** Missed the cut with this many losses or fewer. */
  xLosses: number;
  x: Omit<PlaceBand, 'upTo'>;
  participation: Omit<PlaceBand, 'upTo'>;
}

const band = (upTo: number, label: string, points: number, packs: number, coins: number): PlaceBand => ({ upTo, label, points, packs, coins });

export const PRIZES: Record<EventKind, PrizeTable> = {
  locals: {
    cut: [band(1, '1st place', 8, 12, 300), band(2, '2nd place', 6, 8, 200), band(4, 'Top 4', 4, 6, 150), band(8, 'Top 8', 3, 3, 100)],
    xLosses: 1,
    x: { label: 'X-1 finish', points: 2, packs: 2, coins: 75 },
    participation: { label: 'Participation', points: 1, packs: 0, coins: 50 },
  },
  regional: {
    cut: [band(1, '1st place', 40, 24, 800), band(2, '2nd place', 32, 18, 600), band(4, 'Top 4', 25, 12, 450), band(8, 'Top 8', 18, 8, 300), band(16, 'Top 16', 12, 5, 200)],
    xLosses: 2,
    x: { label: 'X-2 finish', points: 6, packs: 2, coins: 100 },
    participation: { label: 'Participation', points: 2, packs: 0, coins: 75 },
  },
  sjc: {
    cut: [
      band(1, 'Champion', 100, 36, 1500),
      band(2, 'Finalist', 80, 28, 1100),
      band(4, 'Top 4', 64, 20, 800),
      band(8, 'Top 8', 48, 14, 600),
      band(16, 'Top 16', 36, 10, 400),
      band(32, 'Top 32', 26, 6, 300),
      band(64, 'Top 64', 18, 4, 200),
    ],
    xLosses: 2,
    x: { label: 'X-2 finish', points: 10, packs: 2, coins: 120 },
    participation: { label: 'Participation', points: 4, packs: 0, coins: 100 },
  },
  nationals: {
    cut: [
      band(1, 'National Champion', 160, 48, 2500),
      band(2, 'Finalist', 128, 36, 1800),
      band(4, 'Top 4', 100, 24, 1200),
      band(8, 'Top 8', 76, 16, 900),
      band(16, 'Top 16', 56, 10, 600),
      band(32, 'Top 32', 40, 6, 400),
    ],
    xLosses: 2,
    x: { label: 'X-2 finish', points: 20, packs: 3, coins: 250 },
    participation: { label: 'Participation', points: 12, packs: 2, coins: 200 },
  },
};

/**
 * The prize band for a finish. `losses` is the Swiss loss count when known (the player, or any
 * entrant of an event that was played out); simulated finishes pass undefined and the X band
 * goes to the next eighth of the field below the cut.
 */
export function bandFor(kind: EventKind, place: number, size: number, topCut: number, opts: { madeCut?: boolean; losses?: number; dropped?: boolean } = {}) {
  const t = PRIZES[kind];
  const cut = opts.madeCut ?? place <= topCut;
  if (cut) {
    const b = t.cut.find((x) => place <= x.upTo && x.upTo <= topCut) ?? t.cut[t.cut.length - 1];
    return { ...b, cut: true };
  }
  const xOk = opts.dropped ? false : opts.losses != null ? opts.losses <= t.xLosses : place <= topCut + Math.max(2, Math.round(size / 8));
  if (xOk) return { ...t.x, upTo: place, cut: false };
  return { ...t.participation, upTo: place, cut: false };
}

/** Readable placing for a band: "Top 16", "1st", "X-2", or "37th". */
export function placingLabel(kind: EventKind, place: number, size: number, topCut: number, opts: { madeCut?: boolean; losses?: number; dropped?: boolean } = {}) {
  const b = bandFor(kind, place, size, topCut, opts);
  return b.label;
}
