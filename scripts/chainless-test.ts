// Chainless effects (EffectDef.noChain / EffectDef.maintenance / EffectDef.summonLpCost) as ruled for SJC Edison, April 2010:
// effects that apply without starting a Chain (nobody can respond), and the reverse cases that must start one.
// Sources: the card pages of https://edisonrul.ing (Edisonformat.com historical, pre-UTW rulings), cited per test.
// Usage: npx tsx scripts/chainless-test.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { monster, normal, trap } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, Phase, PlayerId } from '../src/engine/types';

const T = {
  brute: findCard('Chainless Test Brute') ?? normal('Chainless Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Chainless Test Wall') ?? normal('Chainless Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  weak: findCard('Chainless Test Weak') ?? normal('Chainless Test Weak', 'EARTH', 'Warrior', 3, 1000, 1000),
  insect: findCard('Chainless Test Insect') ?? normal('Chainless Test Insect', 'EARTH', 'Insect', 4, 1000, 2000),
  psychic: findCard('Chainless Test Psychic') ?? normal('Chainless Test Psychic', 'EARTH', 'Psychic', 3, 1000, 1000),
  plant: findCard('Chainless Test Plant') ?? normal('Chainless Test Plant', 'EARTH', 'Plant', 3, 1000, 1000),
  zombie: findCard('Chainless Test Zombie') ?? normal('Chainless Test Zombie', 'DARK', 'Zombie', 3, 1000, 1000),
  reptile: findCard('Chainless Test Reptile') ?? normal('Chainless Test Reptile', 'EARTH', 'Reptile', 4, 1000, 1000),
  rock: findCard('Chainless Test Rock') ?? normal('Chainless Test Rock', 'EARTH', 'Rock', 4, 1000, 1000),
  dragon: findCard('Chainless Test Dragon') ?? normal('Chainless Test Dragon', 'LIGHT', 'Dragon', 4, 1000, 1000),
  lv4: findCard('Chainless Test Lv4') ?? normal('Chainless Test Lv4', 'EARTH', 'Fiend', 4, 1200, 1000),
};
/** A Counter Trap that does nothing: whoever holds one is asked in every response window (the spy). */
const spyTrap = findCard('Chainless Test Spy') ?? trap('Chainless Test Spy', 'counter', { text: 'Do nothing.', effects: [{ kind: 'activate', resolve: async () => {} }] });
/** A Normal Trap that destroys every card named in `destroyNames` (set per test). */
let destroyNames: string[] = [];
const destroyTrap =
  findCard('Chainless Test Destroyer') ??
  trap('Chainless Test Destroyer', 'normal', {
    text: 'Destroy the listed cards.',
    effects: [{ kind: 'activate', categories: ['destroy'], resolve: async (ctx) => void (await ctx.destroy(ctx.game.allFieldCards().filter((c) => destroyNames.includes(c.name)))) }],
  });
/** A Normal Trap that records where `probeCard` is when it resolves. */
let probeCard: CardInstance | undefined;
let probeSeen: Location | undefined;
const probeTrap =
  findCard('Chainless Test Probe') ??
  trap('Chainless Test Probe', 'normal', { text: 'Look.', effects: [{ kind: 'activate', resolve: async () => void (probeSeen = probeCard?.location) }] });
/** Engine test card: an optional chainless trigger ("When a monster is Normal Summoned, you can gain 100 LP", no Chain). */
const optionalChainless =
  findCard('Chainless Test Optional') ??
  monster('Chainless Test Optional', {
    attribute: 'LIGHT',
    race: 'Fairy',
    level: 4,
    atk: 0,
    def: 0,
    text: 'When a monster is Normal Summoned, you can gain 100 LP (this does not start a Chain).',
    effects: [
      {
        kind: 'trigger',
        event: 'normalSummoned',
        noChain: true,
        opt: true,
        label: 'Gain 100 LP',
        eventFilter: (ctx, ev) => ev.card !== ctx.self,
        resolve: async (ctx) => void (await ctx.game.recover(ctx.player, 100)),
      },
    ],
  });

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: (g: Game, req: ResponseRequest) => Activation | null = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  option: (req: OptionRequest) => number = () => 0;
  confirmAnswer = true;
  triggersAsked: string[] = [];
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
    return this.confirmAnswer;
  }
  async confirmTrigger(_g: Game, _p: PlayerId, act: Activation) {
    this.triggersAsked.push(act.card.name);
    return this.confirmAnswer;
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
  /** A face-up Continuous Spell/Trap, Equip or Field Spell that already resolved. */
  const live = (c: CardInstance) => {
    c.faceUp = true;
    c.activeOnField = true;
    return c;
  };
  // The spy: both players hold a Counter Trap, so every response window asks them; record what was on top of the
  // Chain each time, and every chain link that was built.
  place(0, spyTrap, 'szone');
  place(1, spyTrap, 'szone');
  const tops: string[] = [];
  for (const c of [c0, c1]) {
    c.respond = (gg) => {
      if (gg.chain.length) tops.push(gg.chain[gg.chain.length - 1].card.name);
      return null;
    };
  }
  const links: string[] = [];
  const origActivate = g.activate.bind(g);
  (g as any).activate = async (p: PlayerId, a: Activation) => {
    const l = await origActivate(p, a);
    if (l) links.push(a.card.name);
    return l;
  };
  /** Start a phase of the current turn (its triggers and delayed effects), as Game.playTurn does. */
  const phase = async (ph: Phase) => {
    await (g as any).setPhase(ph);
  };
  const battleEnd = async () => {
    g.recentEvents = [];
    g.beginBatch();
    g.emit({ type: 'battleEnd', player: g.turnPlayer, phase: 'battle' });
    await g.processTriggers(true);
  };
  /** `name` never became a chain link and nobody was asked to respond to it. */
  const noChainFor = (name: string) => {
    if (links.includes(name)) throw new Error(`${name} became a chain link`);
    if (tops.includes(name)) throw new Error(`a player was asked to respond to ${name}`);
  };
  /** `name` became a chain link the opponent could respond to. */
  const chainFor = (name: string) => {
    if (!links.includes(name)) throw new Error(`${name} did not start a chain (links: ${links.join(', ') || 'none'})`);
    if (!tops.includes(name)) throw new Error(`nobody was asked to respond to ${name}`);
  };
  return { g, c0, c1, place, live, phase, battleEnd, noChainFor, chainFor, links, tops };
}

