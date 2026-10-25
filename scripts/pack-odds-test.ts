// Deterministic pack-odds test: opens 10,000 seeded packs of every era set and checks
// pack size, card validity, in-pack distinctness and per-rarity rates against the documented
// odds in src/collection/packs.ts (including the empty-pool fallback, computed analytically).
// Usage: npx tsx scripts/pack-odds-test.ts
import '../src/cards';
import { CARDS, findCard } from '../src/cards';
import { DRAFT_MIN_PLAYABLE, DRAFT_SETS, generateSetPack } from '../src/collection/draft';
import { Rng } from '../src/engine/rng';
import { playableSets, type PlayableSet } from '../src/collection/catalog';
import { mixSeed, openPack, PACK_FORMATS, resolveTier } from '../src/collection/packs';
import { RARITY_NAMES, RARITY_ORDER, type Rarity } from '../src/collection/types';

const PACKS = 10_000;
const t0 = Date.now();
let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.error('  FAIL ' + msg);
};

/** Expected number of cards of each rarity per pack, after the empty-pool fallback. */
function expectedPerPack(set: PlayableSet): Map<Rarity, number> {
  const f = PACK_FORMATS[set.data.format];
  const exp = new Map<Rarity, number>();
  const add = (rolled: Rarity[], p: number, count: number) => {
    const tier = resolveTier(set, rolled);
    if (!tier.length) return;
    // A pooled tier (Common + Short Print, or Super + Ultra) splits by card weight.
    let total = 0;
    const w = (r: Rarity) => (set.pools[r]?.length ?? 0) * (r === 'SP' ? f.shortPrintWeight : 1);
    for (const r of tier) total += w(r);
    for (const r of tier) {
      const key: Rarity = r === 'SP' ? 'C' : r;
      exp.set(key, (exp.get(key) ?? 0) + (p * count * w(r)) / total);
    }
  };
  for (const slot of f.slots) {
    const base = Array.isArray(slot.base) ? slot.base : [slot.base];
    let rest = 1;
    for (const o of slot.foil ?? []) {
      add([o.rarity], 1 / o.oneIn, slot.count);
      rest -= 1 / o.oneIn;
    }
    add(base, rest, slot.count);
  }
  return exp;
}

const rows: string[] = [];
for (const set of playableSets()) {
  if (!set.playable.length) continue;
  const f = PACK_FORMATS[set.data.format];
  const counts = new Map<Rarity, number>();
  // in-pack duplicates are only allowed once a rarity's pool is exhausted
  let badDupes = 0;
  for (let i = 0; i < PACKS; i++) {
    const pulls = openPack(set.code, mixSeed(0xed150, i));
    if (pulls.length !== f.cardsPerPack) {
      fail(`${set.code}: pack ${i} has ${pulls.length} cards, expected ${f.cardsPerPack}`);
      break;
    }
    const perRarity = new Map<Rarity, Set<string>>();
    const perRarityN = new Map<Rarity, number>();
    for (const p of pulls) {
      if (!findCard(p.name)) fail(`${set.code}: unknown card ${p.name}`);
      if (!set.rarities.get(p.name)?.includes(p.rarity) && !(p.rarity === 'C' && set.rarities.get(p.name)?.includes('SP')))
        fail(`${set.code}: ${p.name} was never printed as ${p.rarity} in this set`);
      counts.set(p.rarity, (counts.get(p.rarity) ?? 0) + 1);
      const k = p.rarity;
      (perRarity.get(k) ?? perRarity.set(k, new Set()).get(k)!).add(p.name);
      perRarityN.set(k, (perRarityN.get(k) ?? 0) + 1);
    }
    for (const [r, names] of perRarity) {
      const pool = new Set([...(set.pools[r] ?? []), ...(r === 'C' ? set.pools.SP ?? [] : [])]).size;
      if (names.size < Math.min(perRarityN.get(r)!, pool)) badDupes++;
    }
  }
  if (badDupes) fail(`${set.code}: ${badDupes} packs repeat a card while unused cards of that rarity remained`);
  // determinism
  const a = JSON.stringify(openPack(set.code, 12345));
  if (a !== JSON.stringify(openPack(set.code, 12345))) fail(`${set.code}: openPack is not deterministic`);

  const exp = expectedPerPack(set);
  const parts: string[] = [];
  for (const r of RARITY_ORDER) {
    const e = (exp.get(r) ?? 0) * PACKS;
    const o = counts.get(r) ?? 0;
    if (!e && !o) continue;
    // binomial-ish tolerance: 5 sigma plus a little slack for pooled slots
    const sd = Math.sqrt(Math.max(e, 1));
    if (Math.abs(o - e) > 5 * sd + 3) fail(`${set.code}: ${RARITY_NAMES[r]} ${o} vs expected ${e.toFixed(1)}`);
    if (r !== 'C') parts.push(`${r} ${o}${e ? ` (exp ${e.toFixed(0)})` : ''}`);
  }
  rows.push(`  ${set.code.padEnd(5)} ${String(set.playable.length).padStart(3)}/${String(set.printed).padEnd(4)} ${set.available ? 'open ' : 'hidden'} ${parts.join(', ')}`);
}

console.log(`Pack odds: ${PACKS.toLocaleString()} packs per set (playable/printed, rarity counts)`);
for (const r of rows) console.log(r);

// Draft API: deterministic for a seeded Rng, real 9-card packs, valid draft rarities.
{
  if (!DRAFT_SETS.length) fail('DRAFT_SETS is empty');
  const forbidden = new Set<string>();
  const byId = new Map(Object.values(CARDS).map((x) => [x.id, x]));
  for (const s of DRAFT_SETS) {
    const a = generateSetPack(s.code, new Rng(77));
    const b = generateSetPack(s.code, new Rng(77));
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${s.code}: generateSetPack not deterministic`);
    if (a.length !== s.cardsPerPack) fail(`${s.code}: draft pack has ${a.length} cards`);
    for (let i = 0; i < 200; i++)
      for (const c of generateSetPack(s.code, new Rng(i))) {
        if (!['C', 'R', 'SR', 'UR', 'ScR'].includes(c.r)) fail(`${s.code}: bad draft rarity ${c.r}`);
        const d = byId.get(c.id);
        if (!d) fail(`${s.code}: unknown id ${c.id}`);
        else if (d.limit === 0) forbidden.add(d.name);
      }
  }
  console.log(`Draft sets (>= ${DRAFT_MIN_PLAYABLE} playable): ${DRAFT_SETS.map((s) => `${s.code} ${s.playable}`).join(', ')}`);
  if (forbidden.size) console.log(`  note: Forbidden cards that can appear in draft packs: ${[...forbidden].join(', ')}`);
}
console.log(`${failures ? 'FAILED' : 'OK'} in ${Date.now() - t0} ms`);
if (failures) process.exit(1);
