// Undo for misclicks (engine/undo.ts): when the human may take a play back, and that taking it back
// (rebuilding the duel from its seed and the decision log minus the undone decisions) gives exactly
// the position before the play.
//
//  1. Undo a Normal Summon: the monster is back in hand, the Normal Summon unused, the board equal
//     to the snapshot taken when the summon was chosen.
//  2. Moving to the Battle Phase by mistake can be undone (back to Main Phase 1).
//  3. Not after the opponent was asked to respond (Trap Hole set; activating or passing both count).
//  4. Not after a draw (Pot of Greed) or a search (Reinforcement of the Army).
//  5. Not after damage (a direct attack), and not once the turn passed to the opponent.
//  6. Determinism: a game continued after an undo replays identically from its log, twice.
//  7. Fuzz: AI-driven "human" games; at every main-action prompt where undo is allowed, rebuild
//     from the cut log and check the board equals the snapshot from when that action was chosen.
//
// Usage: npx tsx scripts/undo-test.ts [--games N]
import '../src/cards';
import { cardByName, findCard } from '../src/cards';
import { normal } from '../src/cards/define';
import { AIController } from '../src/ai/ai';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, ConfirmRequest, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver, type DeckList } from '../src/engine/game';
import { RecordingController, type Decision } from '../src/engine/replay';
import { UndoTracker } from '../src/engine/undo';
import type { BattlePos, PlayerId } from '../src/engine/types';
import { PREMADE_DECKS, buildDeckList } from '../src/decks';

const args = process.argv.slice(2);
const GAMES = Number(args[args.indexOf('--games') + 1] || 8) || 8;
const origError = console.error;
console.error = () => {};

const BRUTE = findCard('Undo Test Brute') ?? normal('Undo Test Brute', 'EARTH', 'Warrior', 4, 1800, 1000);
const WALL = findCard('Undo Test Wall') ?? normal('Undo Test Wall', 'EARTH', 'Rock', 4, 500, 2000);
const of = (c: CardData, n: number) => Array(n).fill(c) as CardData[];

/** Ends a test game at a checkpoint. */
class Stop extends GameOver {
  constructor() {
    super(null, 'stop');
  }
}

type Fn<T> = (g: Game, ...a: any[]) => T | Promise<T>;

/** A seat driven by a script; everything not scripted takes the first / safest answer. */
class Script implements PlayerController {
  constructor(
    readonly isHuman: boolean,
    public onAction: (g: Game, acts: Action[], n: number) => Action | Promise<Action>,
    public onResponse: (g: Game, req: ResponseRequest) => Activation | null = () => null,
  ) {}
  n = 0;
  async chooseAction(g: Game, _p: PlayerId, acts: Action[]) {
    return this.onAction(g, acts, this.n++);
  }
  async chooseResponse(g: Game, _p: PlayerId, req: ResponseRequest) {
    return this.onResponse(g, req);
  }
  async selectCards(_g: Game, _p: PlayerId, req: SelectRequest) {
    return req.candidates.slice(0, Math.max(req.min, 1)).slice(0, req.max);
  }
  async chooseOption() {
    return 0;
  }
  async confirm(_g: Game, _p: PlayerId, _r: ConfirmRequest) {
    return true;
  }
  async confirmTrigger() {
    return true;
  }
  async choosePosition(_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return allowed[0];
  }
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    return canDirect ? null : (targets[0] ?? 'cancel');
  }
  async declareCard(_g: Game, _p: PlayerId, _prompt: string, names: string[]) {
    return names[0];
  }
}

/** An AI that reports isHuman (the human-only card paths run), as in replay-test.ts. */
function scriptedHuman(ai: AIController): PlayerController {
  return new Proxy(ai, { get: (t, k) => (k === 'isHuman' ? true : typeof (t as any)[k] === 'function' ? (t as any)[k].bind(t) : (t as any)[k]) }) as PlayerController;
}

/** Full board snapshot by registration index (as in replay-test.ts). */
function snapshot(g: Game): string {
  const ref = (c: CardInstance | null) => (c ? `${g.allCards.indexOf(c)}${c.faceUp ? 'u' : 'd'}${c.onField && c.isMonster ? c.pos : ''}` : '-');
  return JSON.stringify({
    t: g.turn,
    ph: g.phase,
    tp: g.turnPlayer,
    ch: g.chain.map((l) => `${g.allCards.indexOf(l.card)}:${l.effectIndex}`),
    p: g.players.map((p) => ({ lp: p.lp, ns: p.normalSummonsLeft, hand: p.hand.map(ref), deck: p.deck.map(ref), m: p.mzone.map(ref), s: p.szone.map(ref), f: ref(p.fzone), gy: p.grave.map(ref), ban: p.banished.map(ref), ex: p.extra.map(ref) })),
  });
}