const respondWith = (name: string, then?: (g: Game, req: ResponseRequest) => Activation | null) => (g: Game, req: ResponseRequest) =>
  req.options.find((o) => o.card.name === name) ?? (then ? then(g, req) : null);

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
    console.log(`  ✗ ${name}\n      ${e instanceof GameOver ? 'unexpected game over: ' + e.reason : (e as Error).stack}`);
  } finally {
    console.error = orig;
  }
}
function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`);
}

(async () => {
  console.log('Chainless effects (Edison, April 2010)');

  // https://edisonrul.ing/cards/s/spider-web.html — "The effects of this card do not start a Chain."
  await test('Spider Web: the attacker is changed to Defense Position at the end of the Damage Step, no Chain', async () => {
    const { g, place, live, noChainFor } = setup();
    live(place(1, cardByName('Spider Web'), 'fzone'));
    const a = place(0, T.brute, 'mzone');
    place(1, T.wall, 'mzone', { pos: 'def' });
    await g.conductAttack(0, a);
    eq(a.pos, 'def', 'attacker position');
    eq(g.queryCard(a, 'cannotChangePos'), true, 'cannot change its battle position');
    noChainFor('Spider Web');
  });

  // https://edisonrul.ing/cards/s/spiders-lair.html — "Changing your opponent's monster to Defense Position does not start a Chain."
  await test("Spiders' Lair: the opponent's monster that battled the Insect goes to Defense Position, no Chain", async () => {
    const { g, place, live, battleEnd, noChainFor } = setup();
    const lair = live(place(0, cardByName("Spiders' Lair"), 'szone'));
    const ins = place(0, T.insect, 'mzone', { pos: 'def' });
    lair.flags.lair = [{ uid: ins.uid, moveId: ins.moveId }];
    g.turnPlayer = 1;
    const a = place(1, T.brute, 'mzone');
    await g.conductAttack(1, a);
    eq(a.location, 'mzone', 'attacker survived');
    await battleEnd();
    eq(a.pos, 'def', 'changed to Defense Position');
    eq(g.queryCard(a, 'cannotChangePos'), true, 'locked');
    noChainFor("Spiders' Lair");
  });

  // https://edisonrul.ing/cards/w/widespread-dud.html — "The effect to destroy the targeted monsters does not start a Chain."
  await test('Widespread Dud: destroyed → both targets destroyed without a Chain; a target leaving destroys Dud and the other', async () => {
    const { g, place, noChainFor, links, tops } = setup();
    const dud = place(0, cardByName('Widespread Dud'), 'szone');
    const m1 = place(1, T.brute, 'mzone');
    const m2 = place(1, T.weak, 'mzone');
    const act = g.getActivations(0, { open: true }).find((a) => a.card === dud)!;
    await g.performAction(0, { type: 'activate', card: dud, act });
    eq(links.filter((n) => n === 'Widespread Dud').length, 1, 'only the activation is a chain link');
    links.length = 0;
    tops.length = 0;
    await g.destroy([dud], 'effect', 1);
    await g.processTriggers(true);
    eq(m1.location, 'grave', 'first target');
    eq(m2.location, 'grave', 'second target');
    noChainFor('Widespread Dud');
    // A target leaving the field: Dud is destroyed and so is the other target.
    const s = setup();
    const dud2 = s.place(0, cardByName('Widespread Dud'), 'szone');
    const n1 = s.place(1, T.brute, 'mzone');
    const n2 = s.place(1, T.weak, 'mzone');
    const act2 = s.g.getActivations(0, { open: true }).find((a) => a.card === dud2)!;
    await s.g.performAction(0, { type: 'activate', card: dud2, act: act2 });
    s.links.length = 0;
    s.tops.length = 0;
    await s.g.toHand([n1], 'effect', 1);
    await s.g.processTriggers(true);
    eq(dud2.location, 'grave', 'Widespread Dud destroyed');
    eq(n2.location, 'grave', 'the other target destroyed');
    s.noChainFor('Widespread Dud');
  });

  // https://edisonrul.ing/cards/d/djinn-presider-of-rituals.html — "The effect to draw a card does not start a Chain ...
  // applied even if 'Skill Drain' is active"; 2 copies used still draw only 1.
  await test('Djinn Presider of Rituals: draw 1 without a Chain (Skill Drain does not stop it; 2 copies draw 1)', async () => {
    const { g, place, live, noChainFor } = setup();
    live(place(1, cardByName('Skill Drain'), 'szone'));
    const d1 = place(0, cardByName('Djinn Presider of Rituals'), 'banished');
    const d2 = place(0, cardByName('Djinn Presider of Rituals'), 'banished');
    const r = place(0, T.brute, 'mzone');
    r.flags.sovrDjinnPresider = [d1.uid, d2.uid];
    place(1, T.weak, 'mzone');
    const hand = g.players[0].hand.length;
    await g.conductAttack(0, r);
    eq(g.players[0].hand.length, hand + 1, 'drew exactly 1 card');
    noChainFor('Djinn Presider of Rituals');
  });

  // https://edisonrul.ing/cards/d/djinn-prognosticator-of-rituals.html — "The effect to force your opponent to discard does not start a Chain."
  await test('Djinn Prognosticator of Rituals: the opponent discards 1 without a Chain', async () => {
    const { g, place, noChainFor } = setup();
    place(0, cardByName('Djinn Prognosticator of Rituals'), 'grave');
    place(0, T.lv4, 'mzone');
    place(0, cardByName('Garlandolf, King of Destruction'), 'hand');
    const rit = place(0, cardByName('Ritual of Destruction'), 'hand');
    const h = place(1, T.weak, 'hand');
    const act = g.getActivations(0, { open: true }).find((a) => a.card === rit)!;
    await g.performAction(0, { type: 'activate', card: rit, act });
    const garl = g.players[0].mzone.find((c) => c?.name === 'Garlandolf, King of Destruction')!;
    if (!garl) throw new Error('Garlandolf was not Ritual Summoned');
    await g.conductAttack(0, garl);
    eq(h.location, 'grave', 'opponent discarded');
    noChainFor('Djinn Prognosticator of Rituals');
  });

  // https://edisonrul.ing/cards/i/il-blud.html — ② "does not start a chain"; leaving while a Chain resolves destroys the
  // Zombies before the next link resolves; leaving while negated by Skill Drain destroys nothing.
  await test('Il Blud ②: destroyed in a Chain → its Zombies are destroyed before the next link resolves, no Chain', async () => {
    const { g, c0, c1, place, noChainFor } = setup();
    const blud = place(0, cardByName('Il Blud'), 'mzone');
    blud.flags.geminiSummoned = true;
    const z = place(0, T.zombie, 'mzone');
    z.flags.ilBludSource = blud.uid;
    const probe = place(0, probeTrap, 'szone');
    place(1, destroyTrap, 'szone');
    destroyNames = ['Il Blud'];
    probeCard = z;
    probeSeen = undefined;
    c1.respond = respondWith('Chainless Test Destroyer');
    c0.respond = () => null;
    const act = g.getActivations(0, { open: true }).find((a) => a.card === probe)!;
    await g.performAction(0, { type: 'activate', card: probe, act });
    eq(blud.location, 'grave', 'Il Blud destroyed by Chain Link 2');
    eq(probeSeen, 'grave', 'the Zombie was already destroyed when Chain Link 1 resolved');
    noChainFor('Il Blud');
  });
  await test('Il Blud ②: leaves the field while negated by Skill Drain → its Zombies stay', async () => {
    const { g, place, live } = setup();
    live(place(1, cardByName('Skill Drain'), 'szone'));
    const blud = place(0, cardByName('Il Blud'), 'mzone');
    blud.flags.geminiSummoned = true;
    const z = place(0, T.zombie, 'mzone');
    z.flags.ilBludSource = blud.uid;
    await g.destroy([blud], 'effect', 1);
    await g.processTriggers(true);
    eq(z.location, 'mzone', 'Zombie not destroyed');
  });

  // https://edisonrul.ing/cards/p/pole-position.html — ② "does NOT start a chain"; negated (Trap Stun) when it leaves: nothing.
  await test('Pole Position ②: leaves the field → highest-ATK monster destroyed without a Chain; not while negated', async () => {
    const { g, place, live, noChainFor } = setup();
    const pole = live(place(0, cardByName('Pole Position'), 'szone'));
    const big = place(1, T.brute, 'mzone');
    const small = place(0, T.weak, 'mzone');
    await g.destroy([pole], 'effect', 1);
    await g.processTriggers(true);
    eq(big.location, 'grave', 'highest ATK destroyed');
    eq(small.location, 'mzone', 'others stay');
    noChainFor('Pole Position');
    const s = setup();
    const pole2 = s.live(s.place(0, cardByName('Pole Position'), 'szone'));
    const big2 = s.place(1, T.brute, 'mzone');
    s.g.turnData.trapStunUid = -1; // every Trap is negated this turn (Trap Stun)
    await s.g.destroy([pole2], 'effect', 1);
    await s.g.processTriggers(true);
    eq(big2.location, 'mzone', 'negated Pole Position destroys nothing');
  });

  // https://edisonrul.ing/cards/l/limit-reverse.html — destroying the monster when it is changed to Defense Position "does not start a Chain".
  await test('Limit Reverse: monster changed to Defense Position → it and Limit Reverse destroyed without a Chain', async () => {
    const { g, place, live, noChainFor } = setup();
    const lr = live(place(0, cardByName('Limit Reverse'), 'szone'));
    const m = place(0, T.weak, 'mzone');
    g.link(lr, m);
    await g.changePosition(m, 'def', true, 1);
    await g.processTriggers(true);
    eq(m.location, 'grave', 'monster destroyed');
    eq(lr.location, 'grave', 'Limit Reverse destroyed');
    noChainFor('Limit Reverse');
  });

  // https://edisonrul.ing/cards/a/arcana-force-ex-the-dark-ruler.html — Tails "does not start a Chain"; negated by Skill Drain.
  const darkRulerTails = async (skillDrain: boolean) => {
    const s = setup();
    s.live(s.place(0, cardByName('Light Barrier'), 'fzone'));
    s.c0.option = (req) => (req.prompt.startsWith('Light Barrier') ? 1 : 0); // Tails
    const ex = s.place(0, cardByName('Arcana Force EX - The Dark Ruler'), 'hand');
    const other = s.place(1, T.brute, 'mzone');
    await s.g.specialSummon([ex], 0, { ignoreConditions: true, proper: true });
    await s.g.processTriggers(true);
    const sd = skillDrain ? s.live(s.place(1, cardByName('Skill Drain'), 'szone')) : undefined;
    s.links.length = 0;
    s.tops.length = 0;
    await s.g.destroy([ex], 'effect', 1);
    await s.g.processTriggers(true);
    return { ...s, ex, other, sd };
  };
  await test('Arcana Force EX - The Dark Ruler (Tails): destroyed → all cards on the field destroyed without a Chain', async () => {
    const { ex, other, noChainFor } = await darkRulerTails(false);
    eq(ex.location, 'grave', 'The Dark Ruler destroyed');
    eq(other.location, 'grave', 'other cards destroyed');
    noChainFor('Arcana Force EX - The Dark Ruler');
  });
  await test('Arcana Force EX - The Dark Ruler (Tails): not applied while negated by Skill Drain', async () => {
    const { other, sd } = await darkRulerTails(true);
    eq(other.location, 'mzone', 'other monster stays');
    eq(sd!.location, 'szone', 'Skill Drain stays');
  });

  // https://edisonrul.ing/cards/b/brain-research-lab.html — ④ "is mandatory, though it does not start a chain"; negated: counters removed.
  const lab = async (negate: boolean) => {
    const s = setup();
    const brl = s.live(s.place(0, cardByName('Brain Research Lab'), 'fzone'));
    s.g.beginBatch();
    s.g.emit({ type: 'phaseStart', phase: 'main1', player: 0 }); // installs the ANPR patches (extra Normal Summon)
    await s.g.processTriggers(false);
    const p = s.place(0, T.psychic, 'hand');
    await s.g.performAction(0, { type: 'summon', card: p });
    eq(brl.counters.psychic ?? 0, 1, 'Psychic Counter placed');
    if (negate) brl.flags.negatedTurn = s.g.turn;
    const lp = s.g.players[0].lp;
    await s.g.destroy([brl], 'effect', 1);
    await s.g.processTriggers(true);
    return { ...s, lost: lp - s.g.players[0].lp };
  };
  await test('Brain Research Lab ④: removed from the field → 1000 damage per counter without a Chain', async () => {
    const { lost, noChainFor } = await lab(false);
    eq(lost, 1000, 'damage');
    noChainFor('Brain Research Lab');
  });
  await test('Brain Research Lab ④: no damage if its effects were negated when it left', async () => {
    const { lost } = await lab(true);
    eq(lost, 0, 'damage');
  });

  // https://edisonrul.ing/cards/d/drill-warrior.html — ③ "will start a chain at any point during the Standby Phase"; negated by
  // Royal Oppression, Drill Warrior stays banished and cannot activate it again.
  await test('Drill Warrior ③: the Standby Phase return starts a Chain (Summon, then add a monster)', async () => {
    const { g, place, phase, chainFor } = setup();
    const drill = place(0, cardByName('Drill Warrior'), 'banished');
    drill.flags.drillReturn = { mid: drill.moveId, turn: 1 };
    const gy = place(0, T.weak, 'grave');
    await phase('standby');
    eq(drill.location, 'mzone', 'Drill Warrior returned');
    eq(gy.location, 'hand', 'monster added from the GY');
    chainFor('Drill Warrior');
  });
  await test('Drill Warrior ③: negated by Royal Oppression → stays banished, no second try', async () => {
    const { g, c1, place, live, phase } = setup();
    live(place(1, cardByName('Royal Oppression'), 'szone'));
    const drill = place(0, cardByName('Drill Warrior'), 'banished');
    drill.flags.drillReturn = { mid: drill.moveId, turn: 1 };
    c1.respond = (_g, req) => req.options.find((o) => o.card.name === 'Royal Oppression' && (o.effect.categories ?? []).includes('negate')) ?? null;
    await phase('standby');
    eq(drill.location, 'banished', 'still banished');
    c1.respond = () => null;
    g.turn += 2;
    await phase('standby');
    eq(drill.location, 'banished', 'does not activate again');
  });

  // https://edisonrul.ing/cards/q/queen-of-thorns.html — the Continuous Effect "does not activate": 1000 LP paid as a cost at the
  // Summon (Normal or Special from the hand); a player who cannot pay cannot Summon; Plants and other locations are free.
  await test('Queen of Thorns: Normal Summon of a non-Plant from the hand costs 1000 LP, no Chain', async () => {
    const { g, place, noChainFor } = setup();
    place(1, cardByName('Queen of Thorns'), 'mzone');
    const m = place(0, T.weak, 'hand');
    await g.performAction(0, { type: 'summon', card: m });
    eq(m.location, 'mzone', 'summoned');
    eq(g.players[0].lp, 7000, 'paid 1000');
    noChainFor('Queen of Thorns');
    const pl = place(0, T.plant, 'hand');
    g.players[0].normalSummonsLeft = 1;
    await g.performAction(0, { type: 'summon', card: pl });
    eq(g.players[0].lp, 7000, 'a Plant is free');
  });
  await test('Queen of Thorns: with 1000 LP or less a non-Plant cannot be Summoned from the hand; 2 Queens cost 2000', async () => {
    const { g, place } = setup();
    place(1, cardByName('Queen of Thorns'), 'mzone');
    const m = place(0, T.weak, 'hand');
    g.players[0].lp = 1000;
    eq(g.canNormalSummon(0, m), false, 'cannot Normal Summon');
    eq(g.canNormalSummon(0, m, true), true, 'Setting is not a Summon');
    const r = await g.specialSummon([m], 0, { pos: 'atk' });
    eq(r.length, 0, 'an effect cannot Special Summon it either');
    eq(m.location, 'hand', 'still in the hand');
    const gy = place(0, T.brute, 'grave');
    const r2 = await g.specialSummon([gy], 0, { pos: 'atk' });
    eq(r2.length, 1, 'from the GY: no cost');
    g.players[0].lp = 8000;
    place(0, cardByName('Queen of Thorns'), 'mzone');
    const m2 = place(0, T.lv4, 'hand');
    await g.specialSummon([m2], 0, { pos: 'atk' });
    eq(g.players[0].lp, 6000, '2 face-up Queens: 2000');
  });
  await test('Queen of Thorns: no cost while negated by Skill Drain', async () => {
    const { g, place, live } = setup();
    place(1, cardByName('Queen of Thorns'), 'mzone');
    live(place(1, cardByName('Skill Drain'), 'szone'));
    const m = place(0, T.weak, 'hand');
    await g.performAction(0, { type: 'summon', card: m });
    eq(g.players[0].lp, 8000, 'no LP paid');
  });

  // https://edisonrul.ing/cards/k/koaki-meiru-drago.html — "The Maintenance Cost is not an effect. It cannot be negated.
  // Revealing ... does not start a chain." https://edisonrul.ing/cards/s/skill-drain.html — "Maintenance costs ... must still be paid."
  await test("Koa'ki Meiru maintenance: no Chain; reveal keeps it; not paying destroys it, even under Skill Drain", async () => {
    const { g, place, live, phase, noChainFor } = setup();
    const drago = place(0, cardByName("Koa'ki Meiru Drago"), 'mzone');
    place(0, T.dragon, 'hand');
    await phase('end');
    eq(drago.location, 'mzone', 'kept by revealing a Dragon');
    noChainFor("Koa'ki Meiru Drago");
    const s = setup();
    s.live(s.place(1, cardByName('Skill Drain'), 'szone'));
    const d2 = s.place(0, cardByName("Koa'ki Meiru Drago"), 'mzone');
    const war = s.place(0, cardByName("Koa'ki Meiru Crusader"), 'mzone');
    const beetle = s.place(0, cardByName("Koa'ki Meiru Beetle"), 'mzone');
    await s.phase('end');
    eq(d2.location, 'grave', 'Drago destroyed (Skill Drain does not stop the cost)');
    eq(war.location, 'grave', 'Crusader destroyed');
    eq(beetle.location, 'grave', 'Beetle destroyed');
    s.noChainFor("Koa'ki Meiru Drago");
    s.noChainFor("Koa'ki Meiru Crusader");
    s.noChainFor("Koa'ki Meiru Beetle");
  });

  // https://edisonrul.ing/cards/m/mind-protector.html — "Paying 500 Life Points is a maintenance cost."
  await test('Mind Protector: Standby Phase 500 LP paid without a Chain; destroyed if it cannot be paid', async () => {
    const { g, place, phase, noChainFor } = setup();
    const mp = place(0, cardByName('Mind Protector'), 'mzone');
    await phase('standby');
    eq(g.players[0].lp, 7500, 'paid 500');
    eq(mp.location, 'mzone', 'kept');
    noChainFor('Mind Protector');
    g.players[0].lp = 500;
    g.turn += 2;
    await phase('standby');
    eq(mp.location, 'grave', 'destroyed');
  });

  // https://edisonrul.ing/cards/g/gaia-plate-the-earth-giant.html — "The Maintenance Cost does not activate".
  await test('Gaia Plate the Earth Giant: banish 1 Rock in the Standby Phase without a Chain, or it is sent to the GY', async () => {
    const { g, place, phase, noChainFor } = setup();
    const gp = place(0, cardByName('Gaia Plate the Earth Giant'), 'mzone');
    const rock = place(0, T.rock, 'grave');
    await phase('standby');
    eq(rock.location, 'banished', 'Rock banished as the cost');
    eq(gp.location, 'mzone', 'kept');
    noChainFor('Gaia Plate the Earth Giant');
    g.turn += 2;
    await phase('standby');
    eq(gp.location, 'grave', 'no Rock left: sent to the GY');
  });

  // https://edisonrul.ing/cards/i/imprisoned-queen-archfiend.html — "Paying 1000 Life Points ... is a maintenance cost"; with 1000 or less it is destroyed.
  await test('Imprisoned Queen Archfiend: 1000 LP maintenance without a Chain; destroyed with 1000 LP', async () => {
    const { g, place, phase, noChainFor } = setup();
    const q = place(0, cardByName('Imprisoned Queen Archfiend'), 'mzone');
    await phase('standby');
    eq(g.players[0].lp, 7000, 'paid 1000');
    noChainFor('Imprisoned Queen Archfiend');
    g.players[0].lp = 1000;
    g.turn += 2;
    await phase('standby');
    eq(q.location, 'grave', 'destroyed');
    eq(g.players[0].lp, 1000, 'nothing paid');
  });

  // https://edisonrul.ing/cards/v/vampires-curse.html — "The effect that increases 'Vampire's Curse's' ATK starts a Chain".
  await test("Vampire's Curse: revived in the Standby Phase, its 500 ATK gain starts a Chain", async () => {
    const { g, place, phase, chainFor } = setup();
    const vc = place(1, cardByName("Vampire's Curse"), 'mzone');
    const a = place(0, cardByName('Chainless Test Brute').atk ? T.brute : T.brute, 'mzone');
    a.flags.baseAtk = 2500;
    await g.conductAttack(0, a);
    eq(vc.location, 'grave', 'destroyed by battle');
    eq(g.players[1].lp, 8000 - 500 - 500, 'battle damage + 500 LP cost');
    g.turn += 1;
    g.turnPlayer = 1;
    await phase('standby');
    eq(vc.location, 'mzone', 'revived');
    eq(g.getAtk(vc), 2500, '+500 ATK');
    chainFor("Vampire's Curse");
  });

  // https://edisonrul.ing/cards/m/molting-escape.html — "The effect to gain 300 ATK starts a Chain".
  await test('Molting Escape: battle protection, then the 300 ATK gain starts a Chain at the end of the Damage Step', async () => {
    const { g, place, live, chainFor } = setup();
    const r = place(1, T.reptile, 'mzone');
    const me = live(place(1, cardByName('Molting Escape'), 'szone'));
    g.equip(me, r);
    const a = place(0, T.brute, 'mzone');
    await g.conductAttack(0, a);
    eq(r.location, 'mzone', 'not destroyed by battle');
    eq(g.getAtk(r), 1300, '+300 ATK');
    chainFor('Molting Escape');
  });

  // https://edisonrul.ing/cards/m/morphtronic-engine.html — the 2nd Standby Phase destruction "starts a Chain".
  await test('Morphtronic Engine: destroyed on your 2nd Standby Phase after activation by a chain link', async () => {
    const { g, place, live, phase, chainFor } = setup();
    const m = place(0, cardByName('Morphtronic Celfon'), 'mzone');
    const eng = live(place(0, cardByName('Morphtronic Engine'), 'szone'));
    g.equip(eng, m);
    eng.flags.morphEngine = { mid: eng.moveId, standbys: 0, player: 0 };
    await phase('standby');
    eq(eng.location, 'szone', 'still there after the 1st Standby Phase');
    g.turn += 2;
    await phase('standby');
    eq(eng.location, 'grave', 'destroyed on the 2nd');
    eq(g.players[0].lp, 8000 - (m.data.atk ?? 0), 'damage = original ATK');
    chainFor('Morphtronic Engine');
  });

  // ---- Audit: other cards whose 2010 rulings say they do not start a Chain ------------------------------------------

  // https://edisonrul.ing/cards/l/level-limit-area-b.html — "does not use the chain, it is a continuous effect".
  await test('Level Limit - Area B: a Summoned Level 4+ monster is changed to Defense Position without a Chain', async () => {
    const { g, place, live, noChainFor } = setup();
    live(place(1, cardByName('Level Limit - Area B'), 'szone'));
    const m = place(0, T.brute, 'hand');
    await g.performAction(0, { type: 'summon', card: m });
    eq(m.pos, 'def', 'Defense Position');
    noChainFor('Level Limit - Area B');
  });

  // https://edisonrul.ing/cards/w/wall-of-ivy.html — "'Ivy Token's' effect to inflict damage does not start a Chain."
  await test('Ivy Token: 300 damage when destroyed, without a Chain', async () => {
    const { g, place, noChainFor, links } = setup();
    const wall = place(0, cardByName('Wall of Ivy'), 'mzone');
    g.beginBatch();
    g.emit({ type: 'phaseStart', phase: 'main1', player: 0 }); // installs the CSOC patches (Token effects)
    await g.processTriggers(false);
    g.beginBatch();
    g.emit({ type: 'flipped', card: wall, player: 0 });
    await g.processTriggers(true);
    const tok = g.players[1].mzone.find((c) => c?.name === 'Ivy Token');
    if (!tok) throw new Error('no Ivy Token');
    links.length = 0;
    await g.destroy([tok], 'effect', 0);
    await g.processTriggers(true);
    eq(g.players[1].lp, 7700, '300 damage to the Token\'s controller');
    noChainFor('Ivy Token');
  });

  // https://edisonrul.ing/cards/s/seal-of-wickedness.html — "Paying 500 Life Points is a cost, not an effect. It cannot be negated by 'Royal Decree.'"
  await test('Seal of Wickedness: 500 LP maintenance without a Chain, still paid while Traps are negated', async () => {
    const { g, place, live, phase, noChainFor } = setup();
    const seal = live(place(0, cardByName('Seal of Wickedness'), 'szone'));
    g.turnData.trapStunUid = -1;
    await phase('standby');
    eq(g.players[0].lp, 7500, 'paid 500');
    eq(seal.location, 'szone', 'kept');
    noChainFor('Seal of Wickedness');
  });

  // https://edisonrul.ing/cards/m/messenger-of-peace.html — "The maintenance cost is optional".
  await test('Messenger of Peace: 100 LP maintenance without a Chain', async () => {
    const { g, place, live, phase, noChainFor } = setup();
    live(place(0, cardByName('Messenger of Peace'), 'szone'));
    await phase('standby');
    eq(g.players[0].lp, 7900, 'paid 100');
    noChainFor('Messenger of Peace');
  });

  // https://edisonrul.ing/cards/f/future-fusion.html — "The ③ Lingering Effect applies during your second Standby Phase without starting a chain."
  await test('Future Fusion: the Fusion Monster is Summoned on the 2nd Standby Phase without a Chain', async () => {
    const { g, place, live, phase, noChainFor } = setup();
    const ff = live(place(0, cardByName('Future Fusion'), 'szone'));
    const f = place(0, cardByName('Cyber Twin Dragon'), 'extra');
    ff.flags.ffFusion = f.uid;
    await phase('standby');
    eq(f.location, 'extra', 'not yet');
    g.turn += 2;
    await phase('standby');
    eq(f.location, 'mzone', 'Fusion Summoned');
    noChainFor('Future Fusion');
  });

  // Engine: an optional chainless trigger is offered to its controller (confirmTrigger) and applied without a chain link;
  // once per turn is used up.
  await test('Engine: optional noChain trigger — asked, applied without a Chain, once per turn', async () => {
    const { g, c0, place, noChainFor } = setup();
    place(0, optionalChainless, 'mzone');
    const m = place(0, T.weak, 'hand');
    await g.performAction(0, { type: 'summon', card: m });
    eq(c0.triggersAsked.filter((n) => n === 'Chainless Test Optional').length, 1, 'asked once');
    eq(g.players[0].lp, 8100, 'applied');
    noChainFor('Chainless Test Optional');
    const m2 = place(0, T.weak, 'hand');
    g.players[0].normalSummonsLeft = 1;
    await g.performAction(0, { type: 'summon', card: m2 });
    eq(g.players[0].lp, 8100, 'once per turn');
    const s = setup();
    s.c0.confirmAnswer = false;
    s.place(0, optionalChainless, 'mzone');
    const m3 = s.place(0, T.weak, 'hand');
    await s.g.performAction(0, { type: 'summon', card: m3 });
    eq(s.g.players[0].lp, 8000, 'declined: not applied');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
