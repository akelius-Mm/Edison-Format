import '../src/cards';
import { normal } from '../src/cards/define';
import { cardByName } from '../src/cards';
import { AIController } from '../src/ai/ai';
import { Game } from '../src/engine/game';
normal('Smoke Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000);
normal('Smoke Test Wall', 'EARTH', 'Rock', 4, 500, 2000);
normal('Smoke Test Tuner', 'EARTH', 'Warrior', 2, 800, 800).mtypes!.push('tuner');
const names = ['Mystical Space Typhoon','Heavy Storm','Dark Hole','Monster Reborn','Pot of Avarice','Book of Moon','Brain Control','Limiter Removal','Scapegoat','Mirror Force','Bottomless Trap Hole','Solemn Judgment','Call of the Haunted','Royal Oppression','Gravity Bind','Sangan','Card Trooper','Cyber Dragon','Dark Armed Dragon','Morphing Jar','Treeborn Frog','Honest'];
const main = [...names.map(cardByName), ...Array(8).fill(cardByName('Smoke Test Brute')), ...Array(5).fill(cardByName('Smoke Test Wall')), ...Array(6).fill(cardByName('Smoke Test Tuner'))];
const extra = [cardByName('Goyo Guardian'), cardByName('Brionac, Dragon of the Ice Barrier')];
const errs: string[] = [];
console.error = (...a: any[]) => errs.push(a.map(String).join(' '));
(async () => {
  let w = [0, 0, 0];
  const N = Number(process.argv[2] ?? 30);
  for (let i = 0; i < N; i++) {
    const g = new Game([{ main, extra }, { main, extra }], [new AIController('normal', i), new AIController('hard', i + 1)], { seed: i, maxTurns: 60 });
    if (process.argv[3]) g.hooks.log = (e) => console.log(`[T${e.turn}] ${e.text}`);
    const r = await g.start();
    w[r.winner === null ? 2 : r.winner]++;
    if (process.argv[3]) console.log(r);
  }
  console.log('results', w, 'errors', [...new Set(errs)].slice(0, 10));
})();
