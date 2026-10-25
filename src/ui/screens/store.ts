// Persistent app data: custom decks, lifetime stats and tournament history.
import { PREMADE_DECKS, buildDeckList, validateDeck, type DeckDef } from '../../decks';
import { findCard } from '../../cards';
import type { DeckList } from '../../engine/game';
import { loadJSON, saveJSON } from '../settings';

export type Entry = [string, number];

export interface SavedDeck {
  id: string;
  name: string;
  main: Entry[];
  extra: Entry[];
  side: Entry[];
  created: number;
  updated: number;
  /** Premade deck this one was copied from. */
  basedOn?: string;
  /** Draft and Sealed decks are built from opened packs: copy limits and the banlist don't apply. */
  format?: 'draft';
}

/** Deck legality problems, with copy limits waived for Draft and Sealed decks. */
export const deckProblems = (d: SavedDeck) => validateDeck(d, { ignoreLimits: d.format === 'draft' });

/** A deck chosen somewhere in the UI: premade or custom. */
export interface DeckRef {
  kind: 'premade' | 'custom';
  id: string;
}

/** Normalised deck info for menus. */
export interface DeckInfo {
  ref: DeckRef;
  key: string;
  name: string;
  archetype: string;
  description: string;
  tier: 1 | 2 | 3;
  color: string;
  main: Entry[];
  extra: Entry[];
  side: Entry[];
  problems: string[];
}

const DECKS_KEY = 'edison.decks.v1';
const PROFILE_KEY = 'edison.profile.v1';

// ------------------------------------------------------------------ custom decks
export function listCustomDecks(): SavedDeck[] {
  const d = loadJSON<SavedDeck[]>(DECKS_KEY, []);
  return Array.isArray(d) ? d.filter((x) => x && x.id && Array.isArray(x.main)) : [];
}

function writeDecks(d: SavedDeck[]) {
  saveJSON(DECKS_KEY, d);
}

export function getCustomDeck(id: string) {
  return listCustomDecks().find((d) => d.id === id);
}

export function saveCustomDeck(deck: SavedDeck) {
  const all = listCustomDecks();
  const i = all.findIndex((d) => d.id === deck.id);
  deck.updated = Date.now();
  if (i >= 0) all[i] = deck;
  else all.push(deck);
  writeDecks(all);
}

export function deleteCustomDeck(id: string) {
  writeDecks(listCustomDecks().filter((d) => d.id !== id));
}

