// Regression tests for the edisonformat.com format pages:
//   - Functional Errata  https://www.edisonformat.com/functional-errata.html
//   - Banlist            https://www.edisonformat.com/banlist.html (the March 2010 TCG Forbidden & Limited list)
// Usage: npx tsx scripts/format-pages-test.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import { limitOf } from '../src/cards/banlist';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
};

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  trigger: (g: Game) => boolean = () => true;
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.respond(g, req);
  }
  async selectCards(g: Game, _p: PlayerId, req: SelectRequest) {
    return this.pick(g, req);
  }
  option: (req: { prompt: string; options: string[] }) => number = () => 0;
  yes: (req: { prompt: string }) => boolean = () => true;
  async chooseOption(_g: Game, _p: PlayerId, req: { prompt: string; options: string[] }) {
    return this.option(req);
  }
  async confirm(_g: Game, _p: PlayerId, req: { prompt: string }) {
    return this.yes(req);
  }
  async confirmTrigger(g: Game) {
    return this.trigger(g);
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
  const filler = (n: number): CardData[] => Array(n).fill(T.wall);
  const g = new Game([{ main: filler(20), extra: [] }, { main: filler(20), extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  const place = (p: PlayerId, data: CardData, loc: Location, opts: { faceUp?: boolean; pos?: BattlePos } = {}) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(data, p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, loc, { controller: p, faceUp: opts.faceUp ?? loc !== 'szone', pos: opts.pos ?? 'atk' });
    if (loc === 'szone' || (loc === 'mzone' && opts.faceUp === false)) c.setTurn = 0;
    c.summonTurn = 0;
    if ((loc === 'szone' || loc === 'fzone') && c.faceUp) c.activeOnField = true;
    return c;
  };
  return { g, c0, c1, place };
}

const N = (n: string) => cardByName(n);
const setPhase = (g: Game, ph: 'standby' | 'end') => (g as any).setPhase(ph) as Promise<void>;

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
  console.log('Format pages tests (edisonformat.com functional errata + banlist)');

  // https://www.edisonformat.com/functional-errata.html (Lumina, Lightsworn Summoner): "The Phase-Dependent Mandatory
  // [Trigger] activates again (if its activation is negated by "Light and Darkness Dragon") until it is able to resolve."
  await test('Lumina: End Phase mill negated by Light and Darkness Dragon activates again until it resolves', async () => {
    const { g, place } = setup();
    const lumina = place(0, N('Lumina, Lightsworn Summoner'), 'mzone');
    const ladd = place(1, N('Light and Darkness Dragon'), 'mzone');
    const deckBefore = g.players[0].deck.length;
    await setPhase(g, 'end');
    eq(lumina.location, 'mzone', 'Lumina still on the field');
    eq(g.players[0].deck.length, deckBefore - 3, 'top 3 cards sent once the activation finally resolves');
    eq(g.getDef(ladd) < 500, true, 'LaDD kept negating until it could no longer lose 500 DEF');
  });

  // Same page (Susa Soldier and all Spirit monsters): the same rule for the Spirit End Phase return.
  await test('Spirit monster: End Phase return negated by Light and Darkness Dragon activates again until it resolves', async () => {
    const { g, place } = setup();
    const spirit = place(0, N('Yamato-no-Kami'), 'mzone');
    spirit.flags.spiritTurn = g.turn;
    const ladd = place(1, N('Light and Darkness Dragon'), 'mzone');
    await setPhase(g, 'end');
    eq(spirit.location, 'hand', 'returned to the hand');
    eq(g.getDef(ladd) < 500, true, 'LaDD negated it until it could no longer lose 500 DEF');
  });

  // https://www.edisonformat.com/functional-errata.html (Ultimate Offering): "[Quick] ... You can only activate this
  // effect during your Main Phase or your opponent's Battle Phase." / "The Summon / Set occurs when [Quick] resolves" /
  // "Solemn Judgment cannot negate this Summon."
  await test("Ultimate Offering: usable in the opponent's Battle Phase; the monster is Set when the effect resolves", async () => {
    const { g, place } = setup();
    g.turnPlayer = 1;
    g.phase = 'battle';
    const uo = place(0, N('Ultimate Offering'), 'szone', { faceUp: true });
    const mon = place(0, T.wall, 'hand');
    const act = g.getActivations(0, { open: false }).find((a) => a.card === uo);
    eq(!!act, true, "offered during the opponent's Battle Phase");
    g.controllers[0] = Object.assign(g.controllers[0], { option: () => 1 });
    await g.activate(0, act!);
    await g.resolveChain();
    eq(g.players[0].lp, 7500, 'paid 500 LP');
    eq(mon.location, 'mzone', 'monster placed on resolution');
    g.phase = 'main1';
    eq(g.getActivations(0, { open: false }).some((a) => a.card === uo), false, "not in the opponent's Main Phase");
  });

  await test('Ultimate Offering: the extra Normal Summon happens on resolution and cannot be negated by Solemn Judgment', async () => {
    const { g, c1, place } = setup();
    const uo = place(0, N('Ultimate Offering'), 'szone', { faceUp: true });
    const mon = place(0, T.brute, 'hand');
    const sj = place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = (_g, req) => req.options.find((o) => o.card === sj) ?? null;
    const act = g.getActivations(0, { open: true }).find((a) => a.card === uo);
    eq(!!act, true, 'offered in your Main Phase');
    await g.performAction(0, { type: 'activate', card: uo, act: act! });
    eq(mon.location, 'mzone', 'Normal Summoned');
    eq(mon.faceUp, true, 'face-up');
    eq(sj.location, 'szone', 'Solemn Judgment had no window to negate it');
    eq(g.players[0].normalSummonsLeft, 1, "the turn's own Normal Summon is still available");
  });

  // Banlist: https://www.edisonformat.com/banlist.html ("Edison Format Follows the March 2010 (TCG) Forbidden and
  // Limited List"; card images) and https://yugipedia.com/wiki/March_2010_Lists_(TCG) (Konami list effective
  // 2010-03-01, http://www.yugioh-card.com/en/limited/10_03_list.html).
  await test('Banlist: March 2010 TCG list entries', async () => {
    const expect: [string, number][] = [
      ['Destiny Hero - Disk Commander', 0],
      ['Tribe-Infecting Virus', 0],
      ['Destiny Draw', 1],
      ['Chaos Sorcerer', 1],
      ['Burial from a Different Dimension', 1],
      ['Reasoning', 1],
      ['Swords of Revealing Light', 1],
      ['Black Rose Dragon', 1],
      ['Mind Master', 1],
      ['Necroface', 1],
      ['Snipe Hunter', 1],
      ['Summoner Monk', 1],
      ['Tragoedia', 1],
      ['Level Limit - Area B', 1],
      ['Monster Gate', 1],
      ['One for One', 1],
      ['Gravity Bind', 1],
      ['Mind Crush', 1],
      ['Ojama Trio', 1],
      ['The Transmigration Prophecy', 1],
      ['Honest', 2],
      ['Magical Stone Excavation', 2],
      ['United We Stand', 2],
      ['Skill Drain', 2],
      ['Treeborn Frog', 2],
      ['Royal Oppression', 2],
      ['Sacred Phoenix of Nephthys', 3],
      ['E - Emergency Call', 3],
      ['Mass Driver', 3],
      ['Messenger of Peace', 3],
    ];
    for (const [name, lim] of expect) eq(limitOf(name), lim, name);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
