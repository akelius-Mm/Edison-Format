// Custom Draft / Sealed setups and the shop preference: table sizes, knockout brackets,
// no-filler decks, 15-card boosters, a limited Edison Pack and setup validation.
//   npx tsx scripts/draft-setup-test.ts
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};

const { createDraft, makePick, autoBuildHuman, startTournament, recordHumanMatch, advanceRound, humanMatch, totalRounds, seatsOf, standings, deckProblems, fillerIds, generateEventPacks, checkSetup, edisonSetsFor, edisonPoolSize, draftSetCodes, fitPlan, resizePlan, planCards, DEFAULT_OPTIONS, isRealPack, packOption, edisonPoolFor } = await import('../src/draft');
const { playableSets, setShopShows, shopShows, EDISON_SHELF } = await import('../src/collection/catalog');

let failed = 0;
const ok = (cond: unknown, msg: string) => {
  if (!cond) {
    failed++;
    console.error('  FAIL', msg);
  }
};
const human = { name: 'You', avatar: 'a', sleeve: 's' };

// ---------------------------------------------------------------- legal sets
const legal = draftSetCodes();
ok(!legal.includes('TSHD'), 'TSHD is never a draft set');
ok(['ABPF', 'SOVR', 'ANPR', 'LODT', 'PTDN', 'CRMS', 'RGBT'].every((c) => legal.includes(c)), 'legal core sets are listed');
ok(legal[0] === 'ABPF', 'newest set first');
ok(!packOption('TSHD', true).ready, 'TSHD cannot be forced by the dev override');

// ---------------------------------------------------------------- draft: 6 players, mixed packs, knockout
for (const seats of [4, 6, 8]) {
  const s = createDraft({ mode: 'draft', plan: ['EDISON', 'ABPF', 'SOVR', 'ANPR'], seats, bestOf: 3, opts: { tourney: 'single', ai: 'hard' }, human, avatars: [], sleeves: [], seed: 42 + seats });
  ok(seatsOf(s) === seats && s.packs[0].length === seats, `${seats} seats get packs`);
  while (s.phase === 'draft') makePick(s, 0);
  ok(s.picks.every((p) => p.length === s.picks[0].length), `${seats} seats: everyone drafts the same number of cards`);
  startTournament(s, autoBuildHuman(s));
  ok(totalRounds(s) === Math.ceil(Math.log2(seats)), `${seats} seats: knockout rounds`);
  // the human loses round 1: the rest is played out
  await recordHumanMatch(s, [{ winner: 1, turns: 5, reason: 'x', how: 'fast' }, { winner: 1, turns: 5, reason: 'x', how: 'fast' }], 'b', false);
  ok(s.phase === 'done', `${seats} seats: knocked-out human ends the event`);
  ok(s.rounds.length === totalRounds(s), `${seats} seats: all rounds played`);
  const final = s.rounds[s.rounds.length - 1].filter((m) => m.b);
  ok(final.length === 1 && final[0].result && final[0].result !== 'draw', `${seats} seats: one decided final`);
  ok(standings(s).length === seats, `${seats} seats: standings`);
}

// knockout where the human keeps winning (6 players: someone gets a bye in round 2)
{
  const s = createDraft({ mode: 'sealed', plan: ['EDISON', 'EDISON', 'EDISON', 'EDISON'], seats: 6, opts: { tourney: 'single' }, human, avatars: [], sleeves: [], seed: 7 });
  s.opened = s.packCount;
  s.phase = 'build';
  startTournament(s, autoBuildHuman(s));
  const done = () => (s.phase as string) === 'done';
  let guard = 0;
  while (!done() && guard++ < 10) {
    const m = humanMatch(s);
    if (m && m.b && !m.result) await recordHumanMatch(s, [{ winner: 0, turns: 5, reason: 'x', how: 'fast' }], 'a', false);
    else if (m && !m.b) {
      const { finishRound } = await import('../src/draft');
      await finishRound(s, false);
    }
    if (!done()) advanceRound(s);
  }
  ok(done() && standings(s)[0].id === 'p0', 'undefeated human wins the 6-player bracket');
}

