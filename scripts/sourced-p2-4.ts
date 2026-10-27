// Sourced rulings sweep, phase 2 group p2-4 (Nature's Reflection .. Small Piece Golem): one regression test per fix.
// Source for every test: the edisonrul.ing card page named above the test (historical 2010 TCG section).
// Usage: npx tsx scripts/sourced-p2-4.ts
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

const Y = {
  cloudian: findCard('Cloudian Test Nimbus') ?? normal('Cloudian Test Nimbus', 'WATER', 'Fairy', 4, 2500, 0),
  ei: findCard('Earthbound Immortal Test') ?? normal('Earthbound Immortal Test', 'DARK', 'Fiend', 10, 3000, 3000),
  wind: findCard('Sourced Test Wind') ?? normal('Sourced Test Wind', 'WIND', 'Winged Beast', 4, 1500, 1000),
  beasts: [1, 2, 3, 4, 5, 6, 7].map((i) => findCard(`Crystal Beast Test ${i}`) ?? normal(`Crystal Beast Test ${i}`, 'LIGHT', 'Beast', 4, 1000, 1000)),
};
const X = {
  bat1: findCard('Batteryman Test One') ?? normal('Batteryman Test One', 'LIGHT', 'Thunder', 3, 1000, 1000),
  bat2: findCard('Batteryman Test Two') ?? normal('Batteryman Test Two', 'LIGHT', 'Thunder', 3, 1000, 1000),
  fiend: findCard('Sourced Test Fiend') ?? normal('Sourced Test Fiend', 'DARK', 'Fiend', 4, 1500, 1000),
  plant: findCard('Sourced Test Plant') ?? normal('Sourced Test Plant', 'EARTH', 'Plant', 4, 1200, 1000),
  tiny: findCard('Sourced Test Tiny') ?? normal('Sourced Test Tiny', 'EARTH', 'Warrior', 2, 800, 400),
};
/** Run `fn` right after damage calculation (before battle-destroyed monsters leave the field). */
function afterDamageCalc(g: Game, fn: () => void) {
  const orig = g.emit.bind(g);
  (g as any).emit = (ev: any) => {
    const r = orig(ev);
    if (ev.type === 'damageCalculated') fn();
    return r;
  };
}
const nextTurn = (g: Game) => {
  g.turn += 2;
  g.phase = 'main1';
};

