// "Smart" response prompts (src/ui/duel/promptRules.ts): the duel stops to ask a human about real tricks in the quiet
// phase windows and after the opponent summons, and stays quiet when there is nothing worth asking.
// Usage: npx tsx scripts/prompt-test.ts
import '../src/cards';
import { cardByName } from '../src/cards';
import type { CardData } from '../src/engine/card';
import type { WindowKind } from '../src/engine/controller';
import { Ctx } from '../src/engine/ctx';
import { Game } from '../src/engine/game';
import type { Location, Phase, PlayerId } from '../src/engine/types';
import { AIController } from '../src/ai/ai';
import { smartPrompt } from '../src/ui/duel/promptRules';

let pass = 0;
let fail = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (ok) pass++;
  else fail++;
};

function setup(turnPlayer: PlayerId, phase: Phase) {
  const filler: CardData = cardByName('Sangan');
  const g = new Game(
    [
      { main: Array(20).fill(filler), extra: [] },
      { main: Array(20).fill(filler), extra: [] },
    ],
    [new AIController('normal'), new AIController('normal')],
    { seed: 3 },
  );
  g.turn = 4;
  g.turnPlayer = turnPlayer;
  g.phase = phase;
  const place = (p: PlayerId, name: string, loc: Location, faceUp = loc !== 'szone') => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(cardByName(name), p));
    c.location = 'none';
    g.rawMove(c, loc, { controller: p, faceUp, pos: 'atk' });
    c.setTurn = 0;
    c.summonTurn = 0;
    return c;
  };
  return { g, place };
}

/** Would player 0 be asked in this window (as the duel screen decides with "Smart" prompts)? */
function asked(g: Game, kind: WindowKind) {
  const options = g.getActivations(0, { open: false, window: kind });
  const aiScore = (o: (typeof options)[0]) => {
    try {
      const ctx = new Ctx(g, o.card, o.effect, 0);
      ctx.effectIndex = o.effectIndex;
      ctx.event = o.event;
      return o.effect.ai?.score?.(ctx) ?? 0;
    } catch {
      return 0;
    }
  };
  return { legal: options.length > 0, asked: smartPrompt(g, 0, { kind, options, prompt: '' }, aiScore) };
}

console.log('Smart prompts: your own Standby Phase');
{
  const { g, place } = setup(0, 'standby');
  place(0, 'Enemy Controller', 'hand');
  place(0, 'Sangan', 'mzone');
  place(1, 'Dark Armed Dragon', 'mzone');
  const r = asked(g, 'phase');
  check(r.legal && r.asked, 'Enemy Controller in hand (Tribute: take control) is offered');
}
{
  const { g, place } = setup(0, 'standby');
  place(0, 'Book of Moon', 'hand');
  place(1, 'Dark Armed Dragon', 'mzone');
  const r = asked(g, 'phase');
  check(r.legal && r.asked, 'Book of Moon in hand is offered');
}
{
  const { g, place } = setup(0, 'standby');
  place(0, 'Mystical Space Typhoon', 'hand');
  place(1, 'Mirror Force', 'szone', false);
  check(asked(g, 'phase').asked, 'Mystical Space Typhoon in hand on a Set card is offered');
}
{
  const { g, place } = setup(0, 'draw');
  place(0, 'Book of Moon', 'hand');
  place(1, 'Dark Armed Dragon', 'mzone');
  check(!asked(g, 'phase').asked, 'not asked in your Draw Phase (only the Standby Phase)');
}
{
  const { g, place } = setup(0, 'standby');
  place(0, 'Book of Moon', 'hand');
  check(!asked(g, 'phase').legal, 'nothing to target: not offered at all');
}

console.log("Smart prompts: the opponent's Standby and End Phases");
{
  const { g, place } = setup(1, 'standby');
  place(0, 'Book of Moon', 'szone', false);
  place(1, 'Dark Armed Dragon', 'mzone');
  check(asked(g, 'phase').asked, "Set Book of Moon in the opponent's Standby Phase");
}
{
  const { g, place } = setup(1, 'standby');
  place(0, 'Phoenix Wing Wind Blast', 'szone', false);
  place(0, 'Sangan', 'hand');
  place(1, 'Dark Armed Dragon', 'mzone');
  check(asked(g, 'phase').asked, "Set Phoenix Wing Wind Blast in the opponent's Standby Phase");
}
{
  const { g, place } = setup(1, 'end');
  place(0, 'Emergency Teleport', 'szone', false);
  place(0, 'Krebons', 'deck');
  check(asked(g, 'phase').asked, "Set Emergency Teleport in the opponent's End Phase");
}
{
  const { g, place } = setup(1, 'end');
  place(0, 'Call of the Haunted', 'szone', false);
  place(0, 'Caius the Shadow Monarch', 'grave');
  check(asked(g, 'phase').asked, "Set Call of the Haunted in the opponent's End Phase (still asked)");
}
{
  const { g, place } = setup(1, 'draw');
  place(0, 'Book of Moon', 'szone', false);
  place(1, 'Dark Armed Dragon', 'mzone');
  check(!asked(g, 'phase').asked, "not asked in the opponent's Draw Phase");
}

console.log('Smart prompts: right after the opponent summons');
{
  const { g, place } = setup(1, 'main1');
  place(0, 'Book of Moon', 'szone', false);
  const m = place(1, 'Dark Armed Dragon', 'mzone');
  g.recentEvents = [{ type: 'summoned', card: m, player: 1 } as any];
  check(asked(g, 'response').asked, 'Set Book of Moon in response to a summon');
  check(asked(g, 'priority').asked, "Set Book of Moon in the summon's priority window");
}
{
  const { g, place } = setup(1, 'main1');
  place(0, 'Threatening Roar', 'szone', false);
  const m = place(1, 'Sangan', 'mzone');
  g.recentEvents = [{ type: 'summoned', card: m, player: 1 } as any];
  const r = asked(g, 'response');
  check(r.legal && !r.asked, 'a Set Threatening Roar does not interrupt every summon');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
