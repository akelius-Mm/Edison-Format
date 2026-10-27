// Core game rules (not individual cards) as played at SJC Edison, April 2010.
// Sources:
//   Rulebook v7.0 (the 5D's-era rulebook used for Edison): https://www.edisonformat.com/rulebook.html (page numbers below)
//   Edison Format rule differences: https://www.edisonformat.com/edison-rule-differences.html ("Rule #N" below)
// Usage: npx tsx scripts/core-rules-test.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { monster, normal, spell, trap } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Ctx } from '../src/engine/ctx';
import { Game, GameOver, type ChainLink } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  zeroA: findCard('Core Test Zero A') ?? normal('Core Test Zero A', 'EARTH', 'Rock', 1, 0, 0),
  zeroB: findCard('Core Test Zero B') ?? normal('Core Test Zero B', 'EARTH', 'Rock', 1, 0, 0),
  imp: findCard('Core Test Imp') ?? normal('Core Test Imp', 'DARK', 'Fiend', 3, 1000, 1000),
  lv5: findCard('Core Test Lv5') ?? normal('Core Test Lv5', 'EARTH', 'Rock', 5, 2000, 0),
  lv6: findCard('Core Test Lv6') ?? normal('Core Test Lv6', 'EARTH', 'Rock', 6, 2100, 0),
  lv7: findCard('Core Test Lv7') ?? normal('Core Test Lv7', 'EARTH', 'Rock', 7, 2500, 0),
  lv8: findCard('Core Test Lv8') ?? normal('Core Test Lv8', 'EARTH', 'Rock', 8, 3000, 0),
};
const fired: Record<string, number> = {};
const discardOptional =
  findCard('Core Test Discard Optional') ??
  monster('Core Test Discard Optional', {
    attribute: 'DARK',
    race: 'Fiend',
    level: 3,
    atk: 0,
    def: 0,
    text: 'When this card is discarded: you can do nothing.',
    effects: [{ kind: 'trigger', event: 'discarded', when: true, resolve: async () => void (fired.optional = (fired.optional ?? 0) + 1) }],
  });
const discardMandatory =
  findCard('Core Test Discard Mandatory') ??
  monster('Core Test Discard Mandatory', {
    attribute: 'DARK',
    race: 'Fiend',
    level: 3,
    atk: 0,
    def: 0,
    text: 'When this card is discarded: do nothing.',
    effects: [{ kind: 'trigger', event: 'discarded', mandatory: true, resolve: async () => void (fired.mandatory = (fired.mandatory ?? 0) + 1) }],
  });
const quickPlay = findCard('Core Test Quick-Play') ?? spell('Core Test Quick-Play', 'quickplay', { text: 'Do nothing.', effects: [{ kind: 'activate', resolve: async () => {} }] });
const negateTrap =
  findCard('Core Test Negate Trap') ??
  trap('Core Test Negate Trap', 'normal', { text: 'Negate an activation.', effects: [{ kind: 'activate', categories: ['negate'], canActivate: (ctx) => ctx.game.chain.length > 0, resolve: async () => {} }] });
const counterTrap = findCard('Core Test Counter') ?? trap('Core Test Counter', 'counter', { text: 'Do nothing.', effects: [{ kind: 'activate', resolve: async () => {} }] });

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  onAction: (acts: Action[]) => void = () => {};
  triggersAsked: string[] = [];
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    this.onAction(acts);
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.respond(g, req);
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
  async confirmTrigger(_g: Game, _p: PlayerId, act: Activation) {
    this.triggersAsked.push(act.card.name);
    return true;
  }
  async choosePosition(_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return allowed[0];
  }
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    return targets[0] ?? (canDirect ? null : 'cancel');
  }
}

