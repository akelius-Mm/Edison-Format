// Rulings regression tests for the SOVR and ANPR card scripts (sovr-anpr audit).
// Usage: npx tsx scripts/rulings-sovr-anpr.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureAnprPatches } from '../src/cards/sets/anpr';
import { ensureRgbtPatches } from '../src/cards/sets/rgbt';
import { ensureCrmsPatches } from '../src/cards/sets/crms';
import { ensurePtdnPatches } from '../src/cards/sets/ptdn';
import { ensureLodtPatches } from '../src/cards/sets/lodt';
import { ensureGlasPatches } from '../src/cards/sets/glas';
import { ensureCsocPatches } from '../src/cards/sets/csoc';
import { PREMADE_DECKS, aiSideDeck, buildDeckList, canSwap, moveToDeck, moveToSide, sideSummary, sidedDeckProblems, swapCards, validateDeck, type DeckIds } from '../src/decks';
import { ensureTdgsPatches } from '../src/cards/sets/tdgs';
import { ensureArchetypeExtrasPatches } from '../src/cards/sets/archetype-extras';
import { ensureArchetypeExtras2Patches } from '../src/cards/sets/archetype-extras2';
import { AIController } from '../src/ai/ai';
import { Ctx } from '../src/engine/ctx';
import { GY_BANISH_COST_PROBLEMS } from '../src/cards/gy-costs';
import { WHY_NOT_PROBLEMS, whyRow, whySentence } from '../src/cards/why-not';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  dark: findCard('Rules Test Shade') ?? normal('Rules Test Shade', 'DARK', 'Fiend', 4, 1600, 1200),
  giant: findCard('Rules Test Giant') ?? normal('Rules Test Giant', 'EARTH', 'Warrior', 8, 3000, 2500),
};
const tuner = findCard('Rules Test Tuner') ?? normal('Rules Test Tuner', 'EARTH', 'Warrior', 2, 800, 800);
if (!tuner.mtypes!.includes('tuner')) tuner.mtypes!.push('tuner');

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  readonly isHuman = false;
  respond: Responder = () => null;
  pick: (g: Game, req: SelectRequest) => CardInstance[] = (_g, req) => req.candidates.slice(0, req.min);
  async chooseAction(_g: Game, _p: PlayerId, acts: Action[]): Promise<Action> {
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


const gust = findCard('Rulings Test Gust') ?? normal('Rulings Test Gust', 'WIND', 'Winged Beast', 4, 1400, 1000);

const live = (c: CardInstance) => {
  c.faceUp = true;
  c.activeOnField = true;
  return c;
};
const offered = (g: Game, p: PlayerId, card: CardInstance) => g.getActivations(p, { open: true }).some((a) => a.card === card);
const activateCard = async (g: Game, p: PlayerId, card: CardInstance) => {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card);
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
};

/** The Chain Link this card's activation created (from the event log). */
const linkOf = (g: Game, card: CardInstance) =>
  g.eventLog.find((e) => e.type === 'chainActivated' && e.card === card)?.data?.link as { ctx: { targets: CardInstance[] } } | undefined;

