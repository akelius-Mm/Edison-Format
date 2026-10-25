import '../cards';
import { CARDS, cardByName, findCard } from '../cards';
import { isPostEdison } from '../cards/banlist';
import type { CardData } from '../engine/card';
import type { DeckList } from '../engine/game';
import { DECKS as A } from './group-a';
import { DECKS as B } from './group-b';
import { DECKS as C } from './group-c';
import { DECKS as D } from './group-d';
import { DECKS as E } from './group-e';
import { DECKS as T } from './tournament';
import { DECKS as T2 } from './tournament2';
import { DECKS as T3 } from './tournament3';
import type { DeckDef } from './types';

export type { DeckDef };
export * from './siding';

export const PREMADE_DECKS: DeckDef[] = [...A, ...B, ...C, ...D, ...E, ...T, ...T2, ...T3];

export function deckById(id: string) {
  return PREMADE_DECKS.find((d) => d.id === id);
}

/** Expand a deck definition into card data lists. Unknown cards are skipped (and reported). */
export function buildDeckList(def: Pick<DeckDef, 'main' | 'extra' | 'side'>): DeckList & { missing: string[] } {
  const missing: string[] = [];
  const expand = (entries: [string, number][]) => {
    const out: CardData[] = [];
    for (const [name, n] of entries) {
      const c = findCard(name);
      if (!c) {
        missing.push(name);
        continue;
      }
      for (let i = 0; i < n; i++) out.push(c);
    }
    return out;
  };
  const out: DeckList & { missing: string[] } = { main: expand(def.main), extra: expand(def.extra), missing };
  if (def.side?.length) out.side = expand(def.side);
  return out;
}

/**
 * Validate a deck against Edison construction rules. Returns a list of problems.
 * Copy limits count the Main, Extra and Side Deck together.
 * `ignoreLimits` (Draft / Sealed) waives copy limits, the banlist, the post-Edison release check and
 * the 15-card Side Deck cap (a Limited side is the rest of the pool).
 */
export function validateDeck(
  def: Pick<DeckDef, 'main' | 'extra'> & { side?: [string, number][] },
  opts: { ignoreLimits?: boolean } = {},
): string[] {
  const errs: string[] = [];
  const count = (e: [string, number][]) => e.reduce((a, [, n]) => a + n, 0);
  const main = count(def.main);
  const extra = count(def.extra);
  if (main < 40) errs.push(`Main Deck has ${main} cards (minimum 40).`);
  if (main > 60) errs.push(`Main Deck has ${main} cards (maximum 60).`);
  if (extra > 15) errs.push(`Extra Deck has ${extra} cards (maximum 15).`);
  const side = count(def.side ?? []);
  if (side > 15 && !opts.ignoreLimits) errs.push(`Side Deck has ${side} cards (maximum 15).`);
  const totals = new Map<string, number>();
  for (const [n, c] of [...def.main, ...def.extra, ...(def.side ?? [])]) totals.set(n, (totals.get(n) ?? 0) + c);
  for (const [name, n] of totals) {
    const c = findCard(name);
    if (!c) {
      errs.push(`Unknown card: ${name}`);
      continue;
    }
    if (opts.ignoreLimits) continue;
    if (isPostEdison(c.name)) errs.push(`${c.name} was released after April 2010 (not Edison legal).`);
    const lim = c.limit ?? 3;
    if (n > lim) errs.push(`${name}: ${n} copies (limit ${lim === 0 ? 'Forbidden' : lim}).`);
  }
  for (const [name] of def.main) {
    const c = findCard(name);
    if (c && (c.mtypes?.includes('synchro') || c.mtypes?.includes('fusion'))) errs.push(`${name} belongs in the Extra Deck.`);
  }
  for (const [name] of def.extra) {
    const c = findCard(name);
    if (c && !(c.mtypes?.includes('synchro') || c.mtypes?.includes('fusion'))) errs.push(`${name} cannot go in the Extra Deck.`);
  }
  return errs;
}

void CARDS;
void cardByName;
