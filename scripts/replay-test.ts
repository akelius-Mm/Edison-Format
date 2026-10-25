// Determinism / resume test: a duel recorded from the human seat must replay to the identical
// game from its seed, decks and decision log, so a duel killed mid-game (iOS closes home-screen
// apps in the background) can be rebuilt exactly.
//
//  1. Play AI vs a scripted "human" (an AI that reports isHuman, so human-only card paths run),
//     recording the human's decisions and a full state snapshot at every decision.
//  2. Replay the whole log with the same seeds: every snapshot must match and no live request
//     may happen.
//  3. Replay half the log, then hand over to a second log-fed controller (the resume hand-off).
//  4. Corrupt one entry: the replay must stop with a mismatch instead of crashing.
//
// Card uids are a process-wide counter, so later games in this process get different uids than
// the recording: the log must not depend on them.
//
// Usage: npx tsx scripts/replay-test.ts [--games N] [--seed S] [--verbose]
import { AIController, type Difficulty } from '../src/ai/ai';
import type { CardInstance } from '../src/engine/card';
import type { Action, Activation, ConfirmRequest, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game } from '../src/engine/game';
import { RecordingController, type Decision } from '../src/engine/replay';
import type { BattlePos, PlayerId } from '../src/engine/types';
import { PREMADE_DECKS, buildDeckList, type DeckDef } from '../src/decks';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const GAMES = Number(arg('games', '12'));
const SEED0 = Number(arg('seed', '101'));
const verbose = args.includes('--verbose');
const origError = console.error;
console.error = (...a: unknown[]) => {
  if (verbose) origError(...a);
};

/** An AI that claims to be human, standing in for the player's taps. */
class ScriptedHuman implements PlayerController {
  readonly isHuman = true;
  constructor(private ai: AIController) {}
  chooseAction(g: Game, p: PlayerId, a: Action[]) {
    return this.ai.chooseAction(g, p, a);
  }
  chooseResponse(g: Game, p: PlayerId, r: ResponseRequest) {
    return this.ai.chooseResponse(g, p, r);
  }
  selectCards(g: Game, p: PlayerId, r: SelectRequest) {
    return this.ai.selectCards(g, p, r);
  }
  chooseOption(g: Game, p: PlayerId, r: OptionRequest) {
    return this.ai.chooseOption(g, p, r);
  }
  confirm(g: Game, p: PlayerId, r: ConfirmRequest) {
    return this.ai.confirm(g, p, r);
  }
  choosePosition(g: Game, p: PlayerId, c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return this.ai.choosePosition(g, p, c, allowed);
  }
  chooseAttackTarget(g: Game, p: PlayerId, a: CardInstance, t: CardInstance[], d: boolean) {
    return this.ai.chooseAttackTarget(g, p, a, t, d);
  }
  confirmTrigger(g: Game, p: PlayerId, act: Activation) {
    return this.ai.confirmTrigger(g, p, act);
  }
  declareCard(g: Game, p: PlayerId, prompt: string, names: string[]) {
    return this.ai.declareCard(g, p, prompt, names);
  }
}

/** Fails the test if the replay ever asks for a live decision. */
class NoLive implements PlayerController {
  readonly isHuman = true;
  calls = 0;
  private no<T>(): Promise<T> {
    this.calls++;
    return Promise.reject(new Error('live decision requested during a full replay'));
  }
  chooseAction() {
    return this.no<Action>();
  }
  chooseResponse() {
    return this.no<Activation | null>();
  }
  selectCards() {
    return this.no<CardInstance[]>();
  }
  chooseOption() {
    return this.no<number>();
  }
  confirm() {
    return this.no<boolean>();
  }
  choosePosition() {
    return this.no<BattlePos | 'set'>();
  }
  chooseAttackTarget() {
    return this.no<CardInstance | null | 'cancel'>();
  }
  confirmTrigger() {
    return this.no<boolean>();
  }
  declareCard() {
    return this.no<string>();
  }
}

