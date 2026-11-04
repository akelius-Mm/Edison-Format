// Rulings regression tests for ABPF / PTDN cards (audit group abpf-ptdn).
// Usage: npx tsx scripts/rulings/sets-abpf-ptdn.ts
import '../../src/cards';
import { cardByName, findCard } from '../../src/cards';
import { normal } from '../../src/cards/define';
import type { CardData, CardInstance } from '../../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../../src/engine/controller';
import { Game, GameOver } from '../../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../../src/engine/types';
import { TestController, eq, report, test } from '../lib/harness';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  dark: findCard('Rules Test Shade') ?? normal('Rules Test Shade', 'DARK', 'Fiend', 4, 1600, 1200),
  giant: findCard('Rules Test Giant') ?? normal('Rules Test Giant', 'EARTH', 'Warrior', 8, 3000, 2500),
};
const tuner = findCard('Rules Test Tuner') ?? normal('Rules Test Tuner', 'EARTH', 'Warrior', 2, 800, 800);
if (!tuner.mtypes!.includes('tuner')) tuner.mtypes!.push('tuner');

type Responder = (g: Game, req: ResponseRequest) => Activation | null;


function filler(n: number): CardData[] {
  return Array(n).fill(T.wall);
}

function setup() {
  const c0 = new TestController();
  const c1 = new TestController();
  const g = new Game([{ main: filler(20), extra: [cardByName('Goyo Guardian')] }, { main: filler(20), extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  const place = (p: PlayerId, data: CardData, loc: Location, opts: { faceUp?: boolean; pos?: BattlePos } = {}) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(data, p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, loc, { controller: p, faceUp: opts.faceUp ?? loc !== 'szone', pos: opts.pos ?? 'atk' });
    if (loc === 'szone' || (loc === 'mzone' && opts.faceUp === false)) c.setTurn = 0;
    c.summonTurn = 0;
    return c;
  };
  return { g, c0, c1, place };
}

const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;


async function activateCard(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}


(async () => {
  console.log('Rulings tests (ABPF / PTDN)');

  const psychic = findCard('Rulings Test Psychic') ?? normal('Rulings Test Psychic', 'EARTH', 'Psychic', 4, 1000, 1000);

  await test('Psi-Curse: activates when a Psychic is destroyed by an attacking monster; destroys it and burns Level x 300', async () => {
    const { g, c1, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const d = place(1, psychic, 'mzone');
    const curse = place(1, cardByName('Psi-Curse'), 'szone', { faceUp: false });
    c1.respond = respondWith('Psi-Curse');
    await g.conductAttack(0, a);
    eq(d.location, 'grave', 'Psychic destroyed');
    eq(curse.location, 'grave', 'Psi-Curse used');
    eq(a.location, 'grave', 'attacker destroyed');
    eq(g.players[0].lp, 8000 - 1200, '4 x 300 damage');
  });

  await test('Fiendish Chain: stays when the chained monster is bounced, and is not destroyed when that card is later destroyed', async () => {
    const { g, c1, place } = setup();
    const cd = place(0, cardByName('Card Trooper'), 'mzone');
    const chain = place(1, cardByName('Fiendish Chain'), 'szone', { faceUp: false });
    g.turnPlayer = 1;
    c1.pick = (_g, req) => (req.candidates.includes(cd) ? [cd] : req.candidates.slice(0, req.min));
    await activateCard(g, 1, chain);
    g.turnPlayer = 0;
    eq(g.isNegated(cd), true, 'negated');
    await g.toHand([cd], 'effect', 1);
    await g.processTriggers(false);
    eq(chain.location, 'szone', 'Chain stays after bounce');
    g.rawMove(cd, 'mzone', { controller: 0, faceUp: true, pos: 'atk' });
    eq(g.isNegated(cd), false, 'the new copy is not negated');
    await g.destroy([cd], 'effect', 1);
    await g.processTriggers(false);
    eq(chain.location, 'szone', 'Chain not destroyed by a later destruction');
  });
  report();
})();
