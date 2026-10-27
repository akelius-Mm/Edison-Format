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
//  5. Best-of-3 with side decking: game 2 is played with sided decks (the human's swaps and the
//     AI's deterministic siding); the saved record (JSON) rebuilds those exact decks, so game 2
//     replays and resumes identically. A record without decks falls back to the original lists.
//
// Card uids are a process-wide counter, so later games in this process get different uids than
// the recording: the log must not depend on them.
//
// Usage: npx tsx scripts/replay-test.ts [--games N] [--seed S] [--verbose]
import { AIController, type Difficulty } from '../src/ai/ai';
import type { CardInstance } from '../src/engine/card';
import type { Action, Activation, ConfirmRequest, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, type DeckList } from '../src/engine/game';
import { RecordingController, type Decision } from '../src/engine/replay';
import type { BattlePos, PlayerId } from '../src/engine/types';
import { PREMADE_DECKS, aiSideDeck, buildDeckList, canSwap, sideSummary, swapCards, type DeckDef, type DeckIds } from '../src/decks';
import { CARDS } from '../src/cards';
import { deckFromIds, deckToIds, type SavedDuel } from '../src/ui/duel/resume';

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
  chooseTriggerOrder(g: Game, p: PlayerId, acts: Activation[]) {
    // reversed, so the recorded order differs from the engine's default and the replay has to reproduce it
    return this.ai.chooseTriggerOrder(g, p, acts).then((o) => o.reverse());
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
  chooseTriggerOrder() {
    return this.no<Activation[]>();
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
  chooseTriggerOrder(g: Game, p: PlayerId, acts: Activation[]) {
    this.s(g);
    return this.inner.chooseTriggerOrder!(g, p, acts);
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
  /** Explicit card lists (sided decks); default: the deck definitions. */
  lists?: [DeckList, DeckList];
}

/** Same construction as the duel screen: AI seeded from the game seed and its seat. */
async function play(s: Setup, humanSeat: (recOpts: { replay?: Decision[] }) => { ctl: PlayerController; rec: RecordingController }, replay?: Decision[]): Promise<Run> {
  const { ctl, rec } = humanSeat({ replay });
  const snap = new Snapshotter(ctl);
  const ai = new AIController(s.aiLevel, s.seed + (1 - s.human) * 7919);
  const ctls = (s.human === 0 ? [snap, ai] : [ai, snap]) as [PlayerController, PlayerController];
  const g = new Game(s.lists ?? [buildDeckList(s.a), buildDeckList(s.b)], ctls, { seed: s.seed, names: ['A', 'B'], maxTurns: 40, skipFirstDraw: s.skipFirstDraw });
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
  let orders = 0;
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
    orders += rec.log.filter((d) => d.k === 'ord').length;
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
  const bo3 = await sidingMatches();
  console.log(`replay-test: ${bo3} best-of-3 matches with side decking replayed`);
  console.log(`replay-test: ${GAMES} games, ${decisions} recorded decisions (${orders} trigger orders), ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failures ? 1 : 0);
})();

/** The human's swaps for the test: the first side cards that fit, for the lowest-ranked deck cards. */
function humanSwaps(d: DeckIds, n: number): DeckIds {
  let out = d;
  for (const inId of [...new Set(d.side)].slice(0, n)) {
    const inn = CARDS[inId];
    const outId = [...out.main, ...out.extra].reverse().find((id) => CARDS[id] && canSwap(CARDS[id], inn) && !out.side.includes(id));
    if (!outId) continue;
    out = swapCards(out, outId, inId) ?? out;
  }
  return out;
}

async function sidingMatches(): Promise<number> {
  const withSide = PREMADE_DECKS.filter((d) => d.side?.length);
  if (withSide.length < 2) {
    console.log('replay-test: no premade decks with a Side Deck, siding test skipped');
    return 0;
  }
  let n = 0;
  for (let m = 0; m < 3; m++) {
    const a = withSide[(m * 3) % withSide.length];
    const b = withSide[(m * 5 + 1) % withSide.length];
    const human: PlayerId = (m % 2) as PlayerId;
    const ai = (1 - human) as PlayerId;
    const matchSeed = 7700 + m * 131;
    const original: [DeckIds, DeckIds] = [deckToIds(buildDeckList(a)), deckToIds(buildDeckList(b))];
    const label = `Bo3 ${a.id} vs ${b.id} human@${human}`;
    // game 1: the original decks
    const g1: Setup = { a, b, seed: matchSeed + 1, human, aiLevel: 'normal', skipFirstDraw: false };
    const r1 = await play(g1, live(g1));
    // side: the human swaps 2 cards, the AI sides by its heuristic (from the match seed, as runMatch does)
    const sided: [DeckIds, DeckIds] = [original[0], original[1]];
    sided[human] = humanSwaps(original[human], 2);
    sided[ai] = aiSideDeck(original[ai], original[human], (matchSeed + 1 * 7919 + ai * 104729) >>> 0);
    const again = aiSideDeck(original[ai], original[human], (matchSeed + 1 * 7919 + ai * 104729) >>> 0);
    if (JSON.stringify(again) !== JSON.stringify(sided[ai])) fail(`${label}: AI siding is not deterministic`);
    const hs = sideSummary(original[human], sided[human]);
    if (!hs) fail(`${label}: the human's swaps changed nothing`);
    for (const i of [0, 1]) if (sided[i].main.length !== original[i].main.length || sided[i].side.length !== original[i].side.length) fail(`${label}: siding changed deck sizes`);
    // the saved record, as runMatch writes it, through JSON
    const lists = (d: [DeckIds, DeckIds]) => [deckFromIds(d[0])!, deckFromIds(d[1])!] as [DeckList, DeckList];
    const g2: Setup = { a, b, seed: matchSeed + 2, human, aiLevel: 'normal', skipFirstDraw: false, lists: lists(sided) };
    const r2 = await play(g2, live(g2));
    const record = JSON.parse(
      JSON.stringify({
        games: [{ winner: r1.res.winner, turns: r1.res.turns, reason: r1.res.reason, how: 'human' }],
        played: [{ decks: original }],
        seed: matchSeed,
        game: { index: 1, seed: g2.seed, first: 'coin', skipFirstDraw: false, caption: '', log: r2.log, turn: r2.res.turns, decks: sided },
      }),
    ) as Pick<SavedDuel, 'games' | 'played' | 'seed' | 'game'>;
    const restored = lists(record.game!.decks!);
    // a sided-in card is really in the game-2 deck
    const inId = sided[human].main.find((id) => !original[human].main.includes(id)) ?? sided[human].extra.find((id) => !original[human].extra.includes(id));
    if (!inId || !restored[human].main.concat(restored[human].extra).some((c) => c.id === inId)) fail(`${label}: the sided-in card is not in the restored deck`);
    if (restored[human].main.length !== original[human].main.length) fail(`${label}: restored Main Deck has ${restored[human].main.length} cards`);
    const rs: Setup = { ...g2, lists: restored };
    const full = await play(rs, fromLog(), record.game!.log);
    if (full.rec.mismatch) fail(`${label}: game 2 replay mismatch: ${full.rec.mismatch}`);
    compare(`${label} [game 2 full]`, r2, full);
    const k = Math.floor(r2.log.length / 2);
    const handoff = (o: { replay?: Decision[] }) => {
      const tail = new RecordingController(new NoLive(), { replay: r2.log.slice(k) });
      const head = new RecordingController(tail, { replay: o.replay });
      return { ctl: head, rec: tail };
    };
    const half = await play(rs, handoff, r2.log.slice(0, k));
    half.log = r2.log;
    if (half.rec.mismatch) fail(`${label}: game 2 resume mismatch: ${half.rec.mismatch}`);
    compare(`${label} [game 2 resume @${k}]`, r2, half);
    // the game itself holds the sided cards (Main Deck still 40+, the sided-in card among the human's cards)
    const probe = new Game(restored, [new NoLive(), new NoLive()], { seed: g2.seed });
    const mine = probe.allCards.filter((c) => c.owner === human);
    if (!mine.some((c) => c.data.id === inId)) fail(`${label}: the game-2 duel does not hold the sided-in card`);
    if (probe.players[human].deck.length + probe.players[human].hand.length !== original[human].main.length) fail(`${label}: game-2 Main Deck size changed`);
    // an older record without decks: the original lists, i.e. game 1 replays exactly from them
    const old = JSON.parse(JSON.stringify({ game: { index: 0, seed: g1.seed, log: r1.log } })) as { game: { decks?: [DeckIds, DeckIds]; log: Decision[] } };
    const oldLists = old.game.decks ? lists(old.game.decks) : lists(original);
    const oldRun = await play({ ...g1, lists: oldLists }, fromLog(), old.game.log);
    if (oldRun.rec.mismatch) fail(`${label}: an old record without decks no longer replays: ${oldRun.rec.mismatch}`);
    compare(`${label} [old record]`, r1, oldRun);
    if (verbose) console.log(`${label}: human ${hs}; AI ${sideSummary(original[ai], sided[ai]) || 'no change'}; game 2 ${r2.log.length} decisions`);
    n++;
  }
  return n;
}
