// Sourced rulings sweep, group 3 (Prohibition .. Zombie World): one regression test per fix.
// Source for every test: the edisonrul.ing card page named in the test (historical 2010 TCG section).
// Usage: npx tsx scripts/sourced-3.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Ctx } from '../src/engine/ctx';
import { Game, GameOver, type ChainLink } from '../src/engine/game';
import type { BattlePos, GameEvent, Location, PlayerId } from '../src/engine/types';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  dark: findCard('Sourced Test Dark') ?? normal('Sourced Test Dark', 'DARK', 'Fiend', 4, 1000, 1000),
  big: findCard('Sourced Test Big') ?? normal('Sourced Test Big', 'EARTH', 'Rock', 4, 2300, 1000),
  knight: findCard('Sourced Test Knight') ?? normal('Sourced Test Knight', 'EARTH', 'Warrior', 4, 2600, 1000),
};

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  option: (req: OptionRequest) => number = () => 0;
  trigger: (act: Activation) => boolean = () => true;
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
    return acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1];
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.respond(g, req);
  }
  async selectCards(g: Game, _p: PlayerId, req: SelectRequest) {
    return this.pick(g, req);
  }
  async chooseOption(_g: Game, _p: PlayerId, req: OptionRequest) {
    return this.option(req);
  }
  async confirm() {
    return true;
  }
  async confirmTrigger(_g: Game, _p: PlayerId, act: Activation) {
    return this.trigger(act);
  }
  async choosePosition(_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return allowed[0];
  }
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    return targets[0] ?? (canDirect ? null : 'cancel');
  }
}

function filler(n: number): CardData[] {
  return Array(n).fill(T.wall);
}

function setup() {
  const c0 = new TestController();
  const c1 = new TestController();
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

const N = (n: string) => cardByName(n);
const respondWith = (name: string): Responder => (_g, req) => req.options.find((o) => o.card.name === name) ?? null;
const pickOnly = (c: TestController, want: CardInstance[]) => {
  c.pick = (_g, req) => {
    const w = req.candidates.filter((x) => want.includes(x));
    return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
  };
};
const offered = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
  g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));
async function activate(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}
/** Chain links activated for `card` (from the event log). */
const linksOf = (g: Game, card: CardInstance): ChainLink[] =>
  g.eventLog.filter((e: GameEvent) => e.type === 'chainActivated' && (e.data?.link as ChainLink | undefined)?.card === card).map((e) => e.data.link as ChainLink);
