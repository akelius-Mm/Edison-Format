// Side decking between the games of a best-of-3 match.
//
// Constructed (2010 rules): one-for-one swaps between the deck and the Side Deck, so the Side Deck
// keeps its card count. Main Deck cards swap with non-Extra cards; Extra Deck (Synchro / Fusion)
// monsters swap only with Extra Deck monsters in the side.
// Limited (Draft / Sealed): the side is the rest of the pool; cards move freely as long as the
// Main Deck stays at 40 or more (and at most 60, Extra at most 15).
//
// Decks are lists of card ids. Order matters (the game shuffles the list with its seed), so a
// swap puts the incoming card in the outgoing card's slot and vice versa: a replay that rebuilds
// a game from the stored lists gets the identical deck.
import { CARDS } from '../cards';
import type { CardData } from '../engine/card';
import { Rng } from '../engine/rng';

export interface DeckIds {
  main: string[];
  extra: string[];
  side: string[];
}

export const isExtraDeckCard = (c: Pick<CardData, 'mtypes'>) => !!(c.mtypes?.includes('synchro') || c.mtypes?.includes('fusion'));

const card = (id: string): CardData | undefined => CARDS[id];

export const cloneDeck = (d: DeckIds): DeckIds => ({ main: [...d.main], extra: [...d.extra], side: [...d.side] });

/** Constructed swaps: Extra Deck monsters only with Extra Deck monsters, everything else with non-Extra cards. */
export function canSwap(out: Pick<CardData, 'mtypes'>, inn: Pick<CardData, 'mtypes'>): boolean {
  return isExtraDeckCard(out) === isExtraDeckCard(inn);
}

/**
 * One-for-one swap: `outId` leaves the Main/Extra Deck for the side and `inId` takes its slot.
 * Returns null (and changes nothing) when the swap is not allowed or a card is not there.
 */
export function swapCards(d: DeckIds, outId: string, inId: string): DeckIds | null {
  const o = card(outId);
  const i = card(inId);
  if (!o || !i || !canSwap(o, i)) return null;
  const sec = isExtraDeckCard(o) ? 'extra' : 'main';
  const at = d[sec].lastIndexOf(outId);
  const sat = d.side.lastIndexOf(inId);
  if (at < 0 || sat < 0) return null;
  const next = cloneDeck(d);
  next[sec][at] = inId;
  next.side[sat] = outId;
  return next;
}

export const LIMITED_MIN_MAIN = 40;

/** Limited: move one card from the Main/Extra Deck to the side. Null when the Main Deck would drop below 40. */
export function moveToSide(d: DeckIds, id: string): DeckIds | null {
  const c = card(id);
  if (!c) return null;
  const sec = isExtraDeckCard(c) ? 'extra' : 'main';
  const at = d[sec].lastIndexOf(id);
  if (at < 0) return null;
  if (sec === 'main' && d.main.length <= LIMITED_MIN_MAIN) return null;
  const next = cloneDeck(d);
  next[sec].splice(at, 1);
  next.side.push(id);
  return next;
}

/** Limited: move one card from the side into the Main/Extra Deck (Main at most 60, Extra at most 15). */
export function moveToDeck(d: DeckIds, id: string): DeckIds | null {
  const c = card(id);
  if (!c) return null;
  const sat = d.side.lastIndexOf(id);
  if (sat < 0) return null;
  const sec = isExtraDeckCard(c) ? 'extra' : 'main';
  if (sec === 'main' ? d.main.length >= 60 : d.extra.length >= 15) return null;
  const next = cloneDeck(d);
  next.side.splice(sat, 1);
  next[sec].push(id);
  return next;
}

const tally = (ids: string[]) => {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
};

/** Cards added to and removed from the Main + Extra Deck, going from `from` to `to`. */
export function sideDiff(from: Pick<DeckIds, 'main' | 'extra'>, to: Pick<DeckIds, 'main' | 'extra'>): { added: [string, number][]; removed: [string, number][] } {
  const a = tally([...from.main, ...from.extra]);
  const b = tally([...to.main, ...to.extra]);
  const added: [string, number][] = [];
  const removed: [string, number][] = [];
  for (const [id, n] of b) if (n > (a.get(id) ?? 0)) added.push([id, n - (a.get(id) ?? 0)]);
  for (const [id, n] of a) if (n > (b.get(id) ?? 0)) removed.push([id, n - (b.get(id) ?? 0)]);
  const byName = (x: [string, number], y: [string, number]) => y[1] - x[1] || (card(x[0])?.name ?? x[0]).localeCompare(card(y[0])?.name ?? y[0]);
  return { added: added.sort(byName), removed: removed.sort(byName) };
}

