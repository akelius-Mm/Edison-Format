// Headless Locals Night check: plays whole nights with every match simulated and verifies the
// Swiss pairings, byes, tiebreakers, top cut, placements, prizes and the field's meta mix.
// Usage: tsx scripts/locals-test.ts [--nights 40]
import { PREMADE_DECKS } from '../src/decks';
import type { PrizeGrant } from '../src/collection/api';
import {
  computeStandings,
  createNight,
  finalizeNight,
  humanIdOffer,
  metaLabel,
  prizesFor,
  runToEnd,
  simulateHumanMatch,
  finishRound,
  advance,
  pendingHumanMatch,
  acceptIntentionalDraw,
  topCutSeeds,
  winnerOf,
  type FieldSize,
  type LocalsNight,
} from '../src/locals';
import { snapshot } from '../src/locals/meta';

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? Number(process.argv[i + 1]) : d;
};
const NIGHTS = arg('--nights', 30);

let passed = 0;
const failures: string[] = [];
function check(ok: boolean, msg: string) {
  if (ok) passed++;
  else if (failures.length < 30) failures.push(msg);
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

function makeNight(size: FieldSize, seed: number): LocalsNight {
  const deck = PREMADE_DECKS[seed % PREMADE_DECKS.length];
  return createNight({
    human: { name: 'You', avatar: 'avatar-1', sleeve: 'classic-red', deck: snapshot(deck) },
    size,
    number: 1 + (seed % 26),
    sleeves: ['classic-red', 'midnight', 'forest'],
    avatars: ['avatar-1', 'avatar-2', 'avatar-8', 'avatar-10'],
    seed,
  });
}

function verifySwiss(n: LocalsNight, tag: string) {
  const met = new Map<string, Set<string>>();
  const byes = new Map<string, number>();
  for (const e of n.entrants) met.set(e.id, new Set());
  check(n.rounds.length === n.swissRounds, `${tag}: ${n.rounds.length} Swiss rounds, expected ${n.swissRounds}`);
  n.rounds.forEach((round, ri) => {
    const r = ri + 1;
    const active = n.entrants.filter((e) => e.dropped == null || e.dropped >= r).map((e) => e.id);
    const seen = new Map<string, number>();
    for (const m of round) {
      for (const id of [m.a, m.b]) if (id) seen.set(id, (seen.get(id) ?? 0) + 1);
      check(m.result != null, `${tag} R${r}: unfinished match ${m.id}`);
      if (m.b == null) {
        byes.set(m.a, (byes.get(m.a) ?? 0) + 1);
        continue;
      }
      check(!met.get(m.a)!.has(m.b), `${tag} R${r}: rematch ${m.a} vs ${m.b}`);
      met.get(m.a)!.add(m.b);
      met.get(m.b)!.add(m.a);
    }
    check(seen.size === active.length && active.every((id) => seen.get(id) === 1), `${tag} R${r}: ${seen.size} paired vs ${active.length} active, or someone paired twice`);
    const byeCount = round.filter((m) => m.b == null).length;
    check(byeCount === active.length % 2, `${tag} R${r}: ${byeCount} byes for ${active.length} active players`);
    // the bye goes to the lowest-ranked player who has not had one
    const bye = round.find((m) => m.b == null);
    if (bye) {
      const prior = computeStandings({ entrants: n.entrants, rounds: n.rounds.slice(0, ri) }).filter((x) => active.includes(x.id));
      const hadBye = new Set(n.rounds.slice(0, ri).flat().filter((m) => m.b == null).map((m) => m.a));
      const eligible = prior.filter((x) => !hadBye.has(x.id));
      check(!hadBye.has(bye.a) || !eligible.length, `${tag} R${r}: ${bye.a} got a second bye`);
      const minMp = Math.min(...eligible.map((x) => x.mp));
      check(!eligible.length || prior.find((x) => x.id === bye.a)!.mp === minMp, `${tag} R${r}: bye not given to the bottom score group`);
    }
    // pairings are within a score group where possible: never a gap of more than one group's worth
    const prior = new Map(computeStandings({ entrants: n.entrants, rounds: n.rounds.slice(0, ri) }).map((x) => [x.id, x.mp]));
    for (const m of round) if (m.b && r > 1) check(Math.abs(prior.get(m.a)! - prior.get(m.b)!) <= 6, `${tag} R${r}: ${m.a}/${m.b} paired ${Math.abs(prior.get(m.a)! - prior.get(m.b)!)} points apart`);
  });
  for (const [id, k] of byes) check(k <= 1, `${tag}: ${id} had ${k} byes`);
}

function verifyStandings(n: LocalsNight, tag: string) {
  const st = computeStandings(n);
  // independent recomputation
  const mp = new Map<string, number>();
  const rp = new Map<string, number>();
  const opps = new Map<string, string[]>();
  for (const e of n.entrants) (mp.set(e.id, 0), rp.set(e.id, 0), opps.set(e.id, []));
  for (const m of n.rounds.flat()) {
    rp.set(m.a, rp.get(m.a)! + 1);
    if (m.b == null) {
      mp.set(m.a, mp.get(m.a)! + 3);
      continue;
    }
    rp.set(m.b, rp.get(m.b)! + 1);
    opps.get(m.a)!.push(m.b);
    opps.get(m.b)!.push(m.a);
    const [pa, pb] = m.result === 'a' ? [3, 0] : m.result === 'b' ? [0, 3] : [1, 1];
    mp.set(m.a, mp.get(m.a)! + pa);
    mp.set(m.b, mp.get(m.b)! + pb);
  }
  const mwp = (id: string) => (rp.get(id)! ? mp.get(id)! / (3 * rp.get(id)!) : 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const omw = (id: string) => mean(opps.get(id)!.map(mwp));
  const oomw = (id: string) => mean(opps.get(id)!.map(omw));
  for (const s of st) {
    check(s.mp === mp.get(s.id), `${tag}: ${s.id} has ${s.mp} points, expected ${mp.get(s.id)}`);
    check(near(s.omw, omw(s.id)), `${tag}: ${s.id} OMW ${s.omw} vs ${omw(s.id)}`);
    check(near(s.oomw, oomw(s.id)), `${tag}: ${s.id} OOMW ${s.oomw} vs ${oomw(s.id)}`);
  }
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1];
    const b = st[i];
    const ok = a.mp > b.mp || (a.mp === b.mp && (a.omw > b.omw + 1e-9 || (near(a.omw, b.omw) && a.oomw >= b.oomw - 1e-9)));
    check(ok, `${tag}: standings out of order at rank ${i} (${a.mp}/${a.omw.toFixed(3)}/${a.oomw.toFixed(3)} above ${b.mp}/${b.omw.toFixed(3)}/${b.oomw.toFixed(3)})`);
  }
  return st;
}

