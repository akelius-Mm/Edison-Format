// The judge's book (src/cards/rulings.generated.ts, read by ui/duel/judge.ts): up to date with the ruling comments in
// the card scripts, every entry a real card with a real source, and the text written for players (no code words).
// Usage: npx tsx scripts/judge-test.ts
import { execFileSync } from 'node:child_process';
import { allCards } from '../src/cards';
import { RULINGS } from '../src/cards/rulings.generated';

let passed = 0;
const failures: string[] = [];
const check = (ok: boolean, msg: string) => (ok ? passed++ : failures.push(msg));

// regenerating gives the same file
try {
  execFileSync('npx', ['tsx', 'scripts/extract-rulings.ts', '--check'], { stdio: 'pipe' });
  passed++;
} catch (e) {
  failures.push(`rulings.generated.ts is out of date: ${String((e as { stdout?: Buffer }).stdout ?? e)}`);
}
const names = new Set(allCards().map((c) => c.name));
const entries = Object.entries(RULINGS);
check(entries.length > 300, `rulings for more than 300 cards (got ${entries.length})`);
for (const [card, notes] of entries) {
  check(names.has(card), `${card}: not a card in the pool`);
  for (const n of notes) {
    check(/^https:\/\/(edisonrul\.ing|www\.edisonformat\.com)\//.test(n.url), `${card}: source ${n.url}`);
    check(n.text.length >= 20 && !/src\/|`|\bctx\b|dataMod|canActivate/.test(n.text), `${card}: note reads like code: ${n.text.slice(0, 80)}`);
  }
}
// spot checks: cards whose 2010 rulings are cited next to their code
for (const card of ['Fortune Lady Wind', 'Treeborn Frog', 'Blackwing Armor Master', "Koa'ki Meiru Drago"]) check((RULINGS[card] ?? []).length > 0, `${card}: has its 2010 ruling`);

if (failures.length) {
  console.log(`judge-test: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures.slice(0, 30)) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`judge-test: all ${passed} checks passed`);