/** "+2 D.D. Crow, −2 Bottomless Trap Hole" ('' when nothing changed). */
export function sideSummary(from: Pick<DeckIds, 'main' | 'extra'>, to: Pick<DeckIds, 'main' | 'extra'>): string {
  const { added, removed } = sideDiff(from, to);
  const nm = (id: string) => card(id)?.name ?? id;
  return [...added.map(([id, n]) => `+${n} ${nm(id)}`), ...removed.map(([id, n]) => `−${n} ${nm(id)}`)].join(', ');
}

/** Problems with a sided deck (empty = fine). Constructed also checks that the Side Deck kept its size. */
export function sidedDeckProblems(d: DeckIds, original: DeckIds | null, opts: { limited?: boolean } = {}): string[] {
  const out: string[] = [];
  if (d.main.length < 40) out.push(`Main Deck has ${d.main.length} cards (minimum 40).`);
  if (d.main.length > 60) out.push(`Main Deck has ${d.main.length} cards (maximum 60).`);
  if (d.extra.length > 15) out.push(`Extra Deck has ${d.extra.length} cards (maximum 15).`);
  for (const id of d.main) if (card(id) && isExtraDeckCard(card(id)!)) out.push(`${card(id)!.name} belongs in the Extra Deck.`);
  if (!opts.limited && original) {
    if (d.side.length !== original.side.length) out.push(`Side Deck must keep ${original.side.length} cards.`);
    if (d.main.length !== original.main.length || d.extra.length !== original.extra.length) out.push('Siding must be one-for-one.');
  }
  return [...new Set(out)];
}

// ------------------------------------------------------------------ AI siding

interface Profile {
  /** 0..1 strengths of the opponent's tendencies. */
  gy: number;
  traps: number;
  light: number;
  dark: number;
  machine: number;
  synchro: number;
  spells: number;
}

const GY_NAMES = new Set(
  [
    'Dark Armed Dragon',
    'Necro Gardna',
    'Glow-Up Bulb',
    'Plaguespreader Zombie',
    'Spore',
    'Mezuki',
    'Card Trooper',
    'Monster Reborn',
    'Call of the Haunted',
    'Dandylion',
    'Lonefire Blossom',
    'Charge of the Light Brigade',
    'Foolish Burial',
    'Solar Recharge',
    'Burial from a Different Dimension',
    'Gravekeeper’s Spy',
    'Necrovalley',
    'Zombie Master',
    'Goblin Zombie',
    'Il Blud',
    'Card of Safe Return',
    'Destiny HERO - Malicious',
    'Destiny HERO - Disk Commander',
    'Allure of Darkness',
    'Phoenix Wing Wind Blast',
    'Jar of Avarice',
  ].map((n) => n.toLowerCase()),
);

function profileOf(opp: CardData[], oppExtra: CardData[]): Profile {
  const n = Math.max(1, opp.length);
  let gy = 0,
    traps = 0,
    spells = 0,
    machine = 0,
    light = 0,
    dark = 0,
    mons = 0;
  for (const c of opp) {
    const sets = c.sets ?? [];
    if (sets.includes('lightsworn') || sets.includes('gravekeeper') || c.race === 'Zombie' || c.race === 'Plant' || GY_NAMES.has(c.name.toLowerCase())) gy++;
    if (c.kind === 'trap') traps++;
    if (c.kind === 'spell') spells++;
    if (c.kind === 'monster') {
      mons++;
      if (c.race === 'Machine' || sets.includes('machina') || sets.includes('gadget')) machine++;
      if (c.attribute === 'LIGHT') light++;
      if (c.attribute === 'DARK') dark++;
    }
  }
  for (const c of oppExtra) if (c.race === 'Machine') machine += 0.5;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const synchros = oppExtra.filter((c) => c.mtypes?.includes('synchro')).length;
  return {
    gy: clamp((gy / n - 0.12) / 0.2),
    traps: clamp((traps / n - 0.2) / 0.12),
    spells: clamp((spells / n - 0.35) / 0.12),
    machine: clamp((machine - 4) / 6),
    light: mons >= 8 ? clamp((light / mons - 0.55) / 0.25) : 0,
    dark: mons >= 8 ? clamp((dark / mons - 0.55) / 0.25) : 0,
    synchro: clamp((synchros - 3) / 6),
  };
}

/**
 * Side cards and the matchup they answer. `narrow` cards are dead outside their matchup, so the
 * AI also sides them out of its Main Deck when they don't fit.
 */