function verifyTop(n: LocalsNight, tag: string) {
  const cut = n.size <= 16 ? 4 : 8;
  check(n.topCut === cut, `${tag}: top cut ${n.topCut}, expected ${cut}`);
  const seeds = topCutSeeds(n);
  const st = computeStandings(n).filter((x) => !x.dropped);
  check(seeds.join() === st.slice(0, cut).map((x) => x.id).join(), `${tag}: top cut seeds are not the top ${cut} of the standings`);
  const first = n.top[0];
  check(first.length === cut / 2, `${tag}: ${first.length} first-round bracket matches`);
  const pairs = cut === 8 ? [[0, 7], [3, 4], [1, 6], [2, 5]] : [[0, 3], [1, 2]];
  pairs.forEach(([x, y], i) => check(first[i].a === seeds[x] && first[i].b === seeds[y], `${tag}: bracket match ${i + 1} is not seed ${x + 1} v ${y + 1}`));
  for (let r = 1; r < n.top.length; r++) {
    const prevWinners = n.top[r - 1].map(winnerOf);
    n.top[r].forEach((m, i) => check(m.a === prevWinners[2 * i] && m.b === prevWinners[2 * i + 1], `${tag}: bracket round ${r + 1} match ${i + 1} not fed by the right winners`));
  }
  for (const m of n.top.flat()) check(m.result === 'a' || m.result === 'b', `${tag}: top cut match ${m.id} has no winner`);
  check(n.top[n.top.length - 1].length === 1, `${tag}: bracket does not end in one final`);
  const pl = n.placements!;
  check(pl.length === n.size && new Set(pl).size === n.size, `${tag}: placements are not a permutation`);
  check(pl[0] === winnerOf(n.top[n.top.length - 1][0]), `${tag}: champion is not the final's winner`);
  check(new Set(pl.slice(0, cut)).size === cut && pl.slice(0, cut).every((id) => seeds.includes(id)), `${tag}: top ${cut} placings are not the top cut`);
}