function setup(deck0: CardData[] = Array(20).fill(T.wall), deck1: CardData[] = Array(20).fill(T.wall)) {
  const c0 = new TestController();
  const c1 = new TestController();
  const g = new Game([{ main: deck0, extra: [] }, { main: deck1, extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  const place = (p: PlayerId, data: CardData, loc: Location, opts: { faceUp?: boolean; pos?: BattlePos } = {}) => {
    const c = g.registerCard(new (g.allCards[0].constructor as any)(data, p)) as CardInstance;
    c.location = 'none';
    g.rawMove(c, loc, { controller: p, faceUp: opts.faceUp ?? !(loc === 'szone' || loc === 'fzone'), pos: opts.pos ?? 'atk' });
    if (loc === 'szone' || loc === 'fzone' || (loc === 'mzone' && opts.faceUp === false)) c.setTurn = 0;
    c.summonTurn = 0;
    return c;
  };
  /** A face-up Continuous Spell/Trap or Field Spell that already resolved. */
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  return { g, c0, c1, place, live };
}

const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;

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
    fail++;
    console.log(`  ✗ ${name}\n      ${e instanceof GameOver ? 'unexpected game over: ' + e.reason : (e as Error).message}`);
  } finally {
    console.error = orig;
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`);
}
async function gameOver(fn: () => Promise<unknown> | unknown): Promise<GameOver> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof GameOver) return e;
    throw e;
  }
  throw new Error('expected the duel to end');
}

(async () => {
  console.log('Core rules tests (Edison, April 2010)');

  // ---- Fixes ---------------------------------------------------------------------------------------------------------

  // Rule #13: two 0 ATK Attack Position monsters destroy each other; 0 ATK vs 0 DEF destroys nothing.
  await test('Rule #13: 0 ATK attacker vs 0 ATK Attack Position monster: both destroyed', async () => {
    const { g, place } = setup();
    const a = place(0, T.zeroA, 'mzone');
    const d = place(1, T.zeroB, 'mzone');
    await g.conductAttack(0, a);
    eq(a.location, 'grave', 'attacker');
    eq(d.location, 'grave', 'attack target');
    eq(g.players[0].lp + g.players[1].lp, 16000, 'no damage');
  });
  await test('Rule #13: 0 ATK attacker vs 0 DEF Defense Position monster: nothing destroyed', async () => {
    const { g, place } = setup();
    const a = place(0, T.zeroA, 'mzone');
    const d = place(1, T.zeroB, 'mzone', { pos: 'def' });
    await g.conductAttack(0, a);
    eq(a.location, 'mzone', 'attacker');
    eq(d.location, 'mzone', 'attack target');
  });

  // Rule #2: the opponent's Field Spell is destroyed when the new one resolves, not when it is activated.
  await test('Rule #2: opponent\'s face-up Field Spell is destroyed only when the new Field Spell resolves', async () => {
    const { g, c1, place, live } = setup();
    const old = live(place(1, cardByName('Realm of Light'), 'fzone'));
    place(1, counterTrap, 'szone'); // so player 1 gets a response window
    const wl = place(0, cardByName('Wetlands'), 'hand');
    let duringChain: Location | undefined;
    c1.respond = (_g, req) => {
      if (req.kind === 'chain') duringChain = old.location;
      return null;
    };
    const act = g.getActivations(0, { open: true }).find((a) => a.card === wl)!;
    await g.performAction(0, { type: 'activate', card: wl, act });
    eq(duringChain, 'fzone', 'old Field Spell still on the field while the chain is open');
    eq(old.location, 'grave', 'old Field Spell destroyed on resolution');
    eq(wl.location, 'fzone', 'new Field Spell');
  });
  await test('Rule #2: new Field Spell destroyed in the chain (Dust Tornado): the opponent\'s Field Spell stays', async () => {
    const { g, c1, place, live } = setup();
    const old = live(place(1, cardByName('Realm of Light'), 'fzone'));
    place(1, cardByName('Dust Tornado'), 'szone');
    const wl = place(0, cardByName('Wetlands'), 'hand');
    c1.respond = respondWith('Dust Tornado');
    c1.pick = (_g, req) => (req.candidates.includes(wl) ? [wl] : req.candidates.slice(0, req.min));
    const act = g.getActivations(0, { open: true }).find((a) => a.card === wl)!;
    await g.performAction(0, { type: 'activate', card: wl, act });
    eq(wl.location, 'grave', 'new Field Spell destroyed by Dust Tornado');
    eq(old.location, 'fzone', 'opponent\'s Field Spell not destroyed');
  });
  await test('Rule #2: your own old Field Spell leaves when the new one is activated', async () => {
    const { g, c1, place, live } = setup();
    const old = live(place(0, cardByName('Realm of Light'), 'fzone'));
    place(1, counterTrap, 'szone'); // so player 1 gets a response window
    const wl = place(0, cardByName('Wetlands'), 'hand');
    let duringChain: Location | undefined;
    c1.respond = (_g, req) => {
      if (req.kind === 'chain') duringChain = old.location;
      return null;
    };
    const act = g.getActivations(0, { open: true }).find((a) => a.card === wl)!;
    await g.performAction(0, { type: 'activate', card: wl, act });
    eq(duringChain, 'grave', 'own old Field Spell already gone during the chain');
    eq(wl.location, 'fzone', 'new Field Spell');
  });
  await test('Rule #2: Setting a Field Spell leaves the opponent\'s face-up Field Spell alone', async () => {
    const { g, place, live } = setup();
    const old = live(place(1, cardByName('Realm of Light'), 'fzone'));
    const wl = place(0, cardByName('Wetlands'), 'hand');
    await g.performAction(0, { type: 'setST', card: wl });
    eq(old.location, 'fzone', 'opponent\'s Field Spell');
    eq(wl.location, 'fzone', 'Set Field Spell');
    eq(wl.faceUp, false, 'face-down');
  });
  await test('Rule #2: Setting a Field Spell over your Geartown destroys it without a chain; Geartown can activate', async () => {
    const { g, place, live } = setup();
    const gt = live(place(0, cardByName('Geartown'), 'fzone'));
    const golem = place(0, cardByName('Ancient Gear Knight'), 'deck');
    const wl = place(0, cardByName('Wetlands'), 'hand');
    await g.performAction(0, { type: 'setST', card: wl });
    eq(gt.location, 'grave', 'Geartown destroyed');
    eq(golem.location, 'mzone', 'Geartown Special Summoned an "Ancient Gear" monster');
  });

  // Rule #11: no responses to the end-of-turn discard; its Optional Triggers can't activate; a Mandatory one's chain only
  // takes Spell Speed 3 or negating Spell Speed 2 effects. Rulebook v7.0 p.33: hand limit 6 at the end of the End Phase.
  await test('Rule #11 / Rulebook p.33: end-of-turn discard to 6; optional discard triggers can\'t activate; limited chain', async () => {
    const { g, c0, c1, place } = setup();
    g.turnPlayer = 1; // playTurn passes the turn to player 0 (turn 3)
    for (let i = 0; i < 5; i++) place(0, T.wall, 'hand');
    const opt = place(0, discardOptional, 'hand');
    const mand = place(0, discardMandatory, 'hand');
    place(1, quickPlay, 'szone');
    place(1, negateTrap, 'szone');
    place(1, counterTrap, 'szone');
    fired.optional = 0;
    fired.mandatory = 0;
    c0.pick = (_g, req) => (req.purpose === 'discard' ? [opt, mand, ...req.candidates.filter((c) => c !== opt && c !== mand)].slice(0, req.min) : req.candidates.slice(0, req.min));
    let offered: string[] | null = null;
    c1.respond = (gg, req) => {
      if (gg.chain.some((l) => l.card === mand)) offered = req.options.map((o) => o.card.name);
      return null;
    };
    await g.playTurn();
    eq(g.players[0].hand.length, 6, 'hand size after the End Phase');
    eq(opt.location, 'grave', 'optional-trigger card discarded');
    eq(fired.optional, 0, 'optional trigger did not activate');
    eq(c0.triggersAsked.includes(opt.name), false, 'optional trigger not even offered');
    eq(fired.mandatory, 1, 'mandatory trigger activated and resolved');
    if (!offered) throw new Error('no response window in the mandatory trigger chain');
    const o = offered as string[];
    eq(o.includes(quickPlay.name), false, 'Spell Speed 2 non-negating Quick-Play can\'t be chained');
    eq(o.includes(negateTrap.name), true, 'Spell Speed 2 negating Trap can be chained');
    eq(o.includes(counterTrap.name), true, 'Counter Trap can be chained');
  });

  // Rule #8 / Rulebook p.34: Flip Effects activate after damage calculation while the destroyed monster is still on the
  // field (Substep 6); battle-destroyed monsters go to the GY in Substep 7 and can't be targeted before that.
  await test('Rule #8: a Flip Effect of a monster destroyed by the attack activates before it is sent to the GY', async () => {
    const { g, c1, place } = setup();
    const a = place(0, T.brute, 'mzone');
    const ryko = place(1, cardByName('Ryko, Lightsworn Hunter'), 'mzone', { faceUp: false, pos: 'def' });
    let rykoAt: Location | undefined;
    let rykoTargetable: boolean | undefined;
    c1.pick = (gg, req) => {
      if (req.purpose === 'destroy') {
        rykoAt = ryko.location;
        rykoTargetable = new Ctx(gg, a, a.data.effects?.[0] ?? ({ kind: 'ignition' } as any), 0).canTarget(ryko);
        return req.candidates.filter((c) => c === a);
      }
      return req.candidates.slice(0, req.min);
    };
    await g.conductAttack(0, a);
    eq(rykoAt, 'mzone', 'Ryko still on the field when its Flip Effect activates');
    eq(rykoTargetable, false, 'a monster destroyed by battle can\'t be targeted before it leaves the field');
    eq(ryko.location, 'grave', 'Ryko destroyed by battle');
    eq(a.location, 'grave', 'attacker destroyed by Ryko');
  });

  // Rule #10: an LP cost can't reduce your LP to 0 (settles "lp > cost").
  await test('Rule #10: Skill Drain can\'t be activated with exactly 1000 LP; can with 1001', async () => {
    const { g, place } = setup();
    const sd = place(0, cardByName('Skill Drain'), 'szone');
    g.players[0].lp = 1000;
    eq(g.getActivations(0, { open: true }).some((a) => a.card === sd), false, 'at 1000 LP');
    g.players[0].lp = 1001;
    eq(g.getActivations(0, { open: true }).some((a) => a.card === sd), true, 'at 1001 LP');
  });
  await test('Rule #10: Solemn Warning can\'t be activated with exactly 2000 LP', async () => {
    const { g, c1, place } = setup();
    const m = place(0, T.brute, 'hand');
    place(1, cardByName('Solemn Warning'), 'szone');
    g.players[1].lp = 2000;
    let seen = false;
    c1.respond = (_g, req) => {
      if (req.options.some((o) => o.card.name === 'Solemn Warning')) seen = true;
      return null;
    };
    await g.performAction(0, { type: 'summon', card: m });
    eq(seen, false, 'Solemn Warning offered');
    eq(m.location, 'mzone', 'summon not negated');
  });

  await test('Rule #10: Seven Tools of the Bandit can\'t be activated with exactly 1000 LP', async () => {
    const { g, place } = setup();
    const dt = place(0, cardByName('Dust Tornado'), 'szone');
    dt.faceUp = true;
    const st = place(1, cardByName('Seven Tools of the Bandit'), 'szone');
    const ef = dt.data.effects!.find((e) => e.kind === 'activate')!;
    g.chain = [{ index: 1, card: dt, effect: ef, effectIndex: dt.data.effects!.indexOf(ef), player: 0, ctx: new Ctx(g, dt, ef, 0), negated: false, speed: 2, isCardActivation: true, fromLocation: 'szone' }];
    const offered = () => g.getActivations(1, { open: false, window: 'chain' }).some((a) => a.card === st);
    g.players[1].lp = 1000;
    eq(offered(), false, 'at 1000 LP');
    g.players[1].lp = 1001;
    eq(offered(), true, 'at 1001 LP');
    g.chain = [];
  });

  // ---- Rules already right (regression guards) ----------------------------------------------------------------------

  await test('Rule #1 / Rulebook p.31: the first player draws on turn 1 (6 cards) and has no Battle Phase', async () => {
    const c0 = new TestController();
    const c1 = new TestController();
    const g = new Game([{ main: Array(20).fill(T.brute), extra: [] }, { main: Array(20).fill(T.wall), extra: [] }], [c0, c1], { seed: 3, firstPlayer: 0, maxTurns: 1 });
    let hand = -1;
    let battleOffered = false;
    c0.onAction = (acts) => {
      if (g.phase === 'main1' && hand < 0) hand = g.players[0].hand.length;
      if (acts.some((a) => a.type === 'phase' && a.to === 'battle')) battleOffered = true;
    };
    const r = await g.start();
    eq(r.turns, 1, 'one turn played');
    eq(hand, 6, 'first player\'s hand in Main Phase 1');
    eq(battleOffered, false, 'Battle Phase offered on turn 1');
  });

  await test('Rulebook p.16/29: one Normal Summon or Set per turn; Tributes: Level 5-6 one, Level 7+ two', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'hand');
    const b = place(0, T.wall, 'hand');
    await g.performAction(0, { type: 'summon', card: a });
    eq(g.canNormalSummon(0, b, false), false, 'second Normal Summon');
    eq(g.canNormalSummon(0, b, true), false, 'Set after a Normal Summon');
    const lv = (d: CardData) => g.tributesNeeded(place(0, d, 'hand'));
    eq(lv(T.brute), 0, 'Level 4');
    eq(lv(T.lv5), 1, 'Level 5');
    eq(lv(T.lv6), 1, 'Level 6');
    eq(lv(T.lv7), 2, 'Level 7');
    eq(lv(T.lv8), 2, 'Level 8');
  });

  await test('Rulebook p.17/29: battle position changes and Flip Summons', async () => {
    const { g, place } = setup();
    const acts = () => g.legalMainActions(0);
    const has = (type: string, c: CardInstance) => acts().some((x) => x.type === type && (x as any).card === c);
    const fresh = place(0, T.brute, 'mzone');
    fresh.summonTurn = g.turn;
    eq(has('position', fresh), false, 'monster played this turn');
    const old = place(0, T.brute, 'mzone');
    eq(has('position', old), true, 'monster played on an earlier turn');
    await g.performAction(0, { type: 'position', card: old });
    eq(old.pos, 'def', 'changed to Defense Position');
    eq(has('position', old), false, 'second change in the same turn');
    const attacked = place(0, T.brute, 'mzone');
    attacked.attacksThisTurn = 1;
    eq(has('position', attacked), false, 'monster that attacked this turn');
    const setNow = place(0, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    setNow.setTurn = g.turn;
    setNow.summonTurn = g.turn;
    eq(has('flip', setNow), false, 'Flip Summon on the turn it was Set');
    const setOld = place(0, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    eq(has('flip', setOld), true, 'Flip Summon of a monster Set earlier');
    await g.performAction(0, { type: 'flip', card: setOld });
    eq(setOld.faceUp && setOld.pos === 'atk', true, 'Flip Summoned in face-up Attack Position');
  });

  await test('Rulebook p.21-22: a Trap or Quick-Play Spell can\'t be activated the turn it was Set', async () => {
    const { g, place, live } = setup();
    live(place(1, cardByName('Wetlands'), 'fzone'));
    const dt = place(0, cardByName('Dust Tornado'), 'szone');
    const qp = place(0, quickPlay, 'szone');
    const open = () => g.getActivations(0, { open: true }).map((a) => a.card);
    eq(open().includes(dt) && open().includes(qp), true, 'Set on an earlier turn');
    dt.setTurn = g.turn;
    qp.setTurn = g.turn;
    eq(open().includes(dt), false, 'Trap Set this turn');
    eq(open().includes(qp), false, 'Quick-Play Set this turn');
  });

  await test('Rulebook p.39 Spell Speeds: SS1 never responds; SS2 can\'t respond to SS3; SS3 can', async () => {
    const { g, place, live } = setup();
    live(place(0, cardByName('Wetlands'), 'fzone'));
    const dt = place(1, cardByName('Dust Tornado'), 'szone');
    const ct = place(1, counterTrap, 'szone');
    const src = place(0, counterTrap, 'szone');
    const fake = (speed: number): ChainLink => {
      const ef = src.data.effects![0];
      return { index: 1, card: src, effect: ef, effectIndex: 0, player: 0, ctx: new Ctx(g, src, ef, 0), negated: false, speed, isCardActivation: true, fromLocation: 'szone' };
    };
    const offered = () => g.getActivations(1, { open: false, window: 'chain' }).map((a) => a.card);
    g.chain = [fake(1)];
    eq(offered().includes(dt) && offered().includes(ct), true, 'SS2 and SS3 respond to SS1');
    g.chain = [fake(3)];
    eq(offered().includes(dt), false, 'SS2 responds to SS3');
    eq(offered().includes(ct), true, 'SS3 responds to SS3');
    g.chain = [];
    const ns = place(1, cardByName('Pot of Avarice'), 'hand');
    g.turnPlayer = 1;
    g.chain = [fake(1)];
    eq(g.getActivations(1, { open: false, window: 'chain' }).some((a) => a.card === ns), false, 'SS1 Normal Spell in a chain');
    g.chain = [];
  });

  await test('Rulebook p.34: in the Damage Step only Counter Traps / ATK-DEF modifiers can be activated', async () => {
    const { g, place, live } = setup();
    live(place(0, cardByName('Wetlands'), 'fzone'));
    const dt = place(1, cardByName('Dust Tornado'), 'szone');
    const ct = place(1, counterTrap, 'szone');
    const atk = place(0, T.brute, 'mzone');
    g.battle = { attacker: atk, target: null, attackerMoveId: atk.moveId, targetMoveId: -1, negated: false, inDamageStep: true, oppMonsterCount: 0 };
    const offered = () => g.getActivations(1, { open: false, window: 'damage' }).map((a) => a.card);
    eq(offered().includes(dt), false, 'Dust Tornado in the Damage Step');
    eq(offered().includes(ct), true, 'Counter Trap in the Damage Step');
    g.battle.inDamageStep = false;
    eq(g.getActivations(1, { open: false, window: 'attack' }).some((a) => a.card === dt), true, 'Dust Tornado in the Battle Step');
    g.battle = null;
  });

  await test('Rule #7 SEGOC: Sangan Tributed for Caius is Chain Link 1, Caius Chain Link 2', async () => {
    const { g, place } = setup();
    place(0, cardByName('Sangan'), 'mzone');
    const caius = place(0, cardByName('Caius the Shadow Monarch'), 'hand');
    place(1, T.wall, 'mzone');
    const order: string[] = [];
    g.hooks.anim = (a) => {
      if (a.type === 'activate') order.push(`${a.chainIndex}:${g.card(a.card)!.name}`);
    };
    await g.performAction(0, { type: 'summon', card: caius });
    eq(order.join(', '), '1:Sangan, 2:Caius the Shadow Monarch', 'chain');
  });

  await test('Missing the timing: a "When ... you can" trigger misses if it was not the last thing to happen', async () => {
    for (const miss of [false, true]) {
      const { g, place } = setup(Array(20).fill(T.wall), [T.imp, ...Array(19).fill(T.wall)]);
      g.turnPlayer = 1;
      const tomato = place(1, cardByName('Mystic Tomato'), 'mzone');
      const other = place(0, T.wall, 'mzone');
      await g.moveCards([tomato], 'grave', { reason: 'battle', reasons: ['battle', 'destroy'], destroyed: true });
      if (miss) await g.moveCards([other], 'grave', { reason: 'effect' });
      await g.processTriggers(false);
      eq(g.monsters(1).some((c) => c.name === T.imp.name), !miss, miss ? 'missed the timing' : 'activated');
    }
  });

  await test('Rulebook p.24: LP 0 loses; unable to draw loses; both at 0 at once is a draw', async () => {
    {
      const { g } = setup();
      const e = await gameOver(() => g.damage(1, 8000, 'effect'));
      eq(e.winner, 0, 'LP 0');
    }
    {
      const { g } = setup(Array(20).fill(T.wall), []);
      const e = await gameOver(() => g.draw(1, 1));
      eq(e.winner, 0, 'deck out');
    }
    {
      const { g } = setup();
      g.players[0].lp = 0;
      g.players[1].lp = 0;
      const e = await gameOver(() => g.checkLp());
      eq(e.winner, null, 'simultaneous 0 LP');
    }
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
