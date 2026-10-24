import { AIController } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { deckById, buildDeckList } from '../src/decks';
const errs: string[] = [];
console.error = (...a: any[]) => errs.push(a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' '));
const mk = (cards: [string, number][]) => buildDeckList({ main: cards, extra: [['Elemental Hero Flame Wingman', 2], ['Elemental Hero Steam Healer', 1], ['Elemental Hero Absolute Zero', 1], ['Stardust Dragon', 1]] });
const test1 = mk([
  ['Destiny Hero - Diamond Dude', 3], ['Destiny Hero - Dogma', 3], ['Destiny Hero - Disk Commander', 3], ['Destiny Draw', 3], ['Destiny Hero - Malicious', 3],
  ['Flip Flop Frog', 3], ['Des Frog', 3], ['T.A.D.P.O.L.E.', 3], ['Granmarg the Rock Monarch', 3], ['Frog the Jam', 2],
  ['Pot of Greed', 3], ['Monster Reborn', 1], ['Polymerization', 3], ['Upstart Goblin', 3], ['Card Destruction', 1],
]);
const test3 = mk([
  ['Destiny Hero - Diamond Dude', 3], ['Destiny Hero - Dogma', 3], ['Upstart Goblin', 3], ['Pot of Greed', 3], ['Scapegoat', 1], ['Dark Hole', 1], ['Destiny Draw', 3],
  ['Destiny Hero - Malicious', 3], ['Armageddon Knight', 3], ['Card Destruction', 1], ['Monster Reborn', 1], ['Destiny Hero - Disk Commander', 3], ['Foolish Burial', 3], ['Hand Destruction', 3], ['Sangan', 3], ['Spirit Reaper', 3],
]);
const test2 = mk([
  ['Elemental Hero Captain Gold', 3], ['Skyscraper', 3], ['A Hero Emerges', 3], ['Hero Barrier', 3], ['Elemental Hero Woodsman', 3],
  ['Elemental Hero Avian', 3], ['Elemental Hero Burstinatrix', 3], ['Elemental Hero Bubbleman', 3], ['Elemental Hero Sparkman', 2], ['Elemental Hero Clayman', 2],
  ['Polymerization', 3], ['Miracle Fusion', 3], ['Emergency Teleport', 1], ['Krebons', 3], ['Psychic Commander', 2],
]);
(async () => {
  const n = Number(process.argv[2] ?? 10);
  const log: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = new Game([process.argv[3] === '3' ? test3 : i % 2 ? test1 : test2, buildDeckList(deckById(i % 3 ? 'hero-beat' : 'frog-monarchs')!)], [new AIController('normal', i), new AIController('hard', i + 7)], { seed: i + 1, names: ['Test', 'Opp'], maxTurns: 40 });
    g.hooks.log = (e) => log.push(`[T${e.turn}] ${e.text}`);
    try { await g.start(); } catch (e) { console.log('CRASH', (e as Error).stack); }
  }
  console.log([...new Set(errs)].slice(0, 10).join('\n') || 'no errors');
  (await import('fs')).writeFileSync('/tmp/claude-0/scratch/test.log', log.join('\n'));
})();
