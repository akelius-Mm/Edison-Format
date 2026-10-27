// A face-up monster turned face-down is a new card once flipped face-up again (engine: CardInstance.resetOnFaceDown).
// Usage: npx tsx scripts/facedown-reset-test.ts
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import type { BattlePos, Location, PlayerId } from '../src/engine/types';
import { ensureAnprPatches } from '../src/cards/sets/anpr';
import { ensureLodtPatches } from '../src/cards/sets/lodt';
import { ensureCsocPatches } from '../src/cards/sets/csoc';
import { ensureGlasPatches } from '../src/cards/sets/glas';
import { ensurePtdnPatches } from '../src/cards/sets/ptdn';

const T = {
  wall: findCard('Rules Test Wall') ?? normal('Rules Test Wall', 'EARTH', 'Rock', 4, 500, 2000),
  dark: findCard('Rules Test Shade') ?? normal('Rules Test Shade', 'DARK', 'Fiend', 4, 1600, 1200),
  giant: findCard('Rules Test Giant') ?? normal('Rules Test Giant', 'EARTH', 'Warrior', 8, 3000, 2500),
  brute: findCard('Rules Test Brute') ?? normal('Rules Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000),
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

function setup() {
  const c0 = new TestController();
  const c1 = new TestController();
  const filler: CardData[] = Array(20).fill(T.wall);
  const g = new Game([{ main: filler, extra: [] }, { main: filler, extra: [] }], [c0, c1], { seed: 1 });
  g.turn = 2;
  g.turnPlayer = 0;
  g.phase = 'main1';
  ensureAnprPatches(g);
  ensureLodtPatches(g);
  ensureCsocPatches(g);
  ensureGlasPatches(g);
  ensurePtdnPatches(g);
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
const pickOnly = (c: TestController, want: CardInstance[]) => {
  c.pick = (_g, req) => {
    const w = req.candidates.filter((x) => want.includes(x));
    return w.length >= req.min && w.length ? w.slice(0, Math.max(req.min, Math.min(w.length, req.max))) : req.candidates.slice(0, req.min);
  };
};
/** Turn a face-up monster face-down (Book of Moon) and flip it face-up again (not a Flip Summon). */
async function downAndUp(g: Game, c: CardInstance) {
  await g.changePosition(c, 'def', false, 1);
  eq(c.faceUp, false, 'turned face-down');
  await g.changePosition(c, 'atk', true, 0);
  eq(c.faceUp, true, 'flipped face-up');
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
  console.log('Face-down reset tests');

  await test('XX-Saber Fulhelmknight: "once while face-up" starts over after it is turned face-down', async () => {
    const { g, place } = setup();
    const fk = place(1, cardByName('XX-Saber Fulhelmknight'), 'mzone', { pos: 'def' });
    const a = place(0, T.giant, 'mzone');
    await g.conductAttack(0, a);
    eq(fk.location, 'mzone', 'first attack negated');
    eq(!!fk.flags.fulhelmUsed, true, 'used');
    await g.changePosition(fk, 'def', false, 0);
    eq(fk.flags.fulhelmUsed, undefined, 'reset when turned face-down');
    await g.changePosition(fk, 'def', true, 1);
    a.attacksThisTurn = 0;
    await g.conductAttack(0, a);
    eq(fk.location, 'mzone', 'face-up again: the second attack is negated too');
  });

  await test('Overdrive Teleporter: "once while face-up" starts over after it is turned face-down', async () => {
    const { g, place } = setup();
    const od = place(0, cardByName('Overdrive Teleporter'), 'mzone');
    for (let i = 0; i < 4; i++) place(0, T.psy3, 'deck');
    const label = 'Pay 2000: Special Summon 2 Level 3 Psychic-Type monsters';
    await activateCard(g, 0, od, label);
    eq(g.monsters(0).length, 3, 'summoned 2');
    for (const m of g.monsters(0).filter((c) => c !== od)) g.rawMove(m, 'grave', { controller: 0 });
    g.turn += 2;
    eq(canActivate(g, 0, od, label), false, 'used while face-up');
    await downAndUp(g, od);
    eq(canActivate(g, 0, od, label), true, 'usable again');
  });

  await test('Gemini (Gigaplant): turned face-down and flipped face-up again, it is a Normal Monster again', async () => {
    const { g, place } = setup();
    const gp = place(0, cardByName('Gigaplant'), 'mzone');
    g.players[0].normalSummonsLeft = 1;
    eq(gp.hasType('normal'), true, 'Normal Monster before the Gemini Summon');
    await g.geminiSummon(0, gp);
    eq(gp.hasType('effect'), true, 'Effect Monster after the Gemini Summon');
    eq(gp.hasType('normal'), false, 'no longer Normal');
    await downAndUp(g, gp);
    eq(gp.hasType('normal'), true, 'Normal Monster again');
    eq(gp.hasType('effect'), false, 'not an Effect Monster');
    eq(!!gp.flags.geminiSummoned, false, 'Gemini status lost');
    g.players[0].normalSummonsLeft = 1;
    eq(g.canGeminiSummon(0, gp), true, 'can be Gemini Summoned again');
  });

  await test('Dark Valkyria: Spell Counter and "once while face-up" both reset when turned face-down', async () => {
    const { g, place } = setup();
    const dv = place(0, cardByName('Dark Valkyria'), 'mzone');
    g.players[0].normalSummonsLeft = 1;
    await g.geminiSummon(0, dv);
    await activateCard(g, 0, dv, 'Place 1 Spell Counter');
    eq(dv.counters.spell ?? 0, 1, 'Spell Counter placed');
    eq(g.getAtk(dv), 2100, '1800 + 300');
    eq(canActivate(g, 0, dv, 'Place 1 Spell Counter'), false, 'once while face-up');
    await downAndUp(g, dv);
    eq(dv.counters.spell ?? 0, 0, 'Spell Counter removed');
    eq(g.getAtk(dv), 1800, 'ATK back to 1800');
    eq(canActivate(g, 0, dv, 'Place 1 Spell Counter'), false, 'a Normal Monster again: no effect');
    g.players[0].normalSummonsLeft = 1;
    await g.geminiSummon(0, dv);
    eq(canActivate(g, 0, dv, 'Place 1 Spell Counter'), true, 'Gemini Summoned again: can place a counter again');
  });

  await test('Counters and applied stat changes are removed when a monster is turned face-down', async () => {
    const { g, place } = setup();
    const m = place(0, T.brute, 'mzone');
    m.counters.spell = 2;
    g.addTempMod(m, 'atk', 500, 'turn');
    eq(g.getAtk(m), 2300, 'buffed');
    const moveId = m.moveId;
    const faceUpId = m.faceUpId;
    await downAndUp(g, m);
    eq(Object.keys(m.counters).length, 0, 'counters removed');
    eq(g.getAtk(m), 1800, 'ATK change gone');
    eq(m.moveId, moveId, 'still the same card on the field (moveId kept)');
    eq(m.faceUpId, faceUpId + 1, 'faceUpId bumped');
  });

  await test('An Equip Spell is destroyed when the equipped monster is turned face-down', async () => {
    const { g, c0, place } = setup();
    const m = place(0, T.brute, 'mzone');
    const axe = place(0, cardByName('Axe of Despair'), 'hand');
    pickOnly(c0, [m]);
    await activateCard(g, 0, axe);
    eq(axe.location, 'szone', 'equipped');
    eq(g.getAtk(m), 2800, 'Axe +1000');
    await g.changePosition(m, 'def', false, 1);
    eq(axe.location, 'grave', 'Axe destroyed');
    await g.changePosition(m, 'atk', true, 0);
    eq(g.getAtk(m), 1800, 'no Axe bonus');
  });

  await test('War Chariot still destroys a monster that was turned face-down before it resolved', async () => {
    // War Chariot is a Counter Trap, so in a real duel only Counter Traps can be chained to it; the face-down turn is
    // forced here just before the Chain resolves to check that it is still "the same card" for negate-and-destroy.
    const { g, c0, c1, place } = setup();
    const wc = place(1, cardByName('Gladiator Beast War Chariot'), 'szone');
    place(1, cardByName('Gladiator Beast Hoplomus'), 'mzone', { pos: 'def' });
    const dad = place(0, cardByName('Dark Armed Dragon'), 'mzone');
    place(0, T.dark, 'grave');
    const st = place(1, cardByName('Mirror Force'), 'szone');
    c1.respond = (_g, req) => req.options.find((o) => o.card === wc) ?? null;
    pickOnly(c0, [st]);
    const anyG = g as any;
    const orig = anyG.resolveChain.bind(g);
    let done = false;
    anyG.resolveChain = async () => {
      if (!done && g.chain.some((l) => l.card === wc)) {
        done = true;
        await g.changePosition(dad, 'def', false, 1);
      }
      return orig();
    };
    await activateCard(g, 0, dad);
    eq(done, true, 'DAD was turned face-down with War Chariot on the Chain');
    eq(wc.location, 'grave', 'War Chariot used');
    eq(dad.location, 'grave', 'DAD destroyed even though it was turned face-down');
    eq(st.location, 'szone', 'its effect negated');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