// ---------------------------------------------------------------- swiss with 4 players, no fillers, 15-card boosters
{
  const s = createDraft({ mode: 'draft', plan: ['ABPF', 'SOVR', 'ANPR', 'ABPF'], seats: 4, opts: { fillers: false, realSize: 15 }, human, avatars: [], sleeves: [], seed: 9 });
  ok(s.packs.every((r) => r.every((p) => p.length === 15)), '15-card draft boosters');
  ok(fillerIds(s).length === 0, 'no fillers when turned off');
  while (s.phase === 'draft') makePick(s, 0);
  const d = autoBuildHuman(s);
  ok(d.main.length >= 40, `no-filler deck reaches 40 from 60 picks (${d.main.length})`);
  ok(deckProblems(s, d).length === 0, 'no-filler deck is legal');
  startTournament(s, d);
  for (let r = 0; r < 3; r++) {
    await recordHumanMatch(s, [{ winner: 0, turns: 5, reason: 'x', how: 'fast' }], 'a', false);
    advanceRound(s);
  }
  ok(s.phase === 'done' && s.rounds.length === 3, '4-player Swiss plays 3 rounds');
}

// ---------------------------------------------------------------- Edison Pack limited to sets
{
  const recent = edisonSetsFor('recent', [])!;
  ok(recent.length > 0 && !recent.includes('TSHD') && !recent.includes('PTDN'), '2009–2010 sets');
  const pool = new Set(edisonPoolFor(recent).map((c) => c.id));
  const packs = generateEventPacks(5, ['EDISON', 'EDISON'], 4, { edisonSets: recent });
  ok(packs.flat(2).every((p) => pool.has(p.id)), 'limited Edison Pack only has cards from the chosen sets');
  ok(packs.flat().every((p) => p.length === 15), 'limited Edison Pack has 15 cards');
  ok(edisonPoolSize({ edisonPool: 'custom', edisonSets: ['TU02'] }) < 80, 'tiny custom pool is small');
}

// ---------------------------------------------------------------- validation
{
  const base = { ...DEFAULT_OPTIONS, mode: 'draft' as const };
  ok(checkSetup({ ...base, plan: ['ABPF', 'ABPF', 'ABPF', 'ABPF'] }).ok === false, '4 × 9 cards is too few for a draft');
  ok(checkSetup({ ...base, plan: ['ABPF', 'ABPF', 'ABPF', 'ABPF', 'ABPF'] }).ok, '5 × 9 cards is enough');
  ok(!checkSetup({ ...base, fillers: false, plan: ['ABPF', 'ABPF', 'ABPF', 'ABPF', 'ABPF'] }).ok, 'no fillers needs more picks');
  ok(!checkSetup({ ...base, plan: ['EDISON', 'EDISON', 'EDISON', 'EDISON'], edisonPool: 'custom', edisonSets: ['TU02'] }).ok, 'tiny Edison pool is rejected');
  ok(!checkSetup({ ...base, plan: ['EDISON', 'LODT', 'EDISON', 'EDISON'] }).ok || packOption('LODT').ready, 'incomplete set is rejected');
  const grown = fitPlan((n) => resizePlan(['ABPF'], n), 3, { mode: 'sealed', realSize: 9, fillers: true });
  ok(planCards(grown) >= 54 && grown.every(isRealPack), `fitPlan grows a sealed pool (${grown.length} packs)`);
}

// ---------------------------------------------------------------- shop preference
{
  ok(shopShows() === 'shelf', 'shop defaults to the 2010 shelf');
  const shelf = playableSets().filter((s) => s.available).map((s) => s.code);
  ok(shelf.every((c) => EDISON_SHELF.has(c)), 'shelf mode only sells the shelf');
  setShopShows('legal');
  const all = playableSets().filter((s) => s.available);
  ok(all.every((s) => s.legal && (s.onShelf || s.ready)), 'legal mode sells only complete legal sets');
  ok(!all.some((s) => s.code === 'TSHD' || s.data.released > '2010-04-24'), 'never post-Edison sets');
  ok(shelf.every((c) => all.some((s) => s.code === c)), 'legal mode keeps the shelf');
  setShopShows('shelf');
}

if (failed) {
  console.error(`draft-setup-test: ${failed} failure(s)`);
  process.exit(1);
}
console.log('draft-setup-test: all checks passed');
