// What the judge (judge.ts) knows and looks at, without any DOM: the rulings on record for a card, the cards in
// question right now (only ones the asking player can see), and card-name search. Kept apart so tests run it in Node.
import { allCards } from '../../cards';
import { RULINGS, type RulingNote } from '../../cards/rulings.generated';
import type { CardInstance } from '../../engine/card';
import type { Game } from '../../engine/game';
import type { PlayerId } from '../../engine/types';
import { RULES_NOTES } from '../screens/rulesNotes';

/** Everything on record for a card: cited 2010 rulings, then the Rules updates that mention it. */
export function rulingsFor(name: string): { notes: RulingNote[]; updates: string[] } {
  const notes = RULINGS[name] ?? [];
  const updates: string[] = [];
  for (const g of RULES_NOTES) for (const it of g.items) if (it.includes(name) && !updates.includes(it)) updates.push(it);
  return { notes, updates };
}

/** The cards a judge would look at right now, most relevant first (at most `max`, by name). Only cards `viewer` can
 *  see right now: the judge must not name a card the opponent drew, Set or holds (a spectator, `null`, sees only what
 *  both players see). */
export function cardsInQuestion(game: Game, focus: CardInstance | null | undefined, viewer: PlayerId | null, max = 6): string[] {
  const out: string[] = [];
  const add = (c: CardInstance | null | undefined) => {
    if (!c || typeof c.name !== 'string' || c.isToken || out.includes(c.name) || out.length >= max) return;
    try {
      if (!game.seenBy(c, viewer)) return;
    } catch {
      return;
    }
    out.push(c.name);
  };
  // the Chain, newest link first
  for (const l of [...game.chain].reverse()) add(l.card);
  add(focus);
  // the last things that happened (cards that moved, were summoned, activated, attacked…)
  const recent = game.eventLog.slice(-30).reverse();
  for (const ev of recent) {
    add(ev.card as CardInstance | undefined);
    add((ev as { other?: CardInstance }).other);
  }
  return out;
}

let NAMES: string[] | null = null;
const cardNames = () => (NAMES ??= [...new Set(allCards().map((c) => c.name))].sort());

/** Card names matching what was typed: exact, then starts-with, then contains (at most `max`). */
export function searchCards(q: string, max = 6): string[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const all = cardNames();
  const exact = all.filter((n) => n.toLowerCase() === t);
  const starts = all.filter((n) => n.toLowerCase().startsWith(t) && !exact.includes(n));
  const has = all.filter((n) => n.toLowerCase().includes(t) && !exact.includes(n) && !starts.includes(n));
  return [...exact, ...starts, ...has].slice(0, max);
}

