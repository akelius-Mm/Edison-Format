import { AIController } from '../src/ai/ai';
import { Game } from '../src/engine/game';
import { deckById, buildDeckList } from '../src/decks';
const [a, b, seedS, nS] = process.argv.slice(2);
(async () => {
  for (let i = 0; i < Number(nS ?? 1); i++) {
    const seed = Number(seedS ?? 1) + i;
    const A = deckById(a)!, B = deckById(b)!;
    const g = new Game([buildDeckList(A), buildDeckList(B)], [new AIController('normal', seed), new AIController('hard', seed + 7)], { seed, names: [A.name, B.name], maxTurns: 60 });
    g.hooks.log = (e) => {
      if (e.text === 'Main Phase 1') {
        const p = g.players[g.turnPlayer];
        console.log(`  [T${e.turn}] ${p.name} HAND: ${p.hand.map((c) => c.name).join(' | ')} || GY DARK=${p.grave.filter((c) => c.data.attribute === 'DARK' && c.isMonster).length} field=${g.monsters(g.turnPlayer).map((c) => c.name).join(',')} st=${g.spellTraps(g.turnPlayer).length}`);
      }
      if (!/Draw Phase|Standby Phase|End Phase|Main Phase 2/.test(e.text)) console.log(`  [T${e.turn}] ${e.text}`);
    };
    const r = await g.start();
    console.log('RESULT', r.winner, r.reason);
  }
})();
