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
  check(aiScoreOf(g, mst) <= 0, "MST is not chained to the opponent's Normal Spell (it resolves anyway)");
  const set = place(1, 'Mirror Force', 'szone', false);
  check(aiScoreOf(g, mst) <= 0, 'and not just because a window opened while they have a Set card');
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

// ------------------------------------------------------------------ AI blunders (scripts/ai-blunders.ts)

/** The AI's score for player p's activation of `card`'s effect i, through the AI core (card hint + generic guards). */
function coreScore(g: Game, card: any, i = 0, window = 'chain', p: PlayerId = 0, event?: any) {
  const ai = g.controllers[p] as any;
  return ai.effectScore(g, p, { card, effect: card.data.effects[i], effectIndex: i, label: '', event }, window) as number;
}
/** player 1's `attacker` attacks (target null = directly). */
function attack(g: Game, attacker: any, target: any = null) {
  g.battle = { attacker, target, attackerMoveId: attacker.moveId, targetMoveId: target?.moveId ?? 0, negated: false, inDamageStep: false, oppMonsterCount: 0 } as any;
}
/** Push a chain link for `card` (player p) with these targets / event. */
function link(g: Game, card: any, p: PlayerId, targets: any[] = [], event?: any, i = 0) {
  const ctx = new Ctx(g, card, card.data.effects[i], p);
  ctx.targets = targets;
  ctx.event = event;
  card.faceUp = true;
  const l = { index: g.chain.length + 1, card, effect: card.data.effects[i], effectIndex: i, player: p, ctx, negated: false, speed: 2, isCardActivation: card.isSpell || card.isTrap, fromLocation: card.location } as any;
  ctx.link = l;
  g.chain.push(l);
  return l;
}
const actOf = (card: any, i = 0) => ({ card, effect: card.data.effects[i], effectIndex: i, label: '' });

console.log('\nAI: MST never "saves" itself onto its own cards');
{
  const { g, place } = setup(1, 'main1');
  const mst = place(0, 'Mystical Space Typhoon', 'szone', false);
  const own = place(0, 'Mirror Force', 'szone', false);
  const theirMst = place(1, 'Mystical Space Typhoon', 'szone');
  link(g, theirMst, 1, [mst]);
  check(aiScoreOf(g, mst) < 0, 'a targeted Set MST with no worthwhile target stays put (-1, not "use it or lose it")');
  check(coreScore(g, mst) < 30, 'and the AI core does not chain it');
  const { stRemovalScore } = await import('../src/cards/helpers');
  const ctx = new Ctx(g, mst, (mst.data.effects as any)[0], 0);
  check(stRemovalScore(ctx, own) < stRemovalScore(ctx, theirMst), 'its own Set card ranks below even an opponent card that resolves anyway');
}

console.log('\nAI: Book of Moon hits the monster that matters');
{
  const { g, place } = setup(1, 'battle');
  const book = place(0, 'Book of Moon', 'szone', false);
  place(1, 'Cyber Dragon', 'mzone');
  const attacker = place(1, 'Dark Armed Dragon', 'mzone');
  place(1, 'Stardust Dragon', 'mzone');
  attack(g, attacker);
  check(aiScoreOf(g, book) > 0, 'Book of Moon answers a big direct attack');
  const l = await g.activate(0, actOf(book));
  check(!!l && l.ctx.targets[0] === attacker, 'and targets the attacker, not a bigger monster that is not attacking');
}
{
  const { g, place } = setup(1, 'main1');
  const book = place(0, 'Book of Moon', 'szone', false);
  place(0, 'Cyber Dragon', 'mzone');
  const trooper = place(1, 'Card Trooper', 'mzone');
  link(g, trooper, 1);
  check(aiScoreOf(g, book) === 0, "not in response to a small monster's effect (Card Trooper milling)");
  g.chain.length = 0;
  const dad = place(1, 'Dark Armed Dragon', 'mzone');
  link(g, dad, 1);
  check(aiScoreOf(g, book) > 0, "but in response to Dark Armed Dragon's effect");
  const l = await g.activate(0, actOf(book));
  check(!!l && l.ctx.targets[0] === dad, 'targeting that monster (not the more valuable-looking one next to it)');
}
{
  const { g, place } = setup(1, 'main1');
  const book = place(0, 'Book of Moon', 'szone', false);
  place(0, 'Cyber Dragon', 'mzone');
  const theirMst = place(1, 'Mystical Space Typhoon', 'szone');
  link(g, theirMst, 1, [book]);
  check(aiScoreOf(g, book) < 0 && coreScore(g, book) < 30, 'with only our own face-up monsters, a targeted Book of Moon is not chained (it would flip our own)');
}
{
  const { g, place } = setup(1, 'battle');
  const book = place(0, 'Book of Moon', 'szone', false);
  const dp = place(0, 'Dimensional Prison', 'szone', false);
  const attacker = place(1, 'Dark Armed Dragon', 'mzone');
  place(1, 'Cyber Dragon', 'mzone');
  attack(g, attacker);
  link(g, dp, 0, [attacker], { type: 'attackDeclared', card: attacker });
  check(coreScore(g, book) < 30, 'not on top of our own Dimensional Prison that already banishes the attacker');
}