const SIDE_RULES: { key: keyof Profile; narrow?: boolean; names: string[] }[] = [
  { key: 'gy', names: ['D.D. Crow', 'Macro Cosmos', 'Kycoo the Ghost Destroyer', 'Dimensional Fissure', 'Banisher of the Radiance', 'Soul Release', 'Bottomless Shifting Sand'] },
  { key: 'traps', narrow: true, names: ['Royal Decree', 'Trap Stun', 'Seven Tools of the Bandit', 'Trap Jammer'] },
  { key: 'traps', names: ['Jinzo', 'Dust Tornado', 'Heavy Storm', 'Mystical Space Typhoon'] },
  { key: 'light', narrow: true, names: ['Light-Imprisoning Mirror'] },
  { key: 'dark', narrow: true, names: ['Shadow-Imprisoning Mirror', 'Consecrated Light'] },
  { key: 'machine', names: ['Cyber Dragon', 'Proto-Cyber Dragon', 'Chimeratech Fortress Dragon', 'Electric Virus'] },
  { key: 'machine', narrow: true, names: ['System Down'] },
  { key: 'synchro', names: ['Thunder King Rai-Oh', 'Royal Oppression', 'Vanity’s Fiend', 'Mirror of Oaths', 'Chain Disappearance', 'Banisher of the Radiance'] },
  { key: 'spells', narrow: true, names: ['Prohibition', 'Spell Canceller', 'Magic Drain', 'Imperial Order'] },
];

const norm = (s: string) => s.toLowerCase().replace(/[‘’']/g, "'");
const RULES_BY_NAME = new Map<string, { key: keyof Profile; narrow: boolean }[]>();
for (const r of SIDE_RULES) for (const n of r.names) RULES_BY_NAME.set(norm(n), [...(RULES_BY_NAME.get(norm(n)) ?? []), { key: r.key, narrow: !!r.narrow }]);

/** How much a card helps in this matchup (0..1), and whether it is dead here. */
function fit(c: CardData, p: Profile): { fit: number; dead: boolean } {
  const rules = RULES_BY_NAME.get(norm(c.name));
  if (!rules) return { fit: 0, dead: false };
  const f = Math.max(...rules.map((r) => p[r.key]));
  return { fit: f, dead: f < 0.15 && rules.every((r) => r.narrow) };
}

/** A card's general strength, on the AI's own scale (aiValue): spells, traps and monsters alike. */
function baseValue(c: CardData): number {
  const lim = c.limit ?? 3;
  let v = 1000 + (c.aiValue ?? 0);
  if (c.kind === 'monster' && (c.atk ?? 0) >= 1800) v += 150;
  if (lim < 3) v += 250; // limited cards are staples
  return v;
}

/**
 * AI siding: swap weak or dead cards for side cards that answer the opponent's deck.
 * Deterministic for the same decks and seed. Starts from `own` (usually the original deck).
 */
export function aiSideDeck(own: DeckIds, oppDeck: Pick<DeckIds, 'main' | 'extra'>, seed: number, maxSwaps = 6): DeckIds {
  let d = cloneDeck(own);
  if (!d.side.length) return d;
  const oppMain = oppDeck.main.map(card).filter((c): c is CardData => !!c);
  const oppExtra = oppDeck.extra.map(card).filter((c): c is CardData => !!c);
  const prof = profileOf(oppMain, oppExtra);
  const rng = new Rng((seed ^ 0x51de) >>> 0);
  // own archetype cards are protected: they are the engine of the deck
  const setCount = new Map<string, number>();
  for (const id of d.main) for (const s of card(id)?.sets ?? []) setCount.set(s, (setCount.get(s) ?? 0) + 1);
  const coreSets = new Set([...setCount].filter(([, n]) => n >= 5).map(([s]) => s));
  const value = (c: CardData, inDeck: boolean) => {
    const f = fit(c, prof);
    let v = baseValue(c) + f.fit * 1400 - (f.dead ? 1500 : 0);
    if (inDeck && (c.sets ?? []).some((s) => coreSets.has(s))) v += 900;
    if (inDeck && c.mtypes?.includes('tuner') && d.extra.length) v += 300; // Synchro decks need their tuners
    return v + rng.next() * 40; // stable tie-break from the seed
  };
  for (const extra of [false, true]) {
    const ins = d.side
      .map((id) => card(id))
      .filter((c): c is CardData => !!c && isExtraDeckCard(c) === extra)
      .map((c) => ({ c, v: value(c, false), f: fit(c, prof).fit }))
      .filter((x) => x.f >= 0.5)
      .sort((a, b) => b.v - a.v);
    const outs = (extra ? d.extra : d.main)
      .map((id) => card(id))
      .filter((c): c is CardData => !!c)
      .map((c) => ({ c, v: value(c, true) }))
      .sort((a, b) => a.v - b.v);
    let swaps = 0;
    for (const x of ins) {
      if (swaps >= maxSwaps) break;
      const o = outs.shift();
      if (!o) break;
      if (x.v <= o.v + 250) break; // not worth it
      const next = swapCards(d, o.c.id, x.c.id);
      if (!next) continue;
      d = next;
      swaps++;
    }
  }
  return d;
}
