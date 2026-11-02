// The judge's book (src/cards/rulings.generated.ts, read by ui/duel/judge.ts): up to date with the ruling comments in
// the card scripts, every entry a real card with a real source, and the text written for players (no code words).
// Usage: npx tsx scripts/judge-test.ts
import { execFileSync } from 'node:child_process';
import { allCards } from '../src/cards';
import { RULINGS } from '../src/cards/rulings.generated';
import { AIController } from '../src/ai/ai';
import { PREMADE_DECKS, buildDeckList } from '../src/decks';
import { Game } from '../src/engine/game';
import type { CardInstance } from '../src/engine/card';
import { GameOver } from '../src/engine/game';
import { cardsInQuestion, searchCards } from '../src/ui/duel/judgeBook';

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

// card search
check(searchCards('judgment dragon')[0] === 'Judgment Dragon', 'search: exact name first');
check(searchCards('treeborn').includes('Treeborn Frog'), 'search: starts-with');
check(searchCards('').length === 0 && searchCards('zzqqxx').length === 0, 'search: nothing for empty or unknown text');

// The judge only names cards the asking player can see: never a card the opponent drew, Set or holds.
// (Regression: it used to read every recent event, so it could name the opponent's hand and face-down cards.)
await (async () => {
  let asked = 0;
  let hiddenSeen = 0;
  for (let k = 0; k < 4; k++) {
    const decks = [buildDeckList(PREMADE_DECKS[k % PREMADE_DECKS.length]), buildDeckList(PREMADE_DECKS[(k + 3) % PREMADE_DECKS.length])] as const;
    const ais = [new AIController('normal', 11 + k), new AIController('normal', 23 + k)] as const;
    const g = new Game([...decks], [...ais], { seed: 100 + k, maxTurns: 14 });
    const probe = () => {
      for (const viewer of [0, 1, null] as const) {
        asked++;
        const names = cardsInQuestion(g, null, viewer, 50);
        const visible = new Set(g.allCards.filter((c: CardInstance) => g.seenBy(c, viewer)).map((c: CardInstance) => c.name));
        for (const n of names) check(visible.has(n), `judge named ${n}, which seat ${viewer} can't see (turn ${g.turn})`);
        for (const ev of g.eventLog.slice(-30)) {
          const c = ev.card as CardInstance | undefined;
          if (c && typeof c.name === 'string' && !g.seenBy(c, viewer)) hiddenSeen++;
        }
      }
    };
    const orig = g.emit.bind(g);
    let n = 0;
    (g as unknown as { emit: typeof g.emit }).emit = ((...a: Parameters<typeof g.emit>) => {
      const r = orig(...a);
      if (++n % 7 === 0) probe();
      return r;
    }) as typeof g.emit;
    try {
      await g.start();
    } catch (e) {
      if (!(e instanceof GameOver)) throw e;
    }
  }
  check(asked > 100, `judge asked often enough (${asked})`);
  check(hiddenSeen > 0, 'the duels had hidden cards in recent events to hide');
})();

if (failures.length) {
  console.log(`judge-test: ${passed} passed, ${failures.length} FAILED`);
  for (const f of failures.slice(0, 30)) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log(`judge-test: all ${passed} checks passed`);