console.log('\nAI: no second answer to a card our own chain already answers');
{
  const { g, place } = setup(1, 'main1');
  const bth1 = place(0, 'Bottomless Trap Hole', 'szone', false);
  const bth2 = place(0, 'Bottomless Trap Hole', 'szone', false);
  const dad = place(1, 'Dark Armed Dragon', 'mzone');
  const ev = { type: 'summoned', card: dad, player: 1 };
  check(coreScore(g, bth2, 0, 'response', 0, ev) >= 30, 'Bottomless Trap Hole answers a Dark Armed Dragon summon');
  link(g, bth1, 0, [], ev);
  check(coreScore(g, bth2, 0, 'chain', 0, ev) < 0, 'but a second Bottomless Trap Hole on the same summon is not chained');
}
{
  const { g, place } = setup(1, 'battle');
  const mf = place(0, 'Mirror Force', 'szone', false);
  const dp = place(0, 'Dimensional Prison', 'szone', false);
  const attacker = place(1, 'Dark Armed Dragon', 'mzone');
  attack(g, attacker);
  const ev = { type: 'attackDeclared', card: attacker, player: 1 };
  link(g, dp, 0, [attacker], ev);
  check(coreScore(g, mf, 0, 'chain', 0, ev) < 0, 'nor Mirror Force after our Dimensional Prison took the only attacker');
}

console.log('\nAI: removal is not spent on a monster worth less than a card');
{
  const { g, place } = setup(1, 'battle');
  const dp = place(0, 'Dimensional Prison', 'szone', false);
  const sak = place(0, 'Sakuretsu Armor', 'szone', false);
  const mf = place(0, 'Mirror Force', 'szone', false);
  const dandy = place(1, 'Dandylion', 'mzone');
  attack(g, dandy);
  check(aiScoreOf(g, dp) === 0 && aiScoreOf(g, sak) === 0 && aiScoreOf(g, mf) === 0, 'Dimensional Prison / Sakuretsu Armor / Mirror Force let a 300-ATK Dandylion poke for 300');
  const dad = place(1, 'Dark Armed Dragon', 'mzone');
  attack(g, dad);
  check(aiScoreOf(g, dp) > 0 && aiScoreOf(g, mf) > 0, 'but answer a Dark Armed Dragon attack');
}
{
  const { g, place } = setup(0, 'main1');
  const fis = place(0, 'Fissure', 'hand');
  const sg = place(0, 'Smashing Ground', 'hand');
  place(1, 'Ryko, Lightsworn Hunter', 'mzone');
  check(aiScoreOf(g, fis) === 0 && aiScoreOf(g, sg) === 0, 'Fissure / Smashing Ground are not spent on a lone Ryko');
}
{
  const { g, place } = setup(0, 'main2');
  const bc = place(0, 'Brain Control', 'hand');
  place(1, 'Dark Armed Dragon', 'mzone');
  check(aiScoreOf(g, bc) === 0, 'no 800 LP Brain Control in Main Phase 2 with nothing to use the monster for');
  g.phase = 'main1';
  check(aiScoreOf(g, bc) > 0, 'but in Main Phase 1, to attack with it');
}
{
  const { g, place } = setup(1, 'main1');
  const tt = place(0, 'Torrential Tribute', 'szone', false);
  place(0, 'Dark Armed Dragon', 'mzone');
  place(0, 'Cyber Dragon', 'mzone');
  const dandy = place(1, 'Dandylion', 'mzone');
  const theirMst = place(1, 'Mystical Space Typhoon', 'szone');
  link(g, theirMst, 1, [tt]);
  check(aiScoreOf(g, tt) < 0 && coreScore(g, tt, 0, 'chain', 0, { type: 'summoned', card: dandy }) < 30, 'a targeted Torrential Tribute is not "saved" by wiping our bigger board');
}

