// Side Deck check: every premade deck must have exactly 15 Side Deck cards, every card must resolve
// in the card database, be Edison legal, and respect the Forbidden / Limited / Semi-Limited list
// across Main + Extra + Side combined.
// Run: npx tsx scripts/side-deck-test.ts
import { findCard } from '../src/cards';
import { isPostEdison, limitOf } from '../src/cards/banlist';
import { PREMADE_DECKS, validateDeck } from '../src/decks';

let failures = 0;
const fail = (deck: string, msg: string) => {
  failures++;
  console.log(`  FAIL ${deck}: ${msg}`);
};

for (const deck of PREMADE_DECKS) {
  const side = deck.side ?? [];
  const count = side.reduce((a, [, n]) => a + n, 0);
  const extraCount = deck.extra.reduce((a, [, n]) => a + n, 0);
  console.log(`${count === 15 ? 'ok  ' : 'FAIL'} side ${String(count).padStart(2)}  extra ${String(extraCount).padStart(2)}  ${deck.id}`);
  if (count !== 15) fail(deck.id, `Side Deck has ${count} cards (expected 15).`);
  if (extraCount > 15) fail(deck.id, `Extra Deck has ${extraCount} cards (maximum 15).`);
  for (const [name] of deck.extra) {
    const c = findCard(name);
    if (!c) fail(deck.id, `Unknown Extra Deck card: ${name}`);
    else if (c.name !== name) fail(deck.id, `${name} resolves to "${c.name}" (use the exact name).`);
  }

  const seen = new Set<string>();
  for (const [name, n] of side) {
    if (seen.has(name)) fail(deck.id, `${name} listed twice in the Side Deck.`);
    seen.add(name);
    if (n < 1) fail(deck.id, `${name} has ${n} copies.`);
    const c = findCard(name);
    if (!c) {
      fail(deck.id, `Unknown card: ${name}`);
      continue;
    }
    if (c.name !== name) fail(deck.id, `${name} resolves to "${c.name}" (use the exact name).`);
    if (isPostEdison(c.name)) fail(deck.id, `${c.name} is post-Edison.`);
    if (c.mtypes?.includes('synchro') || c.mtypes?.includes('fusion')) {
      // Extra Deck monsters may be sided (they swap with the Extra Deck), so this is allowed.
    }
  }

  // Combined limits, independent of whether validateDeck counts the side deck.
  const totals = new Map<string, number>();
  for (const [name, n] of [...deck.main, ...deck.extra, ...side]) {
    const key = findCard(name)?.name ?? name;
    totals.set(key, (totals.get(key) ?? 0) + n);
  }
  for (const [name, n] of totals) {
    const lim = limitOf(name);
    if (n > lim) fail(deck.id, `${name}: ${n} copies across Main + Extra + Side (limit ${lim}).`);
  }

  for (const e of validateDeck(deck)) fail(deck.id, `validateDeck: ${e}`);
}

if (failures) {
  console.log(`\n${failures} problem(s).`);
  process.exit(1);
}
console.log(`\nAll ${PREMADE_DECKS.length} premade decks have a legal 15-card Side Deck.`);