interface Duel {
  decks: [DeckList, DeckList];
  seed: number;
  first: PlayerId;
  /** The human's seat is always 0 here. */
  human: PlayerController;
  opp: PlayerController;
  replay?: Decision[];
}

/** Same wiring as the duel screen: recorder (with the undo hook) on the human, watched opponent. */
async function run(d: Duel) {
  const tracker = new UndoTracker(0);
  const rec = new RecordingController(d.human, { replay: d.replay, onRequest: (k, g, i) => tracker.onRequest(k, g, i) });
  const game = new Game(d.decks, [rec, tracker.watchOpponent(d.opp)], { seed: d.seed, firstPlayer: d.first, skipFirstDraw: true, maxTurns: 40 });
  const res = await game.start();
  return { game, rec, tracker, res };
}

/** Passive opponent: ends every turn, never responds. */
const passive = () => new Script(false, (_g, acts) => acts.find((a) => a.type === 'phase' && a.to === 'end') ?? acts[acts.length - 1]);
const endTurn = (acts: Action[]) => acts.find((a) => a.type === 'phase' && a.to === 'end')!;
const pick = (acts: Action[], type: Action['type'], name?: string) => acts.find((a) => a.type === type && (!name || ('card' in a && a.card.name === name)));

let pass = 0;
let failCount = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failCount++;
    console.log(`  ✗ ${name}\n      ${(e as Error).stack ?? e}`);
  }
}
function ok(v: unknown, msg: string): asserts v {
  if (!v) throw new Error(msg);
}
function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${String(b)}, got ${String(a)}`);
}

/** Plays `first`, then at the next main-action prompt records whether / where undo goes, and stops. */
async function playThenCheck(decks: [DeckList, DeckList], seed: number, firstPlayer: PlayerId, steps: ((g: Game, acts: Action[]) => Action)[], opp: PlayerController = passive()) {
  let before = '';
  let blocked: string | null = null;
  let index = -1;
  let tracker!: UndoTracker;
  let rec!: RecordingController;
  const human = new Script(true, (g, acts, n) => {
    if (n < steps.length) {
      if (n === steps.length - 1) before = snapshot(g);
      return steps[n](g, acts);
    }
    blocked = tracker.blocked(g, rec.log.length);
    index = tracker.undoIndex(g, rec.log.length);
    throw new Stop();
  });
  // run() builds the tracker; reach into it through a wrapper
  const t = new UndoTracker(0);
  tracker = t;
  rec = new RecordingController(human, { onRequest: (k, g, i) => t.onRequest(k, g, i) });
  const game = new Game(decks, [rec, t.watchOpponent(opp)], { seed, firstPlayer, skipFirstDraw: true, maxTurns: 40 });
  await game.start();
  return { game, log: [...rec.log], before, blocked: blocked as string | null, index };
}

/** Rebuild from a cut log; returns the snapshot at the first live main-action prompt. */
async function rebuildAt(decks: [DeckList, DeckList], seed: number, first: PlayerId, log: Decision[], opp: PlayerController = passive()) {
  let snap = '';
  let actions: Action[] = [];
  let g0: Game | null = null;
  const human = new Script(true, (g, acts) => {
    snap = snapshot(g);
    actions = acts;
    g0 = g;
    throw new Stop();
  });
  const r = await run({ decks, seed, first, human, opp, replay: log });
  ok(!r.rec.mismatch, `replay mismatch: ${r.rec.mismatch}`);
  return { snap, actions, game: g0 as unknown as Game, rec: r.rec };
}

(async () => {
  console.log('Undo tests');
  const vanilla: [DeckList, DeckList] = [{ main: of(BRUTE, 40), extra: [] }, { main: of(WALL, 40), extra: [] }];

  await test('undo a Normal Summon: monster back in hand, Normal Summon unused', async () => {
    const r = await playThenCheck(vanilla, 11, 0, [(_g, acts) => pick(acts, 'summon')!]);
    eq(r.blocked, null, 'undo allowed');
    eq(r.game.players[0].normalSummonsLeft, 0, 'summon used before undo');
    const d = r.log[r.index];
    ok(d && d.k === 'act' && d.t === 'summon', `undo point is the summon (got ${JSON.stringify(d)})`);
    const cut = r.log.slice(0, r.index);
    const b = await rebuildAt(vanilla, 11, 0, cut);
    eq(b.snap, r.before, 'board equals the position before the summon');
    const g = b.game;
    eq(g.players[0].normalSummonsLeft, 1, 'normal summon unused');
    eq(g.players[0].mzone.filter(Boolean).length, 0, 'no monster on the field');
    eq(g.players[0].hand.length, 5, 'card back in hand');
    ok(pick(b.actions, 'summon'), 'summon offered again');
    eq(b.rec.log.length, cut.length, 'log holds only the kept decisions');
  });

  await test('undo moving to the Battle Phase: back in Main Phase 1', async () => {
    // human first: turn 1 has no Battle Phase, so play turn 1, the opponent's turn 2, then turn 3
    const r = await playThenCheck(vanilla, 12, 0, [(_g, acts) => endTurn(acts), (_g, acts) => acts.find((a) => a.type === 'phase' && a.to === 'battle')!]);
    eq(r.blocked, null, 'undo allowed');
    const b = await rebuildAt(vanilla, 12, 0, r.log.slice(0, r.index));
    eq(b.game.phase, 'main1', 'phase');
    eq(b.snap, r.before, 'board');
  });

  await test('after undoing the first play of the game there is nothing earlier to undo', async () => {
    const r = await playThenCheck(vanilla, 13, 0, [(_g, acts) => pick(acts, 'summon')!]);
    const b = await rebuildAt(vanilla, 13, 0, r.log.slice(0, r.index));
    // after the rebuild there is nothing earlier to go back to
    const t = new UndoTracker(0);
    let blocked: string | null = 'x';
    const rec = new RecordingController(
      new Script(true, (g) => {
        blocked = t.blocked(g, rec.log.length);
        throw new Stop();
      }),
      { replay: r.log.slice(0, r.index), onRequest: (k, g, i) => t.onRequest(k, g, i) },
    );
    await new Game(vanilla, [rec, t.watchOpponent(passive())], { seed: 13, firstPlayer: 0, skipFirstDraw: true }).start();
    eq(blocked, 'nothing to undo', 'first action of the game');
    ok(b.snap, 'rebuilt');
  });

  await test('not after the opponent was asked to respond (Trap Hole, activated)', async () => {
    const trapHole = cardByName('Trap Hole');
    const oppDecks: [DeckList, DeckList] = [{ main: of(BRUTE, 40), extra: [] }, { main: of(trapHole, 40), extra: [] }];
    const opp = new Script(false, (_g, acts) => pick(acts, 'setST', 'Trap Hole') ?? endTurn(acts), (_g, req) => req.options.find((o) => o.card.name === 'Trap Hole') ?? null);
    const r = await playThenCheck(oppDecks, 21, 1, [(_g, acts) => pick(acts, 'summon')!], opp);
    eq(r.game.players[0].mzone.filter(Boolean).length, 0, 'Trap Hole destroyed the monster');
    ok(r.blocked, 'undo blocked');
  });

  await test('not after the opponent was asked to respond (Trap Hole, AI passed)', async () => {
    const trapHole = cardByName('Trap Hole');
    const oppDecks: [DeckList, DeckList] = [{ main: of(BRUTE, 40), extra: [] }, { main: of(trapHole, 40), extra: [] }];
    const opp = new Script(false, (_g, acts) => pick(acts, 'setST', 'Trap Hole') ?? endTurn(acts), () => null);
    const r = await playThenCheck(oppDecks, 22, 1, [(_g, acts) => pick(acts, 'summon')!], opp);
    eq(r.game.players[0].mzone.filter(Boolean).length, 1, 'monster stayed');
    eq(r.blocked, 'the opponent was asked to respond', 'reason');
  });

  await test('not after a draw (Pot of Greed)', async () => {
    const decks: [DeckList, DeckList] = [{ main: of(cardByName('Pot of Greed'), 40), extra: [] }, { main: of(WALL, 40), extra: [] }];
    const r = await playThenCheck(decks, 31, 0, [(_g, acts) => pick(acts, 'activate', 'Pot of Greed')!]);
    eq(r.game.players[0].hand.length, 6, 'drew 2');
    ok(r.blocked, 'undo blocked');
    ok(r.blocked !== 'the opponent was asked to respond', `blocked by the draw, not the opponent (${r.blocked})`);
  });

  await test('not after a search (Reinforcement of the Army)', async () => {
    const decks: [DeckList, DeckList] = [{ main: [...of(cardByName('Reinforcement of the Army'), 30), ...of(BRUTE, 10)], extra: [] }, { main: of(WALL, 40), extra: [] }];
    const r = await playThenCheck(decks, 32, 0, [(_g, acts) => pick(acts, 'activate', 'Reinforcement of the Army')!]);
    ok(r.game.players[0].hand.some((c) => c.name === BRUTE.name), 'searched a Warrior');
    ok(r.blocked, 'undo blocked');
    ok(r.blocked !== 'the opponent was asked to respond', `blocked by the search (${r.blocked})`);
  });

  await test('not after damage (direct attack)', async () => {
    const steps = [(_g: Game, acts: Action[]) => pick(acts, 'summon')!, (_g: Game, acts: Action[]) => endTurn(acts), (_g: Game, acts: Action[]) => acts.find((a) => a.type === 'phase' && a.to === 'battle')!, (_g: Game, acts: Action[]) => pick(acts, 'attack')!];
    // the opponent never summons (Walls only, ends at once): the attack is direct
    const r = await playThenCheck(vanilla, 41, 0, steps);
    eq(r.game.players[1].lp, 8000 - 1800, 'damage dealt');
    eq(r.blocked, 'Life Points changed', 'reason');
  });

  await test('not once the turn passed to the opponent', async () => {
    const r = await playThenCheck(vanilla, 42, 0, [(_g, acts) => endTurn(acts)]);
    eq(r.game.turn, 3, 'back on turn 3');
    ok(r.blocked === 'the opponent was asked to respond' || r.blocked === 'the turn changed', `reason (${r.blocked})`);
  });

  await test('replaying after an undo is deterministic', async () => {
    const r = await playThenCheck(vanilla, 51, 0, [(_g, acts) => pick(acts, 'summon')!]);
    const cut = r.log.slice(0, r.index);
    // continue differently (Set instead of Summon), then let AIs play both seats for several turns
    const cont = async () => {
      const ai = new AIController('normal', 777);
      let first = true;
      const human = new Script(true, (g, acts) => {
        if (g.turn >= 7) throw new Stop();
        if (first) {
          first = false;
          return pick(acts, 'set')!;
        }
        return ai.chooseAction(g, 0, acts);
      });
      const res = await run({ decks: vanilla, seed: 51, first: 0, human, opp: new AIController('normal', 51 + 7919), replay: cut });
      return { log: [...res.rec.log], snap: snapshot(res.game) };
    };
    const a = await cont();
    const b = await cont();
    eq(JSON.stringify(a.log), JSON.stringify(b.log), 'same log');
    eq(a.snap, b.snap, 'same board');
    ok(a.log.length > cut.length + 3, 'played on');
    // the saved log (cut + new decisions) alone rebuilds the same game
    const c = await rebuildAt(vanilla, 51, 0, a.log, new AIController('normal', 51 + 7919));
    eq(c.snap, a.snap, 'rebuilt from the log');
  });

  // ---- fuzz with real decks and AI-driven "human" decisions
  let checked = 0;
  let allowedSeen = 0;
  await test(`fuzz: ${GAMES} AI games, every allowed undo rebuilds the exact position`, async () => {
    for (let i = 0; i < GAMES; i++) {
      const A = PREMADE_DECKS[(i * 5) % PREMADE_DECKS.length];
      const B = PREMADE_DECKS[(i * 7 + 2) % PREMADE_DECKS.length];
      const decks: [DeckList, DeckList] = [buildDeckList(A), buildDeckList(B)];
      const seed = 9001 + i * 131;
      const first = (i % 2) as PlayerId;
      const oppSeed = seed + 7919;
      const snaps = new Map<number, string>();
      const pending: { cut: number; at: string }[] = [];
      const ai = new AIController('hard', seed * 3 + 1);
      const t = new UndoTracker(0);
      const rec: RecordingController = new RecordingController(scriptedHuman(ai), {
        onRequest: (k, g, idx) => {
          t.onRequest(k, g, idx);
          if (k !== 'act' || g.turnPlayer !== 0) return;
          snaps.set(idx, snapshot(g));
          const cut = t.undoIndex(g, idx);
          if (cut >= 0 && pending.length < 6) pending.push({ cut, at: `turn ${g.turn} ${g.phase}` });
        },
      });
      const g = new Game(decks, [rec, t.watchOpponent(new AIController('normal', oppSeed))], { seed, firstPlayer: first, skipFirstDraw: true, maxTurns: 40 });
      await g.start();
      const log = [...rec.log];
      for (const p of pending) {
        allowedSeen++;
        const b = await rebuildAt(decks, seed, first, log.slice(0, p.cut), new AIController('normal', oppSeed));
        eq(b.snap, snaps.get(p.cut), `${A.id} vs ${B.id} seed ${seed}: undo at ${p.at} rebuilds the position`);
        checked++;
      }
    }
    ok(allowedSeen > 0, 'some undo was allowed');
  });
  console.log(`  (${checked} undos rebuilt in the fuzz)`);

  console.error = origError;
  console.log(`\n${pass} passed, ${failCount} failed`);
  if (failCount) process.exit(1);
})();