export function newDeckId() {
  return 'deck-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function uniqueDeckName(base: string) {
  const names = new Set(listCustomDecks().map((d) => d.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`;
}

export function copyOfPremade(def: DeckDef): SavedDeck {
  return {
    id: newDeckId(),
    name: uniqueDeckName(def.name),
    main: def.main.map(([n, c]) => [n, c] as Entry),
    extra: def.extra.map(([n, c]) => [n, c] as Entry),
    side: (def.side ?? []).map(([n, c]) => [n, c] as Entry),
    created: Date.now(),
    updated: Date.now(),
    basedOn: def.id,
  };
}

// ------------------------------------------------------------------ deck refs
export const refKey = (r: DeckRef) => `${r.kind}:${r.id}`;
export function parseRefKey(k: string): DeckRef | null {
  const i = k.indexOf(':');
  if (i < 0) return null;
  const kind = k.slice(0, i);
  if (kind !== 'premade' && kind !== 'custom') return null;
  return { kind, id: k.slice(i + 1) };
}

export function premadeInfo(d: DeckDef): DeckInfo {
  return {
    ref: { kind: 'premade', id: d.id },
    key: `premade:${d.id}`,
    name: d.name,
    archetype: d.archetype,
    description: d.description,
    tier: d.tier,
    color: d.color,
    main: d.main,
    extra: d.extra,
    side: d.side ?? [],
    problems: validateDeck(d),
  };
}

export function customInfo(d: SavedDeck): DeckInfo {
  const base = d.basedOn ? PREMADE_DECKS.find((p) => p.id === d.basedOn) : undefined;
  return {
    ref: { kind: 'custom', id: d.id },
    key: `custom:${d.id}`,
    name: d.name,
    archetype: base ? `${base.archetype} (custom)` : 'Custom deck',
    description: base ? `Based on ${base.name}.` : 'Your own creation.',
    tier: 2,
    color: base?.color ?? deckColorFromName(d.name),
    main: d.main,
    extra: d.extra,
    side: d.side,
    problems: deckProblems(d),
  };
}

export function deckColorFromName(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

export function resolveDeck(ref: DeckRef): DeckInfo | null {
  if (ref.kind === 'premade') {
    const d = PREMADE_DECKS.find((x) => x.id === ref.id);
    return d ? premadeInfo(d) : null;
  }
  const c = getCustomDeck(ref.id);
  return c ? customInfo(c) : null;
}

export function allDeckInfos(): DeckInfo[] {
  return [...listCustomDecks().map(customInfo), ...PREMADE_DECKS.map(premadeInfo)];
}

/**
 * Card lists for a duel, with the Side Deck for siding between games. Deck snapshots saved before
 * Side Decks existed have no `side`: it is looked up from the deck they were taken from (by id).
 */
export function toDeckList(d: Pick<DeckInfo, 'main' | 'extra'> & { side?: Entry[]; id?: string; key?: string }): DeckList {
  const side = d.side ?? sideFor(d.id ?? d.key);
  const { main, extra, side: sideCards } = buildDeckList({ main: d.main, extra: d.extra, side });
  return sideCards?.length ? { main, extra, side: sideCards } : { main, extra };
}

/** The Side Deck of a premade ("id" or "premade:id") or custom ("custom:id") deck. */
export function sideFor(id: string | undefined): Entry[] {
  if (!id) return [];
  const ref = parseRefKey(id);
  if (ref?.kind === 'custom') return getCustomDeck(ref.id)?.side ?? [];
  const pid = ref?.kind === 'premade' ? ref.id : id;
  return PREMADE_DECKS.find((p) => p.id === pid)?.side ?? [];
}

export function deckCount(entries: Entry[]) {
  return entries.reduce((a, [, n]) => a + n, 0);
}

/** The card shown on a deck box: the deck's most-played archetype monster. */
export function coverCard(d: Pick<DeckInfo, 'main' | 'extra'>) {
  let best: ReturnType<typeof findCard>;
  let bestScore = -Infinity;
  for (const [n, k] of d.main) {
    const c = findCard(n);
    if (!c) continue;
    let score = k * 10 + (c.level ?? 0) + (c.sets?.length ? 15 : 0);
    if (c.kind !== 'monster') score -= 60;
    if ((c.limit ?? 3) < 3) score -= 25;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ?? (d.extra[0] ? findCard(d.extra[0][0]) : undefined);
}

// ------------------------------------------------------------------ text import/export
export function exportDeckText(d: { name?: string; main: Entry[]; extra: Entry[]; side?: Entry[] }) {
  const sec = (title: string, e: Entry[]) => [`#${title}`, ...e.map(([n, c]) => `${c} ${n}`)];
  return [...(d.name ? [`// ${d.name}`] : []), ...sec('main', d.main), ...sec('extra', d.extra), ...sec('side', d.side ?? [])].join('\n');
}

export interface ParsedDeck {
  main: Entry[];
  extra: Entry[];
  side: Entry[];
  unknown: string[];
  name?: string;
}

export function parseDeckText(text: string): ParsedDeck {
  const out: ParsedDeck = { main: [], extra: [], side: [], unknown: [] };
  let section: 'main' | 'extra' | 'side' | null = null;
  const add = (list: Entry[], name: string, n: number) => {
    const e = list.find(([x]) => x === name);
    if (e) e[1] += n;
    else list.push([name, n]);
  };
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//')) {
      if (!out.name) out.name = line.slice(2).trim() || undefined;
      continue;
    }
    const sec = line.toLowerCase().replace(/[#!:\s]/g, '').replace(/deck$/, '');
    if (/^[#!]/.test(line) || /^(main|extra|side)(deck)?:?$/i.test(line)) {
      if (sec.startsWith('main')) section = 'main';
      else if (sec.startsWith('extra')) section = 'extra';
      else if (sec.startsWith('side')) section = 'side';
      continue;
    }
    let n = 1;
    const m = /^(\d+)\s*[xX]?\s+(.+)$/.exec(line) ?? /^(.+?)\s+[xX]\s*(\d+)$/.exec(line);
    if (m) {
      if (/^\d+$/.test(m[1])) {
        n = Number(m[1]);
        line = m[2];
      } else {
        line = m[1];
        n = Number(m[2]);
      }
    }
    const card = findCard(line.trim());
    if (!card) {
      out.unknown.push(line.trim());
      continue;
    }
    n = Math.max(1, Math.min(n, 3));
    const isExtra = !!(card.mtypes?.includes('synchro') || card.mtypes?.includes('fusion'));
    // Extra Deck monsters always go to the Extra Deck (unless sided); main-deck cards listed
    // under #extra are moved back to the Main Deck.
    const target = section === 'side' ? out.side : isExtra ? out.extra : out.main;
    add(target, card.name, n);
  }
  return out;
}

// ------------------------------------------------------------------ profile & stats
export interface Record3 {
  w: number;
  l: number;
  d: number;
}
export interface DeckStat extends Record3 {
  name: string;
}
export interface TournamentHistoryEntry {
  id: string;
  name: string;
  date: number;
  size: number;
  place: number;
  record: string;
  deckName: string;
  champion: string;
}
export interface RecentMatch {
  date: number;
  deckName: string;
  oppName: string;
  oppDeck: string;
  result: 'W' | 'L' | 'D';
  score: string;
  context: string;
}
export interface Profile {
  games: Record3;
  matches: Record3;
  decks: Record<string, DeckStat>;
  tournaments: TournamentHistoryEntry[];
  recent: RecentMatch[];
}

const EMPTY_PROFILE = (): Profile => ({ games: { w: 0, l: 0, d: 0 }, matches: { w: 0, l: 0, d: 0 }, decks: {}, tournaments: [], recent: [] });

export function getProfile(): Profile {
  const p = loadJSON<Partial<Profile>>(PROFILE_KEY, {});
  const e = EMPTY_PROFILE();
  return {
    games: { ...e.games, ...(p.games ?? {}) },
    matches: { ...e.matches, ...(p.matches ?? {}) },
    decks: p.decks ?? {},
    tournaments: Array.isArray(p.tournaments) ? p.tournaments : [],
    recent: Array.isArray(p.recent) ? p.recent : [],
  };
}

function saveProfile(p: Profile) {
  saveJSON(PROFILE_KEY, p);
}

/** Record a finished game for lifetime stats (only call for human games). */
export function recordGame(deckKey: string, deckName: string, result: 'W' | 'L' | 'D') {
  const p = getProfile();
  const k = result === 'W' ? 'w' : result === 'L' ? 'l' : 'd';
  p.games[k]++;
  const ds = p.decks[deckKey] ?? { name: deckName, w: 0, l: 0, d: 0 };
  ds.name = deckName;
  ds[k]++;
  p.decks[deckKey] = ds;
  saveProfile(p);
}

export function recordMatch(m: RecentMatch) {
  const p = getProfile();
  const k = m.result === 'W' ? 'w' : m.result === 'L' ? 'l' : 'd';
  p.matches[k]++;
  p.recent.unshift(m);
  p.recent = p.recent.slice(0, 25);
  saveProfile(p);
}

export function recordTournament(t: TournamentHistoryEntry) {
  const p = getProfile();
  p.tournaments = [t, ...p.tournaments.filter((x) => x.id !== t.id)].slice(0, 50);
  saveProfile(p);
}

export function tournamentSummary() {
  const t = getProfile().tournaments;
  return {
    played: t.length,
    wins: t.filter((x) => x.place === 1).length,
    best: t.length ? Math.min(...t.map((x) => x.place)) : null,
  };
}

export function winRate(r: Record3) {
  const n = r.w + r.l + r.d;
  return n ? r.w / n : 0;
}

export function resetAllData() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('edison.')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