(async () => {
  console.log('Sourced rulings tests: phase 2 group p2-4');

  // https://edisonrul.ing/cards/n/neos-wiseman.html
  await test('Neos Wiseman: destroyed monster uses its original ATK/DEF; a monster returned to the hand gives nothing', async () => {
    const a = setup();
    const w = a.place(0, N('Neos Wiseman'), 'mzone');
    a.place(1, T.big, 'mzone');
    await a.g.conductAttack(0, w);
    eq(a.g.players[1].lp, 8000 - 700 - 2300, 'battle damage 700, then 2300 (original ATK)');
    eq(a.g.players[0].lp, 9000, 'gained 1000 (original DEF)');
    const b = setup();
    const w2 = b.place(0, N('Neos Wiseman'), 'mzone');
    const t = b.place(1, T.wall, 'mzone', { pos: 'def' });
    afterDamageCalc(b.g, () => b.g.rawMove(t, 'hand', { controller: 1 }));
    await b.g.conductAttack(0, w2);
    eq(b.g.players[1].lp, 8000, 'no damage');
    eq(b.g.players[0].lp, 8000, 'no LP gain');
  });

  // https://edisonrul.ing/cards/n/nightmare-archfiends.html
  await test('Nightmare Archfiends: the 800 damage when a Token is destroyed does not start a chain', async () => {
    const { g, place } = setup();
    place(0, T.brute, 'mzone');
    const na = place(0, N('Nightmare Archfiends'), 'szone', { faceUp: false });
    await activate(g, 0, na);
    const toks = g.monsters(1).filter((c) => c.isToken);
    eq(toks.length, 3, "3 Tokens on the opponent's field");
    const before = g.eventLog.filter((e) => e.type === 'chainActivated').length;
    g.beginBatch();
    await g.destroy([toks[0]], 'effect', 0);
    await g.processTriggers(true);
    eq(g.players[1].lp, 7200, "800 damage to the Token's controller");
    eq(g.eventLog.filter((e) => e.type === 'chainActivated').length, before, 'no chain link');
  });

  // https://edisonrul.ing/cards/o/ojama-country.html
  await test('Ojama Country: needs an "Ojama" monster in the GY; the Ojama sent as the cost can be the target', async () => {
    const { g, c0, place, live } = setup();
    const oc = live(place(0, N('Ojama Country'), 'fzone'));
    const red = place(0, N('Ojama Red'), 'hand');
    eq(offered(g, 0, oc, 'Send an Ojama: revive an Ojama'), false, 'no Ojama monster in the GY: cannot activate');
    place(0, N('Ojama Blue'), 'grave');
    pickOnly(c0, [red]);
    await activate(g, 0, oc, 'Send an Ojama: revive an Ojama');
    eq(red.location, 'mzone', 'the Ojama sent as the cost was targeted and Special Summoned');
  });

  // https://edisonrul.ing/cards/o/omega-goggles.html
  await test('Omega Goggles: if unequipped after using its effect, the monster can attack', async () => {
    const { g, place, live } = setup();
    const m = place(0, T.brute, 'mzone');
    const og = live(place(0, N('Omega Goggles'), 'szone'));
    g.equip(og, m);
    place(1, T.wall, 'hand');
    await activate(g, 0, og, "Look at 1 random card in the opponent's hand");
    eq(g.canAttack(m), false, 'cannot attack while equipped');
    await g.destroy([og], 'effect', 1);
    eq(g.canAttack(m), true, 'unequipped: can attack');
  });

  // https://edisonrul.ing/cards/p/phoenixian-cluster-amaryllis.html
  await test('Phoenixian Cluster Amaryllis: destroyed after damage calculation without a chain; not by itself when destroyed by battle', async () => {
    const a = setup();
    const am = a.place(0, N('Phoenixian Cluster Amaryllis'), 'mzone');
    const w = a.place(1, T.wall, 'mzone');
    await a.g.conductAttack(0, am);
    eq(w.location, 'grave', 'the attack target was destroyed');
    eq(am.location, 'grave', 'Amaryllis destroyed itself');
    eq(linksOf(a.g, am).filter((l) => l.effect.label === 'Destroyed after attacking').length, 0, 'no chain link for the self-destruction');
    eq(a.g.players[1].lp, 8000 - 1700 - 800, 'battle damage, then 800 for Amaryllis');
    const b = setup();
    const am2 = b.place(0, N('Phoenixian Cluster Amaryllis'), 'mzone');
    b.place(1, T.knight, 'mzone');
    await b.g.conductAttack(0, am2);
    eq(am2.location, 'grave', 'destroyed by battle');
    eq(b.g.eventLog.filter((e) => e.type === 'destroyed' && e.card === am2).length, 1, 'destroyed once (by battle only)');
  });

  // https://edisonrul.ing/cards/p/pixie-ring.html
  await test('Pixie Ring: your lowest-ATK monster cannot be attacked even in Defense Position', async () => {
    const { g, place, live } = setup();
    live(place(1, N('Pixie Ring'), 'szone'));
    const b1 = place(1, T.brute, 'mzone');
    place(1, T.big, 'mzone');
    const w = place(1, T.wall, 'mzone', { pos: 'def' });
    const att = place(0, T.knight, 'mzone');
    const ts = g.attackTargets(att).targets;
    eq(ts.includes(w), false, 'the Defense Position monster with the lowest ATK cannot be attacked');
    eq(ts.includes(b1), true, 'the others can');
  });

  // https://edisonrul.ing/cards/p/poison-chain.html
  await test('Poison Chain: does not activate if the opponent has fewer cards in the Deck than your Iron Chain monsters', async () => {
    const { g, place, live } = setup();
    const pc = live(place(0, N('Poison Chain'), 'szone'));
    place(0, N('Iron Chain Repairman'), 'mzone');
    place(0, N('Iron Chain Repairman'), 'mzone');
    for (const c of [...g.players[1].deck].slice(1)) g.rawMove(c, 'banished');
    await setPhase(g, 'end');
    eq(linksOf(g, pc).length, 0, '1 card in the Deck, 2 Iron Chain monsters: no activation');
    eq(g.players[1].deck.length, 1, 'nothing sent');
  });

  // https://edisonrul.ing/cards/p/power-pickaxe.html
  await test('Power Pickaxe: the gain is lost when it leaves the field; no removal if the Level is now too high', async () => {
    const a = setup();
    const m = a.place(0, T.brute, 'mzone');
    const pk = a.live(a.place(0, N('Power Pickaxe'), 'szone'));
    a.g.equip(pk, m);
    const d = a.place(1, T.dark, 'grave');
    await activate(a.g, 0, pk, 'Banish from GY: +500 ATK');
    eq(d.location, 'banished', 'removed from play');
    eq(a.g.getAtk(m), 2300, '+500 ATK');
    await a.g.destroy([pk], 'effect', 1);
    eq(a.g.getAtk(m), 1800, 'Power Pickaxe destroyed: the gain is lost');
    const b = setup();
    const m2 = b.place(0, T.brute, 'mzone');
    const pk2 = b.live(b.place(0, N('Power Pickaxe'), 'szone'));
    b.g.equip(pk2, m2);
    const d2 = b.place(1, T.dark, 'grave');
    beforeResolve(b.g, () => b.g.addTempMod(m2, 'level', -1));
    await activate(b.g, 0, pk2, 'Banish from GY: +500 ATK');
    eq(d2.location, 'grave', 'the target now has a higher Level: not removed');
    eq(b.g.getAtk(m2), 1800, 'no ATK gain');
  });

  // https://edisonrul.ing/cards/p/power-supplier.html
  await test('Power Supplier: cannot be applied again to a monster it already targets', async () => {
    const { g, c0, place } = setup();
    const ps = place(0, N('Power Supplier'), 'mzone');
    const m = place(0, T.brute, 'mzone');
    place(0, X.tiny, 'mzone');
    pickOnly(c0, [m]);
    await activate(g, 0, ps, '+400 ATK');
    eq(g.getAtk(m), 2200, '+400 ATK');
    nextTurn(g);
    let cands: CardInstance[] = [];
    c0.pick = (_g, req) => {
      cands = req.candidates;
      return req.candidates.slice(0, 1);
    };
    await activate(g, 0, ps, '+400 ATK');
    eq(cands.length, 2, 'the other monsters can be selected');
    eq(cands.includes(m), false, 'the monster it already targets is not selectable');
  });

  // https://edisonrul.ing/cards/p/prideful-roar.html
  await test('Prideful Roar: no effect if your monster no longer has lower ATK when it resolves', async () => {
    const { g, c1, place } = setup();
    const att = place(0, T.knight, 'mzone');
    const mine = place(1, T.brute, 'mzone');
    place(1, N('Prideful Roar'), 'szone', { faceUp: false });
    c1.respond = (gg, req) => (gg.battle?.inDamageStep ? req.options.find((o) => o.card.name === 'Prideful Roar') ?? null : null);
    beforeResolve(g, () => g.addTempMod(mine, 'atk', 1000, 'turn'));
    await g.conductAttack(0, att);
    eq(g.players[1].lp, 8000 - 800, 'paid 800 LP (the cost), no battle damage');
    eq(g.getAtk(mine), 2800, 'no extra +1100 ATK: only the +1000 applies');
  });

  // https://edisonrul.ing/cards/p/psi-impulse.html
  await test('Psi-Impulse: cannot be activated while the opponent has no cards in hand', async () => {
    const { g, place } = setup();
    place(0, N('Psychic Commander'), 'mzone');
    const pi = place(0, N('Psi-Impulse'), 'hand');
    eq(offered(g, 0, pi), false, 'opponent has no cards in hand');
    place(1, T.wall, 'hand');
    eq(offered(g, 0, pi), true, 'opponent has a card in hand');
  });

  // https://edisonrul.ing/cards/p/psychokinesis.html
  await test('Psychokinesis: no damage if the target left the field in the chain', async () => {
    const { g, c0, place } = setup();
    place(0, N('Psychic Commander'), 'mzone');
    const t = place(1, T.brute, 'mzone');
    pickOnly(c0, [t]);
    beforeResolve(g, () => {
      g.rawMove(t, 'hand', { controller: 1 });
    });
    await activate(g, 0, place(0, N('Psychokinesis'), 'hand'));
    eq(g.players[0].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/p/puppet-master.html
  await test('Puppet Master: if 1 target leaves the GY, the other is still Special Summoned', async () => {
    const { g, place } = setup();
    const f1 = place(0, X.fiend, 'grave');
    const f2 = place(0, T.dark, 'grave');
    const pm = place(0, N('Puppet Master'), 'mzone');
    beforeResolve(g, () => {
      g.rawMove(f1, 'banished');
    });
    g.beginBatch();
    g.emit({ type: 'tributeSummoned', card: pm, player: 0 } as any);
    await g.processTriggers(true);
    eq(f2.location, 'mzone', 'the remaining target is Special Summoned');
    eq(g.players[0].lp, 6000, '2000 LP paid');
  });

  // https://edisonrul.ing/cards/q/quick-charger.html
  await test('Quick Charger: targets 2 Batteryman; the other is still added if one leaves the GY', async () => {
    const { g, place } = setup();
    const b1 = place(0, X.bat1, 'grave');
    const b2 = place(0, X.bat2, 'grave');
    const qc = place(0, N('Quick Charger'), 'hand');
    beforeResolve(g, () => {
      g.rawMove(b1, 'banished');
    });
    await activate(g, 0, qc);
    eq(b2.location, 'hand', 'the remaining target is added');
    eq(linksOf(g, qc)[0].ctx.targets.length, 2, 'both were targeted on activation');
  });

  // https://edisonrul.ing/cards/r/rain-storm.html
  await test('Rain Storm: the effect to apply is chosen when it resolves', async () => {
    const { g, c0, place } = setup();
    const cl = place(0, Y.cloudian, 'mzone');
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    place(1, T.brute, 'mzone');
    let resolving = false;
    let askedWhileResolving: boolean | null = null;
    beforeResolve(g, () => {
      resolving = true;
    });
    c0.option = (req) => {
      if (req.prompt.startsWith('Rain Storm')) askedWhileResolving = resolving;
      return 1;
    };
    await activate(g, 0, place(0, N('Rain Storm'), 'szone', { faceUp: false }));
    eq(askedWhileResolving, true, 'the choice is made on resolution');
    eq(g.getAtk(cl), 2500 - 2000, 'ATK reduced by 2000');
  });

  // https://edisonrul.ing/cards/r/raging-mad-plants.html
  await test('Raging Mad Plants: the End Phase destruction only hits face-up Plant-Type monsters', async () => {
    const { g, place } = setup();
    const up = place(0, X.plant, 'mzone');
    const down = place(0, X.plant, 'mzone', { faceUp: false, pos: 'def' });
    place(0, X.plant, 'grave');
    await activate(g, 0, place(0, N('Raging Mad Plants'), 'hand'));
    await setPhase(g, 'end');
    eq(up.location, 'grave', 'face-up Plant destroyed');
    eq(down.location, 'mzone', 'face-down Plant stays');
  });

  // https://edisonrul.ing/cards/r/rainbow-gravity.html
  await test('Rainbow Gravity: an Ultimate Crystal monster in the GY that was not properly Summoned cannot be Summoned', async () => {
    const { g, place } = setup();
    for (const cb of Y.beasts) place(0, cb, 'grave');
    const rdd = place(0, N('Rainbow Dark Dragon'), 'grave');
    const rg = place(0, N('Rainbow Gravity'), 'szone', { faceUp: false });
    eq(offered(g, 0, rg), false, 'never properly Summoned: not a legal choice');
    rdd.properlySummoned = true;
    eq(offered(g, 0, rg), true, 'properly Summoned before: legal');
  });

  // https://edisonrul.ing/cards/r/raptor-wing-strike.html
  await test('Raptor Wing Strike: a Blackwing Synchro Monster can pay the cost (returns to the Extra Deck)', async () => {
    const { g, place } = setup();
    const am = place(0, N('Blackwing Armor Master'), 'mzone');
    const bora = place(0, N('Blackwing - Bora the Spear'), 'deck');
    await activate(g, 0, place(0, N('Raptor Wing Strike'), 'hand'));
    eq(am.location, 'extra', 'the Synchro Monster returned to the Extra Deck');
    eq(bora.location, 'hand', 'Blackwing added');
  });

  // https://edisonrul.ing/cards/r/reasoning.html
  await test('Reasoning: not after Scapegoat; if no monster is picked up, the Deck is put back', async () => {
    const a = setup();
    const r1 = a.place(0, N('Reasoning'), 'hand');
    a.g.addPlayerMod(0, 'cannotSpecialSummon');
    eq(offered(a.g, 0, r1), false, 'cannot Special Summon this turn (Scapegoat): cannot activate');
    const b = setup();
    for (const c of [...b.g.players[0].deck]) b.g.rawMove(c, 'banished');
    for (let i = 0; i < 3; i++) b.place(0, N('Ookazi'), 'deck');
    await activate(b.g, 0, b.place(0, N('Reasoning'), 'hand'));
    eq(b.g.players[0].deck.length, 3, 'no monster: the cards go back to the Deck');
    eq(b.g.players[0].grave.filter((c) => c.name === 'Ookazi').length, 0, 'nothing sent to the GY');
  });

  // https://edisonrul.ing/cards/r/reinforce-truth.html
  await test('Reinforce Truth: if its activation is negated you can still conduct your Battle Phase', async () => {
    const { g, c1, place } = setup();
    place(0, X.tiny, 'deck');
    place(1, N('Solemn Judgment'), 'szone', { faceUp: false });
    c1.respond = respondWith('Solemn Judgment');
    await activate(g, 0, place(0, N('Reinforce Truth'), 'szone', { faceUp: false }));
    eq(g.queryPlayer(0, 'cannotDeclareAttack'), false, 'activation negated: Battle Phase allowed');
    const b = setup();
    b.place(0, X.tiny, 'deck');
    await activate(b.g, 0, b.place(0, N('Reinforce Truth'), 'szone', { faceUp: false }));
    eq(b.g.queryPlayer(0, 'cannotDeclareAttack'), true, 'resolved: no Battle Phase');
  });

  // https://edisonrul.ing/cards/r/release-restraint-wave.html
  await test('Release Restraint Wave: cannot be activated if the opponent has no Set Spell/Trap Cards', async () => {
    const { g, place, live } = setup();
    const m = place(0, T.brute, 'mzone');
    const eqp = live(place(0, N('Omega Goggles'), 'szone'));
    g.equip(eqp, m);
    const rrw = place(0, N('Release Restraint Wave'), 'hand');
    eq(offered(g, 0, rrw), false, 'no Set Spell/Trap: cannot activate');
    place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    eq(offered(g, 0, rrw), true, 'with a Set card: can activate');
  });

  // https://edisonrul.ing/cards/r/revival-gift.html
  await test('Revival Gift: cannot be activated if the opponent has 1 or fewer empty Monster Zones', async () => {
    const { g, place } = setup();
    place(0, N('Krebons'), 'grave');
    for (let i = 0; i < 4; i++) place(1, T.wall, 'mzone');
    const rg = place(0, N('Revival Gift'), 'szone', { faceUp: false });
    eq(offered(g, 0, rg), false, '1 empty zone: cannot activate');
    g.rawMove(g.monsters(1)[0], 'grave');
    eq(offered(g, 0, rg), true, '2 empty zones: can activate');
  });

  // https://edisonrul.ing/cards/r/ribbon-of-rebirth.html
  await test('Ribbon of Rebirth: no Special Summon if Ribbon is not in the GY or removed zone in the End Phase', async () => {
    for (const leave of [false, true]) {
      const { g, place, live } = setup();
      const m = place(0, T.brute, 'mzone');
      const rb = live(place(0, N('Ribbon of Rebirth'), 'szone'));
      g.equip(rb, m);
      place(1, T.knight, 'mzone');
      await g.conductAttack(0, m);
      eq(m.location, 'grave', 'destroyed by battle');
      if (leave) g.rawMove(rb, 'hand', { controller: 0 });
      await setPhase(g, 'end');
      eq(m.location, leave ? 'grave' : 'mzone', leave ? 'Ribbon in the hand: not Summoned' : 'Ribbon in the GY: Summoned');
    }
  });

  // https://edisonrul.ing/cards/r/roar-of-the-earthbound-immortal.html
  await test('Roar of the Earthbound Immortal: activates automatically when a weaker monster attacks', async () => {
    const { g, c1, place, live } = setup();
    const roar = live(place(1, N('Roar of the Earthbound Immortal'), 'szone'));
    place(1, Y.ei, 'mzone');
    place(1, T.wall, 'mzone', { pos: 'def' });
    c1.trigger = () => false;
    const att = place(0, T.brute, 'mzone');
    await g.conductAttack(0, att);
    eq(linksOf(g, roar).length, 1, 'activated (mandatory)');
    eq(att.location, 'grave', 'attacker destroyed');
    eq(g.players[0].lp, 8000 - 900, 'half its ATK as damage');
  });

  // https://edisonrul.ing/cards/s/sacred-phoenix-of-nephthys.html
  await test("Sacred Phoenix of Nephthys: returns in its owner's next Standby Phase; the Spell/Trap destruction is its own chain link", async () => {
    const { g, place } = setup();
    const sp = place(0, N('Sacred Phoenix of Nephthys'), 'mzone');
    const st = place(1, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    g.beginBatch();
    await g.destroy([sp], 'effect', 1);
    await g.processTriggers(true);
    eq(sp.location, 'grave', 'destroyed');
    g.turn = 3;
    await standby(g, 1);
    eq(sp.location, 'grave', "not in the opponent's Standby Phase");
    g.turn = 4;
    await standby(g, 0);
    eq(sp.location, 'mzone', 'Special Summoned in its next Standby Phase');
    eq(st.location, 'grave', 'Spell/Trap Cards destroyed');
    const labels = linksOf(g, sp).map((l) => l.effect.label);
    eq(labels.includes('Special Summon this card') && labels.includes('Destroy all Spells and Traps'), true, 'two separate Trigger Effects');
  });

  // https://edisonrul.ing/cards/s/samsara-lotus.html
  await test('Samsara Lotus: flipped face-down in the chain, its damage effect disappears', async () => {
    const { g, place } = setup();
    const sl = place(0, N('Samsara Lotus'), 'mzone');
    beforeResolve(g, () => g.changePosition(sl, 'def', false));
    await standby(g, 0);
    eq(linksOf(g, sl).length, 1, 'it activated');
    eq(g.players[0].lp, 8000, 'no damage');
  });

  // https://edisonrul.ing/cards/s/savage-colosseum.html
  await test('Savage Colosseum: no LP if the attacker left the field; the End Phase effect activates even with no monsters', async () => {
    const { g, place, live } = setup();
    const sc = live(place(0, N('Savage Colosseum'), 'fzone'));
    const att = place(0, T.brute, 'mzone');
    place(1, X.tiny, 'mzone', { pos: 'def' });
    afterDamageCalc(g, () => g.rawMove(att, 'hand', { controller: 0 }));
    await g.conductAttack(0, att);
    eq(g.players[0].lp, 8000, 'no 300 LP');
    const n = linksOf(g, sc).length;
    await setPhase(g, 'end');
    eq(linksOf(g, sc).length, n + 1, 'End Phase effect activated with no monster to destroy');
  });

  // https://edisonrul.ing/cards/s/scary-moth.html
  await test('Scary Moth: Special Summons before it was Summoned do not count', async () => {
    const { g, place } = setup();
    const a = place(0, T.brute, 'hand');
    const moth = place(0, N('Scary Moth'), 'hand');
    const b = place(0, T.dark, 'hand');
    await g.specialSummon([a], 0, { pos: 'atk' });
    await g.specialSummon([moth], 0, { pos: 'atk' });
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), false, 'earlier Special Summons (and its own) do not count');
    await g.specialSummon([b], 0, { pos: 'atk' });
    eq(g.queryPlayer(0, 'cannotSpecialSummon'), true, 'one Special Summon after it: no more');
  });

  // https://edisonrul.ing/cards/s/seal-of-wickedness.html
  await test("Seal of Wickedness: a mandatory effect that starts a chain in the opponent's Standby Phase", async () => {
    const { g, c0, place, live } = setup();
    const seal = live(place(0, N('Seal of Wickedness'), 'szone'));
    place(1, N('Psychic Commander'), 'mzone');
    c0.trigger = () => false;
    await standby(g, 1);
    eq(linksOf(g, seal).length, 1, 'activated although the player declined optional triggers');
  });

  // https://edisonrul.ing/cards/s/shield-warrior.html
  await test('Shield Warrior: cannot be activated if your monster would not be destroyed by the battle', async () => {
    for (const strong of [false, true]) {
      const { g, c0, place } = setup();
      g.turnPlayer = 1;
      const sw = place(0, N('Shield Warrior'), 'grave');
      place(0, T.brute, 'mzone');
      const att = place(1, strong ? T.knight : X.tiny, 'mzone');
      let seen = false;
      c0.respond = (gg, req) => {
        if (gg.battle?.inDamageStep && req.options.some((o) => o.card === sw)) seen = true;
        return null;
      };
      await g.conductAttack(1, att);
      eq(seen, strong, strong ? 'your monster would be destroyed: offered' : 'not destroyed: not offered');
    }
  });

  // https://edisonrul.ing/cards/s/shire-lightsworn-spirit.html
  await test('Shire, Lightsworn Spirit: flipped face-down in the chain, nothing is sent', async () => {
    const { g, place } = setup();
    const sh = place(0, N('Shire, Lightsworn Spirit'), 'mzone');
    const n = g.players[0].deck.length;
    beforeResolve(g, () => g.changePosition(sh, 'def', false));
    await setPhase(g, 'end');
    eq(linksOf(g, sh).length, 1, 'it activated');
    eq(g.players[0].deck.length, n, 'nothing sent to the GY');
  });

  // https://edisonrul.ing/cards/s/silver-wing.html
  await test('Silver Wing: copies are not cumulative; no replacement when destroyed together with the monster', async () => {
    const a = setup();
    const sd = a.place(0, N('Stardust Dragon'), 'mzone');
    const w1 = a.live(a.place(0, N('Silver Wing'), 'szone'));
    const w2 = a.live(a.place(0, N('Silver Wing'), 'szone'));
    a.g.equip(w1, sd);
    a.g.equip(w2, sd);
    const saved = [];
    for (let i = 0; i < 3; i++) saved.push((await a.g.applyDestroyReplacements([sd], 'battle', 1)).includes(sd) ? 'destroyed' : 'saved');
    eq(saved.join(','), 'saved,saved,destroyed', 'only 2 battle protections per turn with 2 copies');
    const b = setup();
    const sd2 = b.place(0, N('Stardust Dragon'), 'mzone');
    const w3 = b.live(b.place(0, N('Silver Wing'), 'szone'));
    b.g.equip(w3, sd2);
    await b.g.destroy([sd2, w3], 'effect', 1);
    eq(sd2.location, 'grave', 'destroyed at the same time: no replacement');
  });

  // https://edisonrul.ing/cards/s/simorgh-bird-of-ancestry.html
  await test("Simorgh, Bird of Ancestry: targets the opponent's cards on activation", async () => {
    const { g, place } = setup();
    const s = place(0, N('Simorgh, Bird of Ancestry'), 'mzone');
    const t = place(1, T.brute, 'mzone');
    const w = place(0, Y.wind, 'grave');
    g.beginBatch();
    g.emit({ type: 'tributeSummoned', card: s, player: 0, tributes: [w] } as any);
    await g.processTriggers(true);
    eq(linksOf(g, s)[0]?.ctx.targets.includes(t), true, 'targeted');
    eq(t.location, 'hand', 'returned');
  });

  // https://edisonrul.ing/cards/s/sinister-seeds.html
  await test('Sinister Seeds: cannot be activated without an empty Monster Zone for every Token', async () => {
    for (const crowded of [false, true]) {
      const { g, c1, place } = setup();
      const ss = place(1, N('Sinister Seeds'), 'szone', { faceUp: false });
      place(1, X.tiny, 'mzone');
      if (crowded) for (let i = 0; i < 4; i++) place(1, T.wall, 'mzone', { pos: 'def' });
      c1.respond = respondWith('Sinister Seeds');
      const att = place(0, T.knight, 'mzone');
      (g as any).controllers[0].chooseAttackTarget = async (_g: Game, _p: PlayerId, _a: CardInstance, ts: CardInstance[]) => ts.find((c) => c.name === X.tiny.name)!;
      await g.conductAttack(0, att);
      eq(linksOf(g, ss).length, crowded ? 0 : 1, crowded ? '3 Tokens, 1 empty zone: cannot activate' : 'enough zones: activated');
    }
  });

  // https://edisonrul.ing/cards/s/slip-summon.html
  await test('Slip Summon: a monster unaffected by Traps is not returned to the hand', async () => {
    const { g, c0, place } = setup();
    g.turnPlayer = 1;
    const wh = place(0, N('Elemental Hero Wildheart'), 'hand');
    place(0, N('Slip Summon'), 'szone', { faceUp: false });
    pickOnly(c0, [wh]);
    c0.respond = respondWith('Slip Summon');
    await g.normalSummon(1, place(1, T.brute, 'hand'), false);
    eq(wh.location, 'mzone', 'Special Summoned');
    await setPhase(g, 'end');
    eq(wh.location, 'mzone', 'Wildheart stays on the field');
  });

  // https://edisonrul.ing/cards/s/small-piece-golem.html
  await test('Small Piece Golem: Medium Piece Golem is still Summoned if the only Big Piece Golem left the field', async () => {
    const { g, place } = setup();
    const sm = place(0, N('Small Piece Golem'), 'mzone');
    const big = place(0, N('Big Piece Golem'), 'mzone');
    const med = place(0, N('Medium Piece Golem'), 'deck');
    beforeResolve(g, () => {
      g.rawMove(big, 'hand', { controller: 0 });
    });
    g.beginBatch();
    g.emit({ type: 'summoned', card: sm, player: 0, method: 'normal' } as any);
    await g.processTriggers(true);
    eq(med.location, 'mzone', 'Medium Piece Golem Special Summoned');
  });

  // https://edisonrul.ing/cards/p/parry.html
  await test('Parry: the Gladiator Beast is returned to the Deck on resolution, not as a cost', async () => {
    const { g, c1, place } = setup();
    const gb = place(1, N('Gladiator Beast Laquari'), 'hand');
    place(1, N('Parry'), 'szone', { faceUp: false });
    c1.respond = respondWith('Parry');
    let onChain = '';
    beforeResolve(g, () => {
      onChain = gb.location;
    });
    const nn = place(0, N('Needlebug Nest'), 'szone', { faceUp: false });
    await activate(g, 0, nn);
    eq(onChain, 'hand', 'still in the hand while Parry is on the chain');
    eq(gb.location, 'deck', 'returned to the Deck on resolution');
    eq(nn.location, 'grave', 'the Trap Card is negated and destroyed');
    eq(g.players[0].deck.length, 20, 'Needlebug Nest had no effect');
  });

  // https://edisonrul.ing/cards/o/over-limit.html
  await test('Over Limit: a monster that left the GY and came back by other means cannot be Summoned', async () => {
    const { g, place } = setup();
    const tiny = place(1, X.tiny, 'mzone');
    const att = place(0, T.knight, 'mzone');
    const ol = place(1, N('Over Limit'), 'szone', { faceUp: false });
    await g.conductAttack(0, att);
    eq(tiny.location, 'grave', 'destroyed by battle');
    eq(offered(g, 1, ol), true, 'eligible');
    g.rawMove(tiny, 'banished');
    await g.sendToGrave([tiny], 'effect', 1);
    eq(offered(g, 1, ol), false, 'returned to the GY by another effect: not eligible');
  });

  // https://edisonrul.ing/cards/o/overdoom-line.html
  await test('Overdoom Line: its self-destruction does not start a chain', async () => {
    const { g, place, live } = setup();
    const od = live(place(0, N('Overdoom Line'), 'szone'));
    od.flags.rgbtOdEnds = 1;
    await setPhase(g, 'end');
    eq(od.location, 'grave', 'destroyed on the 2nd End Phase');
    eq(linksOf(g, od).length, 0, 'no chain link');
  });

  // https://edisonrul.ing/cards/p/power-filter.html
  await test('Power Filter: monsters with "?" ATK can be Special Summoned', async () => {
    const { g, place, live } = setup();
    live(place(1, N('Power Filter'), 'szone'));
    const { ensureTdgsPatches } = await import('../src/cards/sets/tdgs');
    ensureTdgsPatches(g);
    const fl = place(0, N('Fortune Lady Light'), 'hand');
    const low = place(0, X.tiny, 'hand');
    eq((await g.specialSummon([low], 0, { pos: 'atk' })).length, 0, '800 ATK: cannot be Special Summoned');
    eq((await g.specialSummon([fl], 0, { pos: 'atk' })).length, 1, '"?" ATK: Special Summoned');
  });

  // https://edisonrul.ing/cards/s/sanguine-swamp.html
  await test('Sanguine Swamp: activated while you control another Spell/Trap, it is destroyed after it resolves', async () => {
    const { g, place } = setup();
    place(0, N('Mystical Space Typhoon'), 'szone', { faceUp: false });
    const sw = place(0, N('Sanguine Swamp'), 'szone', { faceUp: false });
    await activate(g, 0, sw);
    eq(sw.location, 'grave', 'destroyed');
  });

  console.log(`${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
