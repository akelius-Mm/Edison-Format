// Hidden-information tests: what each viewer (player 0, player 1, a spectator) may see of Set cards,
// hands and decks, and that the shared duel log never names a card one of them cannot see.
// Usage: npx tsx scripts/hidden-info-test.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, PlayerController, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';

const wall = findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000);

class TestController implements PlayerController {
  readonly isHuman = false;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse() {
    return null;
  }
  async selectCards(g: Game, _p: PlayerId, req: SelectRequest) {
    return this.pick(g, req);
  }
  async chooseOption() {
    return 0;
  }
  async confirm() {
    return true;
  }
  async confirmTrigger() {
    return true;
  }
  async choosePosition(_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return allowed[0];
  }
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    return targets[0] ?? (canDirect ? null : 'cancel');
  }
}

function setup() {
  const c0 = new TestController();
  const c1 = new TestController();
  const deck = (): CardData[] => Array(20).fill(wall);
  const g = new Game([{ main: deck(), extra: [cardByName('Goyo Guardian')] }, { main: deck(), extra: [] }], [c0, c1], { seed: 1 });
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

async function activateCard(g: Game, p: PlayerId, card: CardInstance) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card);
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}

/** What the spectator board shows (DuelScreen.canSee with viewer === null). */
const spectatorSees = (g: Game, c: CardInstance) => g.seenBy(c, null);
const visibleTo = (g: Game, c: CardInstance, p: PlayerId) => g.seenBy(c, p);
/** Log lines written since `from` that name `card`. */
const logNames = (g: Game, from: number, name: string) => g.logEntries.slice(from).filter((e) => e.text.includes(name));

let pass = 0;
let fail = 0;
async function test(name: string, fn: () => Promise<void>) {
  const errs: string[] = [];
  const orig = console.error;
  console.error = (...a: any[]) => errs.push(a.join(' '));
  try {
    await fn();
    if (errs.length) throw new Error('console.error: ' + errs.join(' | '));
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    if (e instanceof GameOver) {
      pass++;
      console.log(`  ✓ ${name} (game over: ${e.reason})`);
    } else {
      fail++;
      console.log(`  ✗ ${name}\n      ${(e as Error).message}`);
    }
  } finally {
    console.error = orig;
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`);
}

(async () => {
  console.log('Hidden-information tests');

  await test('visibility matrix: Set cards, hands, decks, face-down banished, Extra Deck', async () => {
    const { g, place } = setup();
    const setMon = place(1, wall, 'mzone', { faceUp: false, pos: 'def' });
    const setTrap = place(1, cardByName('Mirror Force'), 'szone');
    const hand = place(1, cardByName('Mirror Force'), 'hand');
    const banishedDown = place(1, wall, 'banished', { faceUp: false });
    const deckTop = g.players[1].deck[g.players[1].deck.length - 1];
    const extra = g.players[0].extra[0];
    for (const [c, what] of [
      [setMon, 'Set monster'],
      [setTrap, 'Set S/T'],
      [hand, 'hand card'],
      [banishedDown, 'face-down banished card'],
      [deckTop, 'deck card'],
    ] as [CardInstance, string][]) {
      eq(g.isPublic(c, 0), false, `${what} hidden from the opponent`);
      eq(visibleTo(g, c, 0), false, `${what} hidden in the opponent's dialogs`);
      eq(spectatorSees(g, c), false, `${what} hidden from a spectator`);
    }
    eq(visibleTo(g, setMon, 1), true, 'controller sees their Set monster');
    eq(visibleTo(g, hand, 1), true, 'owner sees their hand');
    eq(visibleTo(g, extra, 1), false, 'Extra Deck hidden from the opponent');
    eq(spectatorSees(g, extra), false, 'Extra Deck hidden from a spectator');
  });

  await test('Giant Trunade: own Set cards returned to the hand are not named in the duel log', async () => {
    const { g, place } = setup();
    const gt = place(0, cardByName('Giant Trunade'), 'hand');
    const set = place(0, cardByName('Mirror Force'), 'szone');
    const up = place(0, cardByName('Swords of Revealing Light'), 'szone', { faceUp: true });
    const from = g.logEntries.length;
    await activateCard(g, 0, gt);
    eq(set.location, 'hand', 'Set card back in hand');
    eq(up.location, 'hand', 'face-up card back in hand');
    eq(logNames(g, from, 'Mirror Force').length, 0, 'Set card not named in the log');
    eq(logNames(g, from, 'Swords of Revealing Light').length > 0, true, 'face-up card named in the log');
    eq(logNames(g, from, 'a face-down card').length, 1, 'the hidden card is counted');
    eq(g.isPublic(set, 1), false, 'Set card hidden from the opponent');
    eq(spectatorSees(g, set), false, 'Set card hidden from a spectator');
  });

  await test('a card revealed in the hand stops being revealed once it leaves the hand (Set, then bounced)', async () => {
    const { g, place } = setup();
    const mf = place(1, cardByName('Mirror Force'), 'hand');
    mf.revealedUntil = g.turn; // shown this turn (searched, revealed for a cost...)
    eq(g.isPublic(mf, 0), true, 'revealed while in the hand');
    g.rawMove(mf, 'szone', { controller: 1, faceUp: false });
    const gt = place(0, cardByName('Giant Trunade'), 'hand');
    await activateCard(g, 0, gt);
    eq(mf.location, 'hand', 'bounced');
    eq(g.isPublic(mf, 0), false, 'the Set card bounced to the hand is hidden again');
  });

  await test('a revealed card shuffled into the Deck and drawn again the same turn is hidden', async () => {
    const { g, place } = setup();
    const mf = place(1, cardByName('Mirror Force'), 'hand');
    mf.revealedUntil = g.turn;
    await g.toDeck([mf], 'effect', 'top', 1);
    eq(g.isPublic(mf, 0), false, 'hidden in the Deck');
    await g.draw(1, 1);
    eq(mf.location, 'hand', 'drawn');
    eq(g.isPublic(mf, 0), false, 'a drawn card is not revealed');
  });

  await test('taking control of a face-down monster does not name it in the log', async () => {
    const { g, place } = setup();
    const mon = place(1, cardByName('Morphing Jar'), 'mzone', { faceUp: false, pos: 'def' });
    const from = g.logEntries.length;
    await g.takeControl(mon, 0, false);
    eq(mon.controller, 0, 'control taken');
    await g.returnControl(mon);
    eq(mon.controller, 1, 'control returned');
    eq(logNames(g, from, 'Morphing Jar').length, 0, 'face-down monster not named');
    eq(spectatorSees(g, mon), false, 'still hidden from a spectator');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