(async () => {
  console.log('Rulings tests: SOVR / ANPR');
  // Silence unused-helper warnings from the copied header.
  void respondWith;
  void filler;
  void T;
  void tuner;
  void ensureAnprPatches;

  await test('Time Passage targets the Fortune Lady and cannot be activated in the Damage Step', async () => {
    const { g, c0, place } = setup();
    const wind = place(0, cardByName('Fortune Lady Wind'), 'mzone');
    const tp = place(0, cardByName('Time Passage'), 'hand');
    const foe = place(1, T.brute, 'mzone');
    let inDamageStep = false;
    let beforeDamageStep = false;
    c0.respond = (gg, req) => {
      if (req.options.some((o) => o.card === tp)) {
        if (gg.battle?.inDamageStep) inDamageStep = true;
        else beforeDamageStep = true;
      }
      return null;
    };
    await g.conductAttack(0, wind);
    eq(beforeDamageStep, true, 'offered at attack declaration');
    eq(inDamageStep, false, 'not offered in the Damage Step');
    void foe;
    const s = setup();
    const earth = s.place(0, cardByName('Fortune Lady Earth'), 'mzone');
    const tp2 = s.place(0, cardByName('Time Passage'), 'hand');
    await activateCard(s.g, 0, tp2);
    eq(linkOf(s.g, tp2)?.ctx.targets.includes(earth), true, 'Time Passage targets the Fortune Lady');
    eq(s.g.getLevel(earth), 9, 'Level +3');
  });

  await test('Dark Simorgh: Special Summons itself with an Ignition Effect (starts a Chain), from the hand and from the GY', async () => {
    const { g, place } = setup();
    const sim = place(0, cardByName('Dark Simorgh'), 'hand');
    const d = place(0, T.dark, 'grave');
    const w = place(0, gust, 'grave');
    const act = g.getActivations(0, { open: true }).find((a) => a.card === sim);
    eq(!!act, true, 'offered as an activation');
    eq(act?.effect.kind, 'ignition', 'an Ignition Effect, not a Summon procedure');
    await g.performAction(0, { type: 'activate', card: sim, act: act! });
    eq(!!linkOf(g, sim), true, 'it was activated as a Chain Link');
    eq(d.location, 'banished', 'DARK banished as cost');
    eq(w.location, 'banished', 'WIND banished as cost');
    eq(sim.location, 'mzone', 'Simorgh Special Summoned');

    const s = setup();
    const sim2 = s.place(0, cardByName('Dark Simorgh'), 'grave');
    const d2 = s.place(0, T.dark, 'hand');
    const w2 = s.place(0, gust, 'hand');
    eq(offered(s.g, 0, sim2), true, 'GY effect offered');
    await activateCard(s.g, 0, sim2);
    eq(d2.location, 'banished', 'DARK banished from hand');
    eq(w2.location, 'banished', 'WIND banished from hand');
    eq(sim2.location, 'mzone', 'Simorgh Special Summoned from the GY');

    const n = setup();
    const sim3 = n.place(0, cardByName('Dark Simorgh'), 'hand');
    n.place(0, T.dark, 'grave');
    eq(offered(n.g, 0, sim3), false, 'needs both a DARK and a WIND');
  });

  await test('Gateway of the Six: the 2-counter +500 ATK effect can target a Six Samurai on either side', async () => {
    const { g, c0, place } = setup();
    const gate = live(place(0, cardByName('Gateway of the Six'), 'szone'));
    gate.counters.bushido = 2;
    const theirs = place(1, cardByName('The Six Samurai - Kamon'), 'mzone');
    c0.pick = (_g, req) => (req.candidates.includes(theirs) ? [theirs] : req.candidates.slice(0, req.min));
    const act = g.getActivations(0, { open: true }).find((a) => a.card === gate && (a.label ?? '').includes('500'));
    eq(!!act, true, 'offered with only an opponent\'s Six Samurai on the field');
    await g.performAction(0, { type: 'activate', card: gate, act: act! });
    eq(g.getAtk(theirs), (theirs.data.atk ?? 0) + 500, 'opponent\'s Six Samurai gained 500 ATK');
    eq(gate.counters.bushido ?? 0, 0, 'counters removed');
  });

  await test('XX-Saber Fulhelmknight: "once while face-up" resets after it is turned face-down', async () => {
    const { g, place } = setup();
    const fk = place(1, cardByName('XX-Saber Fulhelmknight'), 'mzone', { pos: 'def' });
    const a = place(0, T.giant, 'mzone');
    await g.conductAttack(0, a);
    eq(fk.location, 'mzone', 'first attack negated');
    a.attacksThisTurn = 0;
    await g.conductAttack(0, a);
    eq(fk.location, 'grave', 'still face-up: no second negation, destroyed');

    const s = setup();
    const fk2 = s.place(1, cardByName('XX-Saber Fulhelmknight'), 'mzone', { pos: 'def' });
    const a2 = s.place(0, T.giant, 'mzone');
    await s.g.conductAttack(0, a2);
    eq(fk2.location, 'mzone', 'first attack negated');
    await s.g.changePosition(fk2, 'def', false);
    await s.g.changePosition(fk2, 'def', true);
    a2.attacksThisTurn = 0;
    await s.g.conductAttack(0, a2);
    eq(fk2.location, 'mzone', 'face-up again: the second attack is negated too');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
