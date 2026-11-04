// `npm test`: every Node test script, one after another, stopping at the first failure.
// Usage: npx tsx scripts/test.ts [filter]   (filter: run only the scripts whose path contains it, e.g. "rulings/")
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

/** Card rulings regression tests: one per rules fix, each citing its edisonrul.ing page. */
const rulings = readdirSync(join(ROOT, 'scripts/rulings'))
  .filter((f) => f.endsWith('.ts'))
  .sort()
  .map((f) => [`scripts/rulings/${f}`]);

const SUITE: string[][] = [
  // the rules engine and the cards
  ['scripts/rules-test.ts'],
  ['scripts/core-rules-test.ts'],
  ['scripts/chainless-test.ts'],
  ['scripts/facedown-reset-test.ts'],
  ['scripts/hidden-info-test.ts'],
  ['scripts/format-pages-test.ts'],
  ...rulings,
  ['scripts/extract-rulings.ts', '--check'],
  ['scripts/rulings-db-test.ts'],
  ['scripts/judge-test.ts'],
  // whole duels: determinism, undo, replays, AI
  ['scripts/prompt-test.ts'],
  ['scripts/undo-test.ts', '--games', '30'],
  ['scripts/replay-test.ts', '--games', '40'],
  ['scripts/sim.ts', '--games', '40'],
  ['scripts/ai-removal-test.ts'],
  ['scripts/ai-planner-test.ts'],
  ['scripts/ai-strength.ts', '--games', '32'],
  // the app around the duel
  ['scripts/pack-odds-test.ts'],
  ['scripts/locals-test.ts'],
  ['scripts/draft-setup-test.ts'],
  ['scripts/events-test.ts'],
  ['scripts/crash-guard-test.ts'],
  ['scripts/side-deck-test.ts'],
  ['scripts/net-test.ts'],
  ['scripts/tourney-test.ts'],
  ['scripts/backup-test.ts'],
  ['scripts/market-test.ts'],
  ['scripts/mat-unlock-test.ts'],
  ['scripts/official-art-test.ts'],
  ['scripts/settings-art-test.ts'],
];

const filter = process.argv[2];
const runs = SUITE.filter(([script]) => !filter || script.includes(filter));
const started = Date.now();
for (const [script, ...args] of runs) {
  console.log(`\n▶ ${[script, ...args].join(' ')}`);
  const r = spawnSync(TSX, [script, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✗ ${script} failed (exit ${r.status ?? r.signal})`);
    process.exit(1);
  }
}
console.log(`\n✓ ${runs.length} test scripts passed in ${Math.round((Date.now() - started) / 1000)}s`);