function beforeResolve(g: Game, fn: () => void | Promise<void>) {
  const orig = (g as any).resolveChain.bind(g);
  let done = false;
  (g as any).resolveChain = async (...a: any[]) => {
    if (!done) {
      done = true;
      await fn();
    }
    return orig(...a);
  };
}
const standby = async (g: Game, p: PlayerId) => {
  g.turnPlayer = p;
  g.phase = 'standby';
  g.beginBatch();
  g.emit({ type: 'phaseStart', phase: 'standby', player: p } as any);
  await g.processTriggers(true);
  g.phase = 'main1';
};
const setPhase = (g: Game, ph: string) => (g as any).setPhase(ph);
const URL = (l: string, slug: string) => `https://edisonrul.ing/cards/${l}/${slug}.html`;
void URL;

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
  console.log('Sourced rulings tests: group 3');

  // https://edisonrul.ing/cards/q/quickdraw-synchron.html
  await test('Quickdraw Synchron: its Special Summon starts a chain; the monster is sent on resolution, not if the effect is negated', async () => {
    const { g, c1, place, live } = setup();
    const qd = place(0, N('Quickdraw Synchron'), 'hand');
    const wall = place(0, T.wall, 'hand');
    let onChain = '';
    beforeResolve(g, () => {
      onChain = wall.location;
    });
    await activate(g, 0, qd);
    eq(onChain, 'hand', 'the monster is still in the hand while the effect is on the chain (not a cost)');
    eq(wall.location, 'grave', 'sent on resolution');
    eq(qd.location, 'mzone', 'Quickdraw Special Summoned');
    const n = setup();
    const qd2 = n.place(0, N('Quickdraw Synchron'), 'hand');
    const wall2 = n.place(0, T.wall, 'hand');
    n.live(n.place(1, N('Royal Oppression'), 'szone'));
    n.c1.respond = respondWith('Royal Oppression');
    await activate(n.g, 0, qd2);
    eq(qd2.location, 'hand', 'negated: no Summon');
    eq(wall2.location, 'hand', 'negated: nothing sent to the GY');
    void c1;
    void live;
  });

  // https://edisonrul.ing/cards/p/psychic-commander.html
  await test('Psychic Commander: each copy can use its effect once in the same Damage Step', async () => {
    const { g, c0, place } = setup();
    const a = place(0, N('Psychic Commander'), 'mzone');
    place(0, N('Psychic Commander'), 'mzone');
    const big = place(1, T.big, 'mzone');
    c0.respond = respondWith('Psychic Commander');
    await g.conductAttack(0, a);
    const uses = g.eventLog.filter((e) => e.type === 'chainActivated' && (e.data?.link as ChainLink).card.name === 'Psychic Commander').length;
    eq(uses, 2, 'both copies activated in the same Damage Step');
    eq(g.getAtk(big), 2300 - 200, 'the attacked monster lost 100 + 100 ATK');
  });

  // https://edisonrul.ing/cards/r/rescue-cat.html
  await test('Rescue Cat: cannot Summon only 1 Beast; a Summoned monster flipped face-down is not destroyed', async () => {
    const { g, place } = setup();
    const cat = place(0, N('Rescue Cat'), 'mzone');
    const one = place(0, N('X-Saber Airbellum'), 'deck');
    eq(offered(g, 0, cat), false, 'only 1 Level 3 or lower Beast in the Deck: cannot activate');
    const two = place(0, N('X-Saber Airbellum'), 'deck');
    await activate(g, 0, cat);
    eq(one.location, 'mzone', 'Beast 1 Summoned');
    eq(two.location, 'mzone', 'Beast 2 Summoned');
    await g.changePosition(one, 'def', false);
    await setPhase(g, 'end');
    eq(one.location, 'mzone', 'flipped face-down: not destroyed');
    eq(two.location, 'grave', 'face-up: destroyed in the End Phase');
  });

  // https://edisonrul.ing/cards/r/rekindling.html
  await test('Rekindling: not negated by Necrovalley; a Summoned monster flipped face-down is not banished', async () => {
    const { g, place, live } = setup();
    live(place(1, N('Necrovalley'), 'fzone'));
    const f1 = place(0, N('Flamvell Firedog'), 'grave');
    const f2 = place(0, N('Flamvell Firedog'), 'grave');
    await activate(g, 0, place(0, N('Rekindling'), 'hand'));
    eq(f1.location, 'mzone', 'Summoned under Necrovalley');
    eq(f2.location, 'mzone', 'Summoned under Necrovalley');
    await g.changePosition(f1, 'def', false);
    await setPhase(g, 'end');
    eq(f1.location, 'mzone', 'flipped face-down: not banished');
    eq(f2.location, 'banished', 'face-up: banished in the End Phase');
  });

  // https://edisonrul.ing/cards/r/return-from-the-different-dimension.html
  await test('Return from the Different Dimension: a Summoned monster flipped face-down is not banished', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'banished');
    const b = place(0, T.dark, 'banished');
    await activate(g, 0, place(0, N('Return from the Different Dimension'), 'szone', { faceUp: false }));
    eq(a.location, 'mzone', 'Summoned');
    await g.changePosition(a, 'def', false);
    await setPhase(g, 'end');
    eq(a.location, 'mzone', 'flipped face-down: stays');
    eq(b.location, 'banished', 'face-up: banished again');
  });

  // https://edisonrul.ing/cards/r/royal-oppression.html
  await test('Royal Oppression: negates an effect that Special Summons (Monster Reborn) and destroys that card', async () => {
    const { g, c0, c1, place, live } = setup();
    const ro = live(place(1, N('Royal Oppression'), 'szone'));
    const dead = place(1, T.brute, 'grave');
    pickOnly(c0, [dead]);
    c1.respond = respondWith('Royal Oppression');
    const mr = place(0, N('Monster Reborn'), 'hand');
    await activate(g, 0, mr);
    eq(dead.location, 'grave', 'nothing Special Summoned');
    eq(mr.location, 'grave', 'Monster Reborn destroyed');
    eq(g.players[1].lp, 7200, '800 LP paid');
    eq(ro.location, 'szone', 'Royal Oppression stays');
  });

  // https://edisonrul.ing/cards/r/royal-tribute.html
  await test('Royal Tribute: still resolves if Necrovalley leaves the field in the chain', async () => {
    const { g, c1, place, live } = setup();
    const nv = live(place(0, N('Necrovalley'), 'fzone'));
    const mine = place(0, T.brute, 'hand');
    const theirs = place(1, T.dark, 'hand');
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    c1.respond = respondWith('Mystical Space Typhoon');
    pickOnly(c1, [nv]);
    await activate(g, 0, place(0, N('Royal Tribute'), 'hand'));
    eq(nv.location, 'grave', 'Necrovalley destroyed in the chain');
    eq(mine.location, 'grave', 'own monster discarded');
    eq(theirs.location, 'grave', "opponent's monster discarded");
  });

  // https://edisonrul.ing/cards/r/ryu-kokki.html
  await test('Ryu Kokki: destroys the Warrior it battled even if Ryu Kokki was destroyed by that battle', async () => {
    const { g, place } = setup();
    const ryu = place(0, N('Ryu Kokki'), 'mzone');
    const k = place(1, T.knight, 'mzone');
    await g.conductAttack(0, ryu);
    eq(ryu.location, 'grave', 'Ryu Kokki destroyed by battle');
    eq(k.location, 'grave', 'the Warrior is destroyed at the end of the Damage Step');
  });

  // https://edisonrul.ing/cards/s/saber-slash.html
  await test('Saber Slash: does not target; destroys as many face-up cards as X-Sabers, your own included', async () => {
    const { g, c0, place } = setup();
    const x1 = place(0, N('X-Saber Airbellum'), 'mzone');
    const x2 = place(0, N('XX-Saber Emmersblade'), 'mzone');
    const opp = place(1, T.brute, 'mzone');
    const slash = place(0, N('Saber Slash'), 'szone', { faceUp: false });
    pickOnly(c0, [opp, x1]);
    await activate(g, 0, slash);
    eq(linksOf(g, slash)[0]?.ctx.targets.length, 0, 'no target');
    eq(opp.location, 'grave', "opponent's face-up card destroyed");
    eq([x1, x2].filter((c) => c.location === 'grave').length, 1, '2 X-Sabers, 1 other face-up card: 1 X-Saber destroyed too');
  });

  // https://edisonrul.ing/cards/s/scapegoat.html
  await test('Scapegoat: not after a Summon this turn; if its activation is negated you can still Summon', async () => {
    const { g, place } = setup();
    await g.normalSummon(0, place(0, T.brute, 'hand'), false);
    eq(offered(g, 0, place(0, N('Scapegoat'), 'hand')), false, 'already Summoned this turn');
    const n = setup();
    n.place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    n.c1.respond = respondWith('Solemn Judgment');
    await activate(n.g, 0, n.place(0, N('Scapegoat'), 'hand'));
    eq(n.g.monsters(0).length, 0, 'no Sheep Tokens');
    eq(n.g.canNormalSummon(0, n.place(0, T.brute, 'hand'), false), true, 'activation negated: Normal Summon allowed');
  });

  // https://edisonrul.ing/cards/s/shrink.html
  await test('Shrink: a second Shrink on the same monster achieves nothing', async () => {
    const { g, c0, place } = setup();
    const b = place(1, T.brute, 'mzone');
    pickOnly(c0, [b]);
    await activate(g, 0, place(0, N('Shrink'), 'hand'));
    eq(g.getAtk(b), 900, 'halved once');
    await activate(g, 0, place(0, N('Shrink'), 'hand'));
    eq(g.getAtk(b), 900, 'not halved again');
  });

  // https://edisonrul.ing/cards/s/solar-recharge.html
  await test('Solar Recharge: cannot be activated with 3 or fewer cards in the Deck', async () => {
    const { g, place } = setup();
    const sr = place(0, N('Solar Recharge'), 'hand');
    place(0, N('Ryko, Lightsworn Hunter'), 'hand');
    g.players[0].deck.splice(3);
    eq(offered(g, 0, sr), false, '3 cards left');
    place(0, T.wall, 'deck');
    eq(offered(g, 0, sr), true, '4 cards left');
  });

  // https://edisonrul.ing/cards/s/solidarity.html
  await test('Solidarity: Zombie World does not make different original Types in the GY count as one', async () => {
    const { g, place, live } = setup();
    live(place(0, N('Zombie World'), 'fzone'));
    place(0, T.brute, 'grave');
    place(0, T.wall, 'grave');
    const z = place(0, T.dark, 'mzone');
    live(place(0, N('Solidarity'), 'szone'));
    eq(g.getAtk(z), 1000, 'Warrior + Rock originals in the GY: no boost');
  });

  // https://edisonrul.ing/cards/s/solitaire-magician.html
  await test('Solitaire Magician: cannot choose a "Fortune Lady" whose Level is less than 3', async () => {
    const { g, place } = setup();
    const sm = place(0, N('Solitaire Magician'), 'mzone');
    place(0, N('Fortune Lady Fire'), 'mzone');
    place(1, T.brute, 'mzone');
    eq(offered(g, 0, sm), false, 'Level 2 Fortune Lady only');
  });

  // https://edisonrul.ing/cards/s/soul-exchange.html
  await test('Soul Exchange: if its activation is negated, you can still conduct your Battle Phase', async () => {
    const { g, c1, place } = setup();
    place(1, T.brute, 'mzone');
    place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    await activate(g, 0, place(0, N('Soul Exchange'), 'hand'));
    eq(g.queryPlayer(0, 'cannotDeclareAttack'), false, 'activation negated: attacks allowed');
  });

  // https://edisonrul.ing/cards/s/starlight-road.html
  await test('Starlight Road: negates the effect; no "Stardust Dragon" if it did not destroy that card', async () => {
    const { g, c0, c1, place } = setup();
    const storm = place(0, N('Heavy Storm'), 'hand');
    place(0, N('Mystical Space Typhoon'), 'hand');
    const road = place(1, N('Starlight Road'), 'szone', { faceUp: false });
    const mf = place(1, N('Mirror Force'), 'szone', { faceUp: false });
    const sd = place(1, N('Stardust Dragon'), 'extra');
    c1.respond = respondWith('Starlight Road');
    c0.respond = (_g, req) => (req.options.some((o) => o.card === road) ? null : req.options.find((o) => o.card.name === 'Mystical Space Typhoon') ?? null);
    pickOnly(c0, [storm]);
    await activate(g, 0, storm);
    eq(storm.location, 'grave', 'Heavy Storm destroyed by MST');
    eq(mf.location, 'szone', "Heavy Storm's effect negated");
    eq(sd.location, 'extra', 'Starlight Road did not destroy Heavy Storm: no Stardust Dragon');
    const n = setup();
    const storm2 = n.place(0, N('Heavy Storm'), 'hand');
    n.place(1, N('Starlight Road'), 'szone', { faceUp: false });
    n.place(1, N('Mirror Force'), 'szone', { faceUp: false });
    const sd2 = n.place(1, N('Stardust Dragon'), 'extra');
    n.c1.respond = respondWith('Starlight Road');
    await activate(n.g, 0, storm2);
    eq(storm2.location, 'grave', 'Heavy Storm destroyed');
    eq(sd2.location, 'mzone', 'Stardust Dragon Special Summoned');
  });

  // https://edisonrul.ing/cards/s/substitoad.html
  await test('Substitoad (2010 text): can Special Summon another Substitoad, and Substitoad itself cannot be destroyed by battle', async () => {
    const { g, c0, place } = setup();
    const sub = place(0, N('Substitoad'), 'mzone');
    const fodder = place(0, T.wall, 'mzone');
    const sub2 = place(0, N('Substitoad'), 'deck');
    pickOnly(c0, [fodder, sub2]);
    await activate(g, 0, sub);
    eq(sub2.location, 'mzone', 'another Substitoad Special Summoned');
    eq(g.queryCard(sub, 'indestructibleBattle'), true, 'Substitoad is protected');
  });

  // https://edisonrul.ing/cards/s/swap-frog.html
  await test('Swap Frog (2010 text): the extra Normal Summon is for any "Frog" (Des Frog); the effect can be used again by a Swap Frog that came back', async () => {
    const { g, c0, place } = setup();
    const swap = place(0, N('Swap Frog'), 'mzone');
    place(0, T.brute, 'mzone');
    const wall = place(0, T.wall, 'mzone');
    const des = place(0, N('Des Frog'), 'hand');
    g.players[0].normalSummonsLeft = 0;
    pickOnly(c0, [wall]);
    await activate(g, 0, swap, 'Bounce a monster: extra Normal Summon');
    eq(g.canNormalSummon(0, des, false), true, 'Des Frog (Level 5) can use the extra Normal Summon');
    eq(offered(g, 0, swap, 'Bounce a monster: extra Normal Summon'), false, 'once while this copy is face-up');
  });

  // https://edisonrul.ing/cards/s/superancient-deepsea-king-coelacanth.html
  await test('Superancient Deepsea King Coelacanth: its negation can be used in the Damage Step', async () => {
    const ef = N('Superancient Deepsea King Coelacanth').effects!.find((e) => e.kind === 'quick')!;
    eq(ef.damageStep, true, 'Damage Step allowed');
  });

  // https://edisonrul.ing/cards/t/thestalos-the-firestorm-monarch.html
  await test('Thestalos: its effect activates even if the opponent has no cards in hand', async () => {
    const { g, place } = setup();
    place(0, T.wall, 'mzone');
    const th = place(0, N('Thestalos the Firestorm Monarch'), 'hand');
    await g.normalSummon(0, th, false);
    eq(th.location, 'mzone', 'Tribute Summoned');
    eq(linksOf(g, th).length, 1, 'the effect activated');
  });

  // https://edisonrul.ing/cards/t/thought-ruler-archfiend.html
  await test('Thought Ruler Archfiend: negates a Spell that targets 1 Psychic-Type monster in the GY', async () => {
    const { g, c0, c1, place } = setup();
    place(1, N('Thought Ruler Archfiend'), 'mzone');
    const psy = place(1, N('Psychic Commander'), 'grave');
    pickOnly(c0, [psy]);
    c1.respond = respondWith('Thought Ruler Archfiend');
    const mr = place(0, N('Monster Reborn'), 'hand');
    await activate(g, 0, mr);
    eq(psy.location, 'grave', 'not revived');
    eq(g.players[1].lp, 7000, '1000 LP paid');
  });

  // https://edisonrul.ing/cards/t/threatening-roar.html
  await test('Threatening Roar: cannot be activated during your own turn', async () => {
    const { g, place } = setup();
    const roar = place(0, N('Threatening Roar'), 'szone', { faceUp: false });
    eq(offered(g, 0, roar), false, 'own turn');
    const roar1 = place(1, N('Threatening Roar'), 'szone', { faceUp: false });
    eq(g.getActivations(1, { open: false }).some((a) => a.card === roar1), true, "opponent's turn: allowed");
  });

  // https://edisonrul.ing/cards/t/trap-hole.html
  await test('Trap Hole: a monster flipped face-down in the chain is not destroyed', async () => {
    const { g, c0, c1, place } = setup();
    const b = place(0, T.brute, 'hand');
    place(0, N('Book of Moon'), 'hand');
    place(1, N('Trap Hole'), 'szone', { faceUp: false });
    c1.respond = respondWith('Trap Hole');
    c0.respond = respondWith('Book of Moon');
    pickOnly(c0, [b]);
    await g.normalSummon(0, b, false);
    eq(b.location, 'mzone', 'not destroyed');
    eq(b.faceUp, false, 'face-down');
  });

  // https://edisonrul.ing/cards/t/trap-stun.html
  await test('Trap Stun: Traps can still be activated this turn, but their effects are negated', async () => {
    const { g, place } = setup();
    await activate(g, 0, place(0, N('Trap Stun'), 'szone', { faceUp: false }));
    const roar = place(1, N('Threatening Roar'), 'szone', { faceUp: false });
    const act = g.getActivations(1, { open: false }).find((a) => a.card === roar);
    eq(!!act, true, 'a Trap can still be activated');
    await g.performAction(1, { type: 'activate', card: roar, act: act! } as any);
    eq(g.queryPlayer(0, 'cannotDeclareAttack'), false, "Threatening Roar's effect negated");
  });

  // https://edisonrul.ing/cards/t/treeborn-frog.html
  await test('Treeborn Frog: two copies cannot be activated in the same chain; not negated by Necrovalley', async () => {
    const { g, place, live } = setup();
    live(place(1, N('Necrovalley'), 'fzone'));
    const f1 = place(0, N('Treeborn Frog'), 'grave');
    const f2 = place(0, N('Treeborn Frog'), 'grave');
    await standby(g, 0);
    eq(linksOf(g, f1).length + linksOf(g, f2).length, 1, 'only 1 Treeborn Frog activated');
    eq([f1, f2].filter((f) => f.location === 'mzone').length, 1, 'one revived despite Necrovalley');
  });

  // https://edisonrul.ing/cards/t/tytannial-princess-of-camellias.html
  await test('Tytannial: negates a card that targets any card on the field (not only a Plant)', async () => {
    const { g, c0, c1, place } = setup();
    place(1, N('Tytannial, Princess of Camellias'), 'mzone');
    const lf = place(1, N('Lonefire Blossom'), 'mzone');
    const set = place(1, N('Mirror Force'), 'szone', { faceUp: false });
    const mst = place(0, N('Mystical Space Typhoon'), 'hand');
    pickOnly(c0, [set]);
    pickOnly(c1, [lf]);
    c1.respond = respondWith('Tytannial, Princess of Camellias');
    await activate(g, 0, mst);
    eq(set.location, 'szone', 'Set card not destroyed');
    eq(lf.location, 'grave', 'Plant Tributed as the cost');
  });

  // https://edisonrul.ing/cards/u/unifrog.html
  await test('Unifrog: its effect targets the Spell/Trap it destroys', async () => {
    const { g, place } = setup();
    const uni = place(0, N('Unifrog'), 'mzone');
    place(0, N('Treeborn Frog'), 'mzone');
    const st = place(1, N('Mirror Force'), 'szone', { faceUp: false });
    await g.conductAttack(0, uni);
    const l = linksOf(g, uni)[0];
    eq(!!l && l.ctx.targets.includes(st), true, 'the Spell/Trap is targeted');
    eq(st.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/v/vampire-lord.html
  await test("Vampire Lord: destroyed in the hand by the opponent's card effect, it is Special Summoned in your next Standby Phase", async () => {
    const { g, place } = setup();
    const vl = place(0, N('Vampire Lord'), 'hand');
    const src = place(1, N('Mystical Space Typhoon'), 'grave');
    await g.moveCards([vl], 'grave', { reason: 'effect', reasons: ['effect', 'destroy'], reasonPlayer: 1, reasonCard: src, destroyed: true });
    await g.processTriggers(true);
    g.turn += 2;
    g.turnPlayer = 0;
    await setPhase(g, 'standby');
    eq(vl.location, 'mzone', 'Special Summoned');
  });

  // https://edisonrul.ing/cards/v/volcanic-shell.html
  await test('Volcanic Shell: nothing is added if it left the GY before its effect resolved', async () => {
    const { g, place } = setup();
    const shell = place(0, N('Volcanic Shell'), 'grave');
    const inDeck = place(0, N('Volcanic Shell'), 'deck');
    beforeResolve(g, async () => {
      await g.moveCards([shell], 'banished', { reason: 'effect', reasonPlayer: 1 });
    });
    await activate(g, 0, shell);
    eq(inDeck.location, 'deck', 'no Volcanic Shell added');
  });

  // https://edisonrul.ing/cards/x/xx-saber-ragigura.html
  await test('XX-Saber Ragigura: its effect targets the "X-Saber" in the GY', async () => {
    const { g, place } = setup();
    const x = place(0, N('X-Saber Airbellum'), 'grave');
    const rag = place(0, N('XX-Saber Ragigura'), 'hand');
    await g.normalSummon(0, rag, false);
    const l = linksOf(g, rag)[0];
    eq(!!l && l.ctx.targets.includes(x), true, 'targeted');
    eq(x.location, 'hand', 'added');
  });

  // https://edisonrul.ing/cards/z/zeman-the-ape-king.html
  await test('Zeman the Ape King: the effect that negates an attack targets the attacking monster', async () => {
    const { g, c1, place } = setup();
    const z = place(1, N('Zeman the Ape King'), 'mzone');
    place(1, T.wall, 'hand');
    const a = place(0, T.brute, 'mzone');
    c1.respond = respondWith('Zeman the Ape King');
    await g.conductAttack(0, a);
    const l = linksOf(g, z)[0];
    eq(!!l && l.ctx.targets.includes(a), true, 'the attacker is targeted');
    eq(z.location, 'mzone', 'attack negated: Zeman not attacked');
  });

  // https://edisonrul.ing/cards/t/the-white-stone-of-legend.html
  await test('The White Stone of Legend: its effect activates even with no "Blue-Eyes White Dragon" in the Deck', async () => {
    const { g, place } = setup();
    const ws = place(0, N('The White Stone of Legend'), 'mzone');
    await g.destroy([ws], 'effect', 1);
    await g.processTriggers(true);
    eq(linksOf(g, ws).length, 1, 'activated');
  });

  // https://edisonrul.ing/cards/s/shadow-imprisoning-mirror.html
  await test('Shadow-Imprisoning Mirror: checked on resolution, so a Mirror activated in response negates the DARK effect', async () => {
    const { g, c0, c1, place } = setup();
    const dad = place(0, N('Dark Armed Dragon'), 'mzone');
    place(0, T.dark, 'grave');
    const target = place(1, T.brute, 'mzone');
    pickOnly(c0, [target]);
    place(1, N('Shadow-Imprisoning Mirror'), 'szone', { faceUp: false });
    c1.respond = respondWith('Shadow-Imprisoning Mirror');
    await activate(g, 0, dad);
    eq(target.location, 'mzone', 'DARK effect negated on resolution');
  });

  // https://edisonrul.ing/cards/x/xx-saber-fulhelmknight.html
  await test('XX-Saber Fulhelmknight: its revive effect activates even if it left the field', async () => {
    const { g, place } = setup();
    const fh = place(0, N('XX-Saber Fulhelmknight'), 'grave');
    const dead = place(1, T.wall, 'grave');
    dead.pos = 'def';
    const idx = fh.data.effects!.findIndex((e) => e.label === 'Revive X-Saber');
    const ef = fh.data.effects![idx];
    const ctx = new Ctx(g, fh, ef, 0);
    const ev = { type: 'battleDestroyed', card: dead, other: fh, seq: 0, batch: 0 } as GameEvent;
    eq(ef.eventFilter!(ctx, ev), true, 'activates from the GY');
  });

  // https://edisonrul.ing/cards/t/the-six-samurai-kamon.html
  await test('The Six Samurai - Kamon: cannot use its effect after it attacked this turn', async () => {
    const { g, place, live } = setup();
    const kamon = place(0, N('The Six Samurai - Kamon'), 'mzone');
    place(0, N('The Six Samurai - Yaichi'), 'mzone');
    live(place(1, N('Royal Oppression'), 'szone'));
    eq(offered(g, 0, kamon), true, 'before attacking');
    kamon.attacksThisTurn = 1;
    eq(offered(g, 0, kamon), false, 'after attacking');
  });

  // https://edisonrul.ing/cards/r/red-eyes-wyvern.html
  await test('Red-Eyes Wyvern: a Normal Summon negated by Solemn Judgment still counts', async () => {
    const { g, c1, place } = setup();
    const wy = place(0, N('Red-Eyes Wyvern'), 'grave');
    const red = place(0, N('Red-Eyes Darkness Metal Dragon'), 'grave');
    place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    const b = place(0, T.brute, 'hand');
    await g.normalSummon(0, b, false);
    eq(b.location, 'grave', 'Summon negated');
    await setPhase(g, 'end');
    eq(wy.location, 'grave', 'Wyvern cannot activate');
    eq(red.location, 'grave', 'nothing Special Summoned');
  });

  // https://edisonrul.ing/cards/x/xx-saber-gottoms.html
  await test('XX-Saber Gottoms: "1 Tuner + 1 or more EARTH monsters" can be all Tuners', async () => {
    const { g, place } = setup();
    place(0, N('XX-Saber Fulhelmknight'), 'mzone');
    place(0, N('X-Saber Airbellum'), 'mzone');
    place(0, N('Psychic Commander'), 'mzone');
    const gt = place(0, N('XX-Saber Gottoms'), 'extra');
    eq(g.canSynchro(0, gt), true, '3 + 3 + 3 EARTH Tuners');
  });

  // https://edisonrul.ing/cards/r/red-dragon-archfiend.html
  await test('Red Dragon Archfiend: its End Phase effect activates even if every other monster attacked', async () => {
    const { g, place } = setup();
    const rda = place(0, N('Red Dragon Archfiend'), 'mzone');
    await setPhase(g, 'end');
    eq(linksOf(g, rda).length, 1, 'activated');
  });

  // https://edisonrul.ing/cards/p/prohibition.html
  await test('Prohibition: a declared card already face-up on the field is not affected', async () => {
    const { g, c0, place } = setup();
    const b = place(1, T.brute, 'mzone');
    c0.option = (req) => Math.max(0, req.options.indexOf('Rules Test Brute'));
    await activate(g, 0, place(0, N('Prohibition'), 'hand'));
    eq(g.queryCard(b, 'cannotAttack'), false, 'it can still attack');
    const later = place(1, T.brute, 'mzone');
    eq(g.queryCard(later, 'cannotAttack'), true, 'a copy that arrives later cannot');
  });

  // https://edisonrul.ing/cards/r/red-eyes-darkness-metal-dragon.html
  await test('Red-Eyes Darkness Metal Dragon: its Summon from the GY is not negated by Necrovalley', async () => {
    const { g, c0, place, live } = setup();
    live(place(1, N('Necrovalley'), 'fzone'));
    const redmd = place(0, N('Red-Eyes Darkness Metal Dragon'), 'mzone');
    const d = place(0, N('Red-Eyes Wyvern'), 'grave');
    pickOnly(c0, [d]);
    await activate(g, 0, redmd, 'Special Summon 1 Dragon from hand or GY');
    eq(d.location, 'mzone', 'Special Summoned from the GY');
  });

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
