// Rulings regression tests for Crimson Crisis (crms.ts) and Raging Battle (rgbt.ts) cards.
// Usage: npx tsx scripts/rulings-crms-rgbt.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureRgbtPatches } from '../src/cards/sets/rgbt';
import { ensureCrmsPatches } from '../src/cards/sets/crms';

const T = {
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
};

type Responder = (g: Game, req: ResponseRequest) => Activation | null;

class TestController implements PlayerController {
  isHuman = false;
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
  return { g, c0, c1, place };
}

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

/** End of the Battle Phase with a Gladiator Beast that battled; returns where it ended up. */
async function tagOutBoard(withHunter: boolean) {
  const { g, place } = setup();
  ensureRgbtPatches(g);
  g.phase = 'battle';
  const laq = place(0, cardByName('Gladiator Beast Laquari'), 'mzone');
  laq.attackedThisTurnOrWasAttacked = true;
  const inDeck = place(0, cardByName('Gladiator Beast Darius'), 'deck');
  if (withHunter) place(1, cardByName('G.B. Hunter'), 'mzone');
  g.beginBatch();
  g.emit({ type: 'battleEnd', player: 0, phase: 'battle' });
  await g.processTriggers(true);
  return { laq, inDeck };
}

(async () => {
  console.log('Rulings tests: CRMS / RGBT');

  await test('G.B. Hunter: a Gladiator Beast cannot tag out (its return to the Deck cannot happen)', async () => {
    const ctl = await tagOutBoard(false);
    eq(ctl.laq.location, 'deck', 'control: Laquari tags out without G.B. Hunter');
    eq(ctl.inDeck.location, 'mzone', 'control: Darius is Special Summoned');
    const r = await tagOutBoard(true);
    eq(r.laq.location, 'mzone', 'Laquari stays on the field');
    eq(r.inDeck.location, 'deck', 'no free Gladiator Beast Special Summon');
  });

  await test('G.B. Hunter: Contact Fusion (Gyzarus) cannot be performed', async () => {
    const { g, place } = setup();
    ensureRgbtPatches(g);
    place(0, cardByName('Gladiator Beast Bestiari'), 'mzone');
    place(0, cardByName('Gladiator Beast Laquari'), 'mzone');
    const gyz = place(0, cardByName('Gladiator Beast Gyzarus'), 'extra');
    const hasProc = () => g.legalMainActions(0).some((a) => a.type === 'proc' && a.card === gyz);
    eq(hasProc(), true, 'control: Contact Fusion available');
    place(1, cardByName('G.B. Hunter'), 'mzone');
    eq(hasProc(), false, 'not available with G.B. Hunter');
  });

  await test('G.B. Hunter: Raptor Wing Strike (shuffle a Blackwing you control into the Deck) cannot be activated', async () => {
    const { g, place } = setup();
    ensureRgbtPatches(g);
    place(0, cardByName('Blackwing - Bora the Spear'), 'mzone');
    place(0, cardByName('Blackwing - Kalut the Moon Shadow'), 'deck');
    const rws = place(0, cardByName('Raptor Wing Strike'), 'hand');
    const can = () => g.getActivations(0, { open: true }).some((a) => a.card === rws);
    eq(can(), true, 'control: activatable');
    place(1, cardByName('G.B. Hunter'), 'mzone');
    eq(can(), false, 'not activatable with G.B. Hunter');
  });

  await test('Morphtronic Map: no Morph Counter when a face-down Defense monster is flipped face-up; Flip Summon and Attack->Defense count', async () => {
    const { g, place } = setup();
    ensureCrmsPatches(g);
    const map = place(0, cardByName('Morphtronic Map'), 'fzone', { faceUp: true });
    map.activeOnField = true;
    const fd = place(1, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    await g.changePosition(fd, 'def', true, 0);
    eq(map.counters.morph ?? 0, 0, 'face-down Defense -> face-up Defense: no counter');
    const up = place(1, T.wall, 'mzone');
    await g.changePosition(up, 'def', true, 0);
    eq(map.counters.morph ?? 0, 1, 'face-up Attack -> Defense: 1 counter');
    const fs = place(0, T.wall, 'mzone', { faceUp: false, pos: 'def' });
    await g.flipSummon(0, fs);
    eq(map.counters.morph ?? 0, 2, 'Flip Summon: 1 more counter');
  });

  await test('Beast Striker: "Moja" can be Special Summoned in Attack Position', async () => {
    const { g, c0, place } = setup();
    c0.isHuman = true;
    const bs = place(0, cardByName('Beast Striker'), 'mzone');
    const moja = place(0, cardByName('Moja'), 'deck');
    place(0, T.wall, 'hand');
    const act = g.getActivations(0, { open: true }).find((a) => a.card === bs)!;
    eq(!!act, true, 'activatable');
    await g.activate(0, act);
    await g.runChain();
    eq(moja.location, 'mzone', 'Moja summoned');
    eq(moja.pos, 'atk', 'in Attack Position (chosen)');
  });

  await test('Morphtronic Boarden (Defense): protects face-up "Morphtronic" monsters only', async () => {
    const { g, place } = setup();
    place(0, cardByName('Morphtronic Boarden'), 'mzone', { pos: 'def' });
    const up = place(0, cardByName('Morphtronic Slingen'), 'mzone');
    const down = place(0, cardByName('Morphtronic Slingen'), 'mzone', { faceUp: false, pos: 'def' });
    eq(g.queryCard(up, 'indestructibleBattle'), true, 'face-up Morphtronic protected');
    eq(g.queryCard(down, 'indestructibleBattle'), false, 'face-down monster not protected');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
