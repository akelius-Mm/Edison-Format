// Regression tests for the LODT / CSOC rulings sweep (one test per fix).
// Usage: npx tsx scripts/rulings-lodt-csoc.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureLodtPatches } from '../src/cards/sets/lodt';
import { ensureCsocPatches } from '../src/cards/sets/csoc';

const T = {
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  psy3: findCard('Rulings LC Psychic') ?? normal('Rulings LC Psychic', 'EARTH', 'Psychic', 3, 1000, 1000),
};

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
  const g = new Game([{ main: filler(20), extra: [] }, { main: filler(20), extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  ensureLodtPatches(g);
  ensureCsocPatches(g);
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

async function activateCard(g: Game, p: PlayerId, card: CardInstance, label?: string) {
  const act = g.getActivations(p, { open: true }).find((a) => a.card === card && (!label || a.label === label));
  if (!act) throw new Error(`${card.name} cannot be activated`);
  await g.performAction(p, { type: 'activate', card, act });
}
const canActivate = (g: Game, p: PlayerId, card: CardInstance, label?: string) =>
  g.getActivations(p, { open: true }).some((a) => a.card === card && (!label || a.label === label));

/** Runs `look` once, just before the Chain starts to resolve (after activation, before resolution). */
function peekInChain(_ctrl: TestController, look: (g: Game) => void, g?: Game) {
  const game = g!;
  const anyG = game as any;
  const orig = anyG.resolveChain.bind(game);
  let done = false;
  anyG.resolveChain = async () => {
    if (!done && game.chain.length) {
      done = true;
      look(game);
    }
    return orig();
  };
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

(async () => {
  console.log('Rulings tests: LODT / CSOC');

  await test('CSOC: Morphtronic Accelerator targets on activation; the Morphtronic returns on resolution, then destroy + draw', async () => {
    const { g, c0, c1, place } = setup();
    const acc = place(0, cardByName('Morphtronic Accelerator'), 'hand');
    const morph = place(0, cardByName('Morphtronic Radion'), 'hand');
    const victim = place(1, T.brute, 'mzone');
    c0.pick = (_g, req) => (req.candidates.includes(victim) ? [victim] : req.candidates.slice(0, req.min));
    let inHandDuringChain: boolean | undefined;
    let targeted: boolean | undefined;
    peekInChain(c1, (gg) => {
      inHandDuringChain = morph.location === 'hand';
      targeted = gg.chain[gg.chain.length - 1].ctx.targets.includes(victim);
    }, g);
    const hand0 = g.players[0].hand.length;
    await activateCard(g, 0, acc);
    eq(inHandDuringChain, true, 'Morphtronic still in hand while the Spell is on the Chain (not a cost)');
    eq(targeted, true, 'the card to destroy is targeted on activation');
    eq(victim.location, 'grave', 'target destroyed');
    eq(morph.location, 'deck', 'Morphtronic returned to the Deck');
    eq(g.players[0].hand.length, hand0 - 2 + 1, 'drew 1 card (Accelerator and Morphtronic left the hand)');
  });

  await test('CSOC: Morphtronic Accelerator — target gone at resolution: Morphtronic returned, no draw', async () => {
    const { g, c0, c1, place } = setup();
    const acc = place(0, cardByName('Morphtronic Accelerator'), 'hand');
    const morph = place(0, cardByName('Morphtronic Radion'), 'hand');
    const victim = place(1, T.brute, 'mzone');
    c0.pick = (_g, req) => (req.candidates.includes(victim) ? [victim] : req.candidates.slice(0, req.min));
    peekInChain(c1, (gg) => {
      gg.rawMove(victim, 'hand', { controller: 1 });
    }, g);
    const hand0 = g.players[0].hand.length;
    await activateCard(g, 0, acc);
    eq(morph.location, 'deck', 'Morphtronic still returned');
    eq(g.players[0].hand.length, hand0 - 2, 'no draw');
  });

  await test('CSOC: Iron Chain Repairman targets the GY monster on activation', async () => {
    const { g, c0, c1, place } = setup();
    const rep = place(0, cardByName('Iron Chain Repairman'), 'mzone');
    const snake = place(0, cardByName('Iron Chain Snake'), 'grave');
    c0.pick = (_g, req) => (req.candidates.includes(snake) ? [snake] : req.candidates.slice(0, req.min));
    let targeted: boolean | undefined;
    peekInChain(c1, (gg) => {
      targeted = gg.chain[gg.chain.length - 1].ctx.targets.includes(snake);
    }, g);
    await activateCard(g, 0, rep, 'Special Summon an Iron Chain monster from the GY');
    eq(targeted, true, 'Iron Chain Snake targeted on activation');
    eq(snake.location, 'mzone', 'Special Summoned');
    eq(rep.flags.cannotAttackTurn, g.turn, 'Repairman cannot attack this turn');
  });

  await test('LODT: Batteryman Industrial Strength can target itself as the monster', async () => {
    const { g, c0, place } = setup();
    const bis = place(0, cardByName('Batteryman Industrial Strength'), 'mzone');
    place(0, cardByName('Batteryman Charger'), 'grave');
    const st = place(1, cardByName('Mystical Space Typhoon'), 'szone', { faceUp: false });
    c0.pick = (_g, req) => req.candidates.slice(0, req.min);
    eq(canActivate(g, 0, bis), true, 'activatable with itself as the only monster');
    await activateCard(g, 0, bis);
    eq(bis.location, 'grave', 'itself destroyed');
    eq(st.location, 'grave', 'Spell/Trap destroyed');
  });

  await test('CSOC: Overdrive Teleporter — "once while face-up" starts over after it is turned face-down', async () => {
    const { g, place } = setup();
    const od = place(0, cardByName('Overdrive Teleporter'), 'mzone');
    for (let i = 0; i < 4; i++) place(0, T.psy3, 'deck');
    const label = 'Pay 2000: Special Summon 2 Level 3 Psychic-Type monsters';
    await activateCard(g, 0, od, label);
    eq(g.monsters(0).length, 3, 'summoned 2');
    for (const m of g.monsters(0).filter((c) => c !== od)) g.rawMove(m, 'grave', { controller: 0 });
    g.turn += 2;
    eq(canActivate(g, 0, od, label), false, 'used while face-up');
    await g.changePosition(od, 'def', false, 1);
    await g.changePosition(od, 'atk', true, 0);
    eq(canActivate(g, 0, od, label), true, 'usable again after face-down -> face-up');
  });

  await test('LODT: Arcana Force flipped face-down and back up (not a Flip Summon) has no coin-toss effect', async () => {
    const { g, place } = setup();
    const emp = place(0, cardByName('Arcana Force IV - The Emperor'), 'hand');
    await g.performAction(0, { type: 'summon', card: emp });
    const after = g.getAtk(emp);
    eq(after === 1900 || after === 900, true, 'coin effect applied after the Summon');
    await g.changePosition(emp, 'def', false, 1);
    await g.changePosition(emp, 'atk', true, 1);
    eq(g.getAtk(emp), 1400, 'no effect after being flipped face-up by a card effect');
  });

  await test('CSOC: Neos Wiseman burns/gains for a battled monster the opponent controls but this player owns', async () => {
    const { g, place } = setup();
    const ws = place(0, cardByName('Neos Wiseman'), 'mzone');
    const mine = place(0, T.brute, 'mzone');
    await g.takeControl(mine, 1, false);
    eq(mine.controller, 1, 'opponent controls it');
    await g.conductAttack(0, ws);
    eq(g.players[1].lp, 8000 - (3000 - 1800) - 1800, 'battle damage + its ATK as effect damage');
    eq(g.players[0].lp, 8000 + 1000, 'gained its DEF');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