console.log('\nAI: searches and summons that do nothing');
{
  const { g, place } = setup(0, 'main1');
  place(0, 'Thunder King Rai-Oh', 'mzone');
  const rota = place(0, 'Reinforcement of the Army', 'hand');
  place(0, 'Exiled Force', 'deck');
  check(aiScoreOf(g, rota) > 0 && coreScore(g, rota, 0, 'main') < 0, 'no search while our own Thunder King Rai-Oh stops adding from the Deck');
}
{
  const { g, place } = setup(0, 'main1');
  const rota = place(0, 'Reinforcement of the Army', 'hand');
  const rai = place(0, 'Thunder King Rai-Oh', 'hand');
  const ai = g.controllers[0] as any;
  const withSearch = ai.scoreSummon(g, 0, rai, false);
  g.players[0].hand = g.players[0].hand.filter((c) => c !== rota);
  check(withSearch < ai.scoreSummon(g, 0, rai, false) && withSearch < 55, 'Thunder King Rai-Oh is summoned after our searches, not before');
}
{
  const { g, place } = setup(0, 'main1');
  place(1, 'Thunder King Rai-Oh', 'mzone');
  const fortress = place(0, 'Machina Fortress', 'hand');
  const stardust = place(0, 'Stardust Dragon', 'extra');
  const ai = g.controllers[0] as any;
  check(ai.specialSummonNegated(g, 0, fortress) && ai.scoreSynchro(g, 0, stardust) < 0, "no big Special Summon / Synchro Summon into the opponent's face-up Thunder King Rai-Oh");
}
{
  const { g, place } = setup(0, 'main1');
  place(0, "Koa'ki Meiru Drago", 'mzone');
  place(0, 'Sangan', 'hand');
  const plague = place(0, 'Plaguespreader Zombie', 'grave');
  check(aiScoreOf(g, plague) === 0, "Plaguespreader Zombie is not revived (a card back to the Deck) under our own Koa'ki Meiru Drago");
}
{
  const { g, place } = setup(0, 'end');
  const w1 = place(0, 'Red-Eyes Wyvern', 'grave');
  const w2 = place(0, 'Red-Eyes Wyvern', 'grave');
  place(0, 'Red-Eyes Darkness Metal Dragon', 'grave');
  check(aiScoreOf(g, w1) > 0 !== aiScoreOf(g, w2) > 0, 'two Red-Eyes Wyverns with one Red-Eyes to revive: only one is used');
}

console.log('\nAI: attacks');
{
  const { g, place } = setup(0, 'battle');
  const roid = place(0, 'Stealthroid', 'mzone');
  place(1, "Gravekeeper's Spy", 'mzone').pos = 'def';
  const ai = g.controllers[0] as any;
  check(!ai.planAttack(g, 0, roid), 'Stealthroid (no other "roid") does not bounce off a 2000 DEF wall for its End-of-Battle effect');
  const hop = place(0, 'Gladiator Beast Hoplomus', 'mzone');
  place(0, 'Gladiator Beast Laquari', 'deck');
  check(!ai.planAttack(g, 0, hop), 'nor Gladiator Beast Hoplomus (700) for a tag-out that costs 1300 LP');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