/** Full snapshot: LP, every zone in order (cards by registration index, face and position), chain, phase, turn. */
function snapshot(g: Game): string {
  const ref = (c: CardInstance | null) => (c ? `${g.allCards.indexOf(c)}${c.faceUp ? 'u' : 'd'}${c.onField && c.isMonster ? c.pos : ''}` : '-');
  return JSON.stringify({
    t: g.turn,
    ph: g.phase,
    tp: g.turnPlayer,
    ch: g.chain.map((l) => `${g.allCards.indexOf(l.card)}:${l.effectIndex}`),
    p: g.players.map((p) => ({
      lp: p.lp,
      hand: p.hand.map(ref),
      deck: p.deck.map(ref),
      m: p.mzone.map(ref),
      s: p.szone.map(ref),
      f: ref(p.fzone),
      gy: p.grave.map(ref),
      ban: p.banished.map(ref),
      ex: p.extra.map(ref),
    })),
  });
}

/** Wraps the human seat and snapshots the board at every decision request. */
class Snapshotter implements PlayerController {
  readonly isHuman = true;
  snaps: string[] = [];
  constructor(private inner: PlayerController) {}
  private s(g: Game) {
    this.snaps.push(snapshot(g));
  }
  chooseAction(g: Game, p: PlayerId, a: Action[]) {
    this.s(g);
    return this.inner.chooseAction(g, p, a);
  }
  chooseResponse(g: Game, p: PlayerId, r: ResponseRequest) {
    this.s(g);
    return this.inner.chooseResponse(g, p, r);
  }
  selectCards(g: Game, p: PlayerId, r: SelectRequest) {
    this.s(g);
    return this.inner.selectCards(g, p, r);
  }
  chooseOption(g: Game, p: PlayerId, r: OptionRequest) {
    this.s(g);
    return this.inner.chooseOption(g, p, r);
  }
  confirm(g: Game, p: PlayerId, r: ConfirmRequest) {
    this.s(g);
    return this.inner.confirm(g, p, r);
  }
  choosePosition(g: Game, p: PlayerId, c: CardInstance, allowed: (BattlePos | 'set')[]) {
    this.s(g);
    return this.inner.choosePosition(g, p, c, allowed);
  }
  chooseAttackTarget(g: Game, p: PlayerId, a: CardInstance, t: CardInstance[], d: boolean) {
    this.s(g);
    return this.inner.chooseAttackTarget(g, p, a, t, d);
  }
  confirmTrigger(g: Game, p: PlayerId, act: Activation) {
    this.s(g);
    return this.inner.confirmTrigger(g, p, act);
  }
  declareCard(g: Game, p: PlayerId, prompt: string, names: string[]) {
    this.s(g);
    return this.inner.declareCard!(g, p, prompt, names);
  }
}

interface Run {
  res: { winner: PlayerId | null; reason: string; turns: number };
  snaps: string[];
  final: string;
  log: Decision[];
  rec: RecordingController;
}

interface Setup {
  a: DeckDef;
  b: DeckDef;
  seed: number;
  human: PlayerId;
  aiLevel: Difficulty;
  skipFirstDraw: boolean;
}

/** Same construction as the duel screen: AI seeded from the game seed and its seat. */
async function play(s: Setup, humanSeat: (recOpts: { replay?: Decision[] }) => { ctl: PlayerController; rec: RecordingController }, replay?: Decision[]): Promise<Run> {
  const { ctl, rec } = humanSeat({ replay });
  const snap = new Snapshotter(ctl);
  const ai = new AIController(s.aiLevel, s.seed + (1 - s.human) * 7919);
  const ctls = (s.human === 0 ? [snap, ai] : [ai, snap]) as [PlayerController, PlayerController];
  const g = new Game([buildDeckList(s.a), buildDeckList(s.b)], ctls, { seed: s.seed, names: ['A', 'B'], maxTurns: 40, skipFirstDraw: s.skipFirstDraw });
  const res = await Promise.race([
    g.start(),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 30000)),
  ]);
  return { res, snaps: snap.snaps, final: snapshot(g), log: [...rec.log], rec };
}

const live = (s: Setup) => () => {
  const rec = new RecordingController(new ScriptedHuman(new AIController('hard', s.seed * 31 + 5)));
  return { ctl: rec, rec };
};
const fromLog = () => (o: { replay?: Decision[] }) => {
  const rec = new RecordingController(new NoLive(), { replay: o.replay });
  return { ctl: rec, rec };
};

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};

