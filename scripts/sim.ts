// Headless AI-vs-AI duel runner used to smoke-test the engine and card scripts.
// Usage: npx tsx scripts/sim.ts [--games N] [--deck id] [--vs id] [--seed S] [--verbose] [--log]
import { AIController } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { PREMADE_DECKS, buildDeckList, validateDeck, type DeckDef } from '../src/decks';
import { findCard } from '../src/cards';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const games = Number(arg('games', '20'));
const deckFilter = arg('deck');
const vsFilter = arg('vs');
const seed0 = Number(arg('seed', '1'));
const verbose = args.includes('--verbose');
const showLog = args.includes('--log');

let errors: string[] = [];
const origError = console.error;
console.error = (...a: any[]) => {
  errors.push(a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' '));
  if (verbose) origError(...a);
};

const decks: DeckDef[] = PREMADE_DECKS.length
  ? PREMADE_DECKS
  : [];
if (!decks.length) {
  console.log('No premade decks registered yet.');
  process.exit(0);
}
for (const d of decks) {
  const problems = validateDeck(d);
  const missing = [...d.main, ...d.extra].filter(([n]) => !findCard(n)).map(([n]) => n);
  if (problems.length || missing.length) console.log(`[deck ${d.id}] ${[...problems, ...missing.map((m) => 'missing ' + m)].join('; ')}`);
}

const pool = deckFilter ? decks.filter((d) => d.id === deckFilter) : decks;
const vsPool = vsFilter ? decks.filter((d) => d.id === vsFilter) : decks;
const stats = new Map<string, { w: number; l: number; d: number }>();
const st = (id: string) => stats.get(id) ?? (stats.set(id, { w: 0, l: 0, d: 0 }), stats.get(id)!);
let totalTurns = 0;
let crashes = 0;
const started = Date.now();

async function runOne(a: DeckDef, b: DeckDef, seed: number) {
  const g = new Game([buildDeckList(a), buildDeckList(b)], [new AIController('normal', seed), new AIController('hard', seed + 7)], {
    seed,
    names: [a.name, b.name],
    maxTurns: 60,
  });
  if (showLog) g.hooks.log = (e) => console.log(`  [T${e.turn}] ${e.text}`);
  errors = [];
  const t0 = Date.now();
  let res;
  try {
    res = await Promise.race([
      g.start(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT (possible infinite loop)')), 20000)),
    ]);
  } catch (e) {
    crashes++;
    console.log(`CRASH ${a.id} vs ${b.id} seed ${seed}: ${(e as Error).stack}`);
    console.log('  last log lines:\n' + g.logEntries.slice(-15).map((l) => '    ' + l.text).join('\n'));
    return;
  }
  totalTurns += res.turns;
  if (res.winner === 0) {
    st(a.id).w++;
    st(b.id).l++;
  } else if (res.winner === 1) {
    st(b.id).w++;
    st(a.id).l++;
  } else {
    st(a.id).d++;
    st(b.id).d++;
  }
  const uniq = [...new Set(errors)];
  if (uniq.length) {
    console.log(`ERRORS in ${a.id} vs ${b.id} seed ${seed}:`);
    for (const e of uniq.slice(0, 5)) console.log('  ' + e.split('\n').slice(0, 4).join('\n  '));
  }
  if (verbose) console.log(`${a.id} vs ${b.id}: winner ${res.winner} (${res.reason}) in ${res.turns} turns, ${Date.now() - t0}ms`);
}

(async () => {
  let n = 0;
  for (let i = 0; i < games; i++) {
    const a = pool[i % pool.length];
    const b = vsPool[(i * 7 + 3) % vsPool.length];
    await runOne(a, b, seed0 + i);
    n++;
  }
  console.log(`\n${n} games, ${crashes} crashes, avg ${(totalTurns / Math.max(1, n - crashes)).toFixed(1)} turns, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const [id, s] of [...stats].sort((x, y) => y[1].w - x[1].w)) console.log(`  ${id.padEnd(24)} ${s.w}-${s.l}-${s.d}`);
  process.exit(crashes ? 1 : 0);
})();