const metaCount = new Map<string, number>();
let ids = 0;
let idsOffered = 0;
let drops = 0;
let byes = 0;
let timeDraws = 0;
let grants = 0;
const t0 = Date.now();
const sizes: FieldSize[] = [16, 24, 32];
for (let i = 0; i < NIGHTS; i++) {
  const size = sizes[i % 3];
  const seed = 1000 + i * 7919;
  const n = makeNight(size, seed);
  const tag = `night ${i + 1} (${size}p seed ${seed})`;
  check(n.swissRounds === (size === 16 ? 4 : 5), `${tag}: ${n.swissRounds} rounds for ${size} players`);
  check(n.entrants.length === size, `${tag}: ${n.entrants.length} entrants`);
  for (const e of n.entrants) if (!e.human) metaCount.set(metaLabel(e.meta, e.deck), (metaCount.get(metaLabel(e.meta, e.deck)) ?? 0) + 1);
  // play it out, taking any intentional draw offered to the player
  for (let guard = 0; guard < 40 && n.phase !== 'done'; guard++) {
    if (pendingHumanMatch(n)) {
      const offer = humanIdOffer(n);
      if (offer) {
        idsOffered++;
        acceptIntentionalDraw(n);
      } else simulateHumanMatch(n);
    }
    finishRound(n);
    advance(n);
  }
  check(n.phase === 'done', `${tag}: night did not finish`);
  verifySwiss(n, tag);
  verifyStandings(n, tag);
  verifyTop(n, tag);
  ids += n.rounds.flat().filter((m) => m.intentional).length;
  timeDraws += n.rounds.flat().filter((m) => m.time).length;
  drops += n.entrants.filter((e) => e.dropped != null).length;
  byes += n.rounds.flat().filter((m) => m.b == null).length;
  for (const m of n.rounds.flat().filter((x) => x.intentional)) {
    check(m.round === n.swissRounds, `${tag}: intentional draw outside the last round`);
  }
  // prizes: granted once, sensible amounts
  const got: PrizeGrant[] = [];
  finalizeNight(n, (g) => got.push(g));
  finalizeNight(n, (g) => got.push(g));
  grants += got.length;
  const lines = prizesFor(n);
  check(got.length === lines.filter((l) => l.packs || l.coins).length, `${tag}: prizes granted ${got.length} times`);
  check(got.every((g) => g.reason.startsWith('Locals Night · ')), `${tag}: prize reason format`);
  const place = n.placements!.indexOf(n.humanId) + 1;
  if (place === 1) check(got.some((g) => g.packs === 12), `${tag}: champion did not get 12 packs`);
  // every entrant's prize lines are well-formed
  for (const e of n.entrants) check(prizesFor(n, e.id).some((l) => l.reason === 'Locals Night · Participation'), `${tag}: ${e.id} has no participation prize`);
}

// determinism: the same seed plays the same night
{
  const a = makeNight(24, 4242);
  const b = makeNight(24, 4242);
  runToEnd(a, { autoPlayHuman: true });
  runToEnd(b, { autoPlayHuman: true });
  check(JSON.stringify(a.placements) === JSON.stringify(b.placements), 'same seed produced different placements');
}

// a forced odd field: drop one player before round two and check the bye
{
  const n = makeNight(16, 777);
  simulateHumanMatch(n);
  finishRound(n);
  n.entrants[5].dropped = 1;
  advance(n);
  const r2 = n.rounds[1];
  check(r2.filter((m) => m.b == null).length === 1, 'odd field: round two has no bye');
  check(!r2.some((m) => m.a === n.entrants[5].id || m.b === n.entrants[5].id), 'odd field: dropped player was paired');
  runToEnd(n, { autoPlayHuman: true });
  verifySwiss(n, 'odd field');
  verifyStandings(n, 'odd field');
  verifyTop(n, 'odd field');
}

const total = [...metaCount.values()].reduce((a, b) => a + b, 0);
const mix = [...metaCount].sort((a, b) => b[1] - a[1]);
const share = (label: string) => (metaCount.get(label) ?? 0) / total;
check(share('Plant Synchro') > share('Zombies') && share('Blackwings') > share('Hero Beat'), 'meta mix: Plants/Blackwings are not above the second tier');

console.log(`Locals Night: ${NIGHTS} nights simulated in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
console.log(`  ${ids} intentional draws (${idsOffered} offered to you), ${timeDraws} time draws, ${drops} drops, ${byes} byes, ${grants} prize grants`);
console.log(`  field mix: ${mix.map(([k, v]) => `${k} ${Math.round((v / total) * 100)}%`).join(', ')}`);
console.log(`  ${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log('  ✗ ' + f);
process.exit(failures.length ? 1 : 0);