function compare(label: string, a: Run, b: Run) {
  if (a.snaps.length !== b.snaps.length) fail(`${label}: ${a.snaps.length} decisions recorded, ${b.snaps.length} replayed`);
  const n = Math.min(a.snaps.length, b.snaps.length);
  for (let i = 0; i < n; i++)
    if (a.snaps[i] !== b.snaps[i]) {
      fail(`${label}: state differs at decision ${i + 1}\n  rec ${a.snaps[i].slice(0, 300)}\n  rep ${b.snaps[i].slice(0, 300)}`);
      return;
    }
  if (a.final !== b.final) fail(`${label}: final state differs`);
  if (a.res.winner !== b.res.winner || a.res.turns !== b.res.turns || a.res.reason !== b.res.reason) fail(`${label}: result ${JSON.stringify(a.res)} vs ${JSON.stringify(b.res)}`);
}

(async () => {
  const t0 = Date.now();
  const decks = PREMADE_DECKS;
  let decisions = 0;
  for (let i = 0; i < GAMES; i++) {
    const s: Setup = {
      a: decks[(i * 5) % decks.length],
      b: decks[(i * 11 + 3) % decks.length],
      seed: SEED0 + i * 977,
      human: (i % 2) as PlayerId,
      aiLevel: (['easy', 'normal', 'hard'] as Difficulty[])[i % 3],
      skipFirstDraw: i % 4 === 3,
    };
    const label = `${s.a.id} vs ${s.b.id} seed ${s.seed} human@${s.human}`;
    let rec: Run;
    try {
      rec = await play(s, live(s));
    } catch (e) {
      fail(`${label}: recording crashed ${(e as Error).stack}`);
      continue;
    }
    decisions += rec.log.length;
    // JSON round trip, as stored in localStorage
    const log: Decision[] = JSON.parse(JSON.stringify(rec.log));

    // 2. full replay
    const full = await play(s, fromLog(), log);
    if (full.rec.mismatch) fail(`${label}: full replay mismatch: ${full.rec.mismatch}`);
    compare(`${label} [full]`, rec, full);

    // 3. replay a prefix, then hand over to a second log-fed controller (the live UI on resume)
    const k = Math.floor(log.length / 2);
    let handedOver = 0;
    const handoff = (o: { replay?: Decision[] }) => {
      const tail = new RecordingController(new NoLive(), { replay: log.slice(k) });
      const head = new RecordingController(tail, { replay: o.replay, onReplayEnd: () => handedOver++ });
      return { ctl: head, rec: tail };
    };
    const half = await play(s, handoff, log.slice(0, k));
    if (half.rec.mismatch) fail(`${label}: hand-off mismatch: ${half.rec.mismatch}`);
    if (k > 0 && k < log.length && handedOver !== 1) fail(`${label}: replay hand-off fired ${handedOver} times`);
    half.log = log; // the tail controller only holds the second half
    compare(`${label} [resume @${k}]`, rec, half);

    // 4. a corrupted log must stop cleanly with a mismatch
    if (log.length > 4) {
      const bad: Decision[] = JSON.parse(JSON.stringify(log));
      const j = Math.floor(log.length / 3);
      bad[j] = { ...bad[j], h: 'corrupt' } as Decision;
      try {
        const r = await play(s, fromLog(), bad);
        if (!r.rec.mismatch) fail(`${label}: corrupted log replayed without a mismatch`);
        else if (r.res.winner !== null || r.res.reason !== 'Restore failed') fail(`${label}: mismatch did not end the game cleanly (${JSON.stringify(r.res)})`);
      } catch (e) {
        fail(`${label}: corrupted log crashed ${(e as Error).message}`);
      }
    }
    if (verbose) console.log(`${label}: ${rec.log.length} decisions, ${rec.res.turns} turns, winner ${rec.res.winner} (${rec.res.reason})`);
  }
  console.log(`replay-test: ${GAMES} games, ${decisions} recorded decisions, ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failures ? 1 : 0);
})();
