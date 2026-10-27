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

/** The AI's score for player 0's activation of `card` in the current state (0 = it won't use it). */
function aiScoreOf(g: Game, card: any) {
  const ef = card.data.effects[0];
  const ctx = new Ctx(g, card, ef, 0);
  return ef.ai?.score?.(ctx) ?? 0;
}
/** Pretend `card` (player 1's) is being activated: Chain Link 1. */
function activating(g: Game, card: any) {
  card.faceUp = true;
  g.chain.push({ index: 1, card, effect: card.data.effects[0], effectIndex: 0, player: 1, ctx: new Ctx(g, card, card.data.effects[0], 1), negated: false, speed: 1, isCardActivation: true, fromLocation: 'szone' } as any);
}

console.log('AI Spell/Trap removal (MST, Dust Tornado, Breaker)');
{
  const { g, place } = setup(1, 'main1');
  const mst = place(0, 'Mystical Space Typhoon', 'hand');
  const pot = place(1, 'Pot of Avarice', 'szone');
  activating(g, pot);
  check(aiScoreOf(g, mst) === 0, "MST is not chained to the opponent's Normal Spell (it resolves anyway)");
  const set = place(1, 'Mirror Force', 'szone', false);
  check(aiScoreOf(g, mst) === 0, 'and not just because a window opened while they have a Set card');
  void set;
}
{
  const { g, place } = setup(1, 'main1');
  const mst = place(0, 'Mystical Space Typhoon', 'hand');
  const bind = place(1, 'Gravity Bind', 'szone');
  activating(g, bind);
  check(aiScoreOf(g, mst) > 0, 'MST answers an opponent activating a Continuous Trap (destroying it stops it)');
  const dt = place(0, 'Dust Tornado', 'szone', false);
  check(aiScoreOf(g, dt) > 0, 'Dust Tornado answers an opponent activating a Continuous Trap (destroying it stops it)');
}
{
  const { g, place } = setup(0, 'main1');
  const mst = place(0, 'Mystical Space Typhoon', 'hand');
  const set = place(1, 'Mirror Force', 'szone', false);
  check(aiScoreOf(g, mst) > 0, 'MST clears a Set card in your own Main Phase 1');
  const ef = (mst.data.effects as any)[0];
  const picks: any[] = [];
  const ctx = new Ctx(g, mst, ef, 0);
  (g.players[0] as any);
  // the AI target preference: the Set card over a face-up Book of Moon that has no lasting effect
  const { stRemovalScore } = await import('../src/cards/helpers');
  check(stRemovalScore(ctx, set) > 0, 'a Set card is a target');
  const swords = place(1, 'Swords of Revealing Light', 'szone', true);
  check(stRemovalScore(ctx, swords) > 0, 'a face-up Swords of Revealing Light staying on the field is a target');
  activating(g, swords);
  check(stRemovalScore(ctx, swords) < 0, 'but not while it is being activated (it resolves anyway)');
  void picks;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
