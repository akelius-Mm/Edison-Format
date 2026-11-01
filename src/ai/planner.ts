// Look-ahead for the AI: before a Main Phase play, try the best few candidates and keep the one that leaves the
// better board at the end of the turn.
//
// How. A duel is fully determined by its seed, the two decklists and every decision both players made
// (engine/replay.ts). A "plannable" game records both seats' decisions (planGame below). To try a candidate the
// planner builds a throwaway copy of the duel, replays every past decision into it instantly, gives the candidate as
// this decision, and lets a quick policy (the heuristic AI, without noise) finish the AI's turn. When the next turn
// starts the copy stops and its board is scored (evaluate). About 10–30 ms per try on a laptop.
//
// No cheating. The copy knows exactly what the real duel knows, so before the candidate is played, everything the AI
// could not know at a real table is replaced:
//   - both Decks are shuffled again and the copy's random numbers are reseeded (no peeking at the next draw);
//   - the opponent's hand and their face-down monsters the AI has not seen face up become a plain stand-in (Dark
//     Rabbit, a vanilla 1100/1500);
//   - each of their set Spells/Traps becomes a guess drawn from what was commonly set in 2010 (Bottomless Trap Hole,
//     Solemn Judgment, Torrential Tribute, Mirror Force, Dimensional Prison, Mystical Space Typhoon, Book of Moon…,
//     and some bluffs), and the opponent in the copy plays its guesses the way the heuristic AI would. Each candidate
//     is tried against a couple of different guesses and the scores averaged.
// The choice depends only on the duel and the AI's seed (never on the clock), so resuming and undoing replay the same
// AI plays (engine/undo.ts).
import type { CardInstance } from '../engine/card';
import type { Action, Activation, PlayerController, ResponseRequest } from '../engine/controller';
import { Game, GameOver, type DeckList } from '../engine/game';
import { RecordingController, cardRef, stateDigest, type Decision } from '../engine/replay';
import { Rng } from '../engine/rng';
import type { PlayerId } from '../engine/types';
import { findCard } from '../cards';
import { AIController, type Difficulty } from './ai';

// ---------------------------------------------------------------- recording both seats

interface Plannable {
  decks: [DeckList, DeckList];
  logs: [Decision[], Decision[]];
}
const PLANNABLE = new WeakMap<Game, Plannable>();

/**
 * Create a Game whose AI seats can look ahead: both seats' decisions are recorded (outermost, so the log holds the
 * final answers). Use it wherever a planning AI plays (the duel screen; the AI-strength test).
 */
export function planGame(decks: [DeckList, DeckList], controllers: [PlayerController, PlayerController], opts: ConstructorParameters<typeof Game>[2] = {}): Game {
  const recs = controllers.map((c) => new RecordingController(c)) as [RecordingController, RecordingController];
  const game = new Game(decks, recs, opts);
  PLANNABLE.set(game, { decks, logs: [recs[0].log, recs[1].log] });
  return game;
}

// ---------------------------------------------------------------- the planner

/** How hard each difficulty looks ahead: candidates tried per Main Phase decision (0 = no look-ahead), and guesses
 *  at the opponent's hidden cards per candidate. */
const LOOKAHEAD: Record<Difficulty, number> = { easy: 0, normal: 4, hard: 6 };
const GUESSES: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2 };
/** Turns a copy is played out: 1 = to the end of this turn, 2 = through the next turn as well. */
const HORIZON: Record<Difficulty, number> = { easy: 0, normal: 2, hard: 2 };

/** Stops a copy: the AI's turn is over (or the copy ran too long). */
class Stop extends GameOver {
  constructor() {
    super(null, 'plan-stop');
  }
}

/** Test hook: explain the plays where look-ahead overrules the heuristic. */
export const planDebug: { log?: (s: string) => void; noResponses?: boolean; battle?: boolean } = {};

/** Recent choices by duel + log position, so an undo or a second look at the same moment costs nothing. */
const MEMO = new Map<string, number>();
const MEMO_MAX = 400;

/**
 * The choices are also kept on the device for the last few duels: resuming a duel replays it from the start, and
 * without these the AI would think every past play through again (seconds on a phone). The choices are
 * deterministic, so a stored one is exactly what the AI would work out again.
 */
const STORE_KEY = 'edison.aiPlans.v1';
const STORE_DUELS = 3;
const STORE_PER_DUEL = 800;
type Store = { order: string[]; plans: Record<string, Record<string, number>> };
let store: Store | null = null;
function loadStore(): Store {
  if (store) return store;
  store = { order: [], plans: {} };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null;
    if (raw) store = JSON.parse(raw) as Store;
  } catch {
    /* start empty */
  }
  return store!;
}
/** Forget every remembered choice (tests: the AI must work the same plays out again). */
export function clearPlanMemo() {
  MEMO.clear();
  store = { order: [], plans: {} };
}
function memoGet(duel: string, key: string): number | undefined {
  return MEMO.get(key) ?? loadStore().plans[duel]?.[key];
}
function memoSet(duel: string, key: string, pick: number) {
  MEMO.set(key, pick);
  if (MEMO.size > MEMO_MAX) MEMO.delete(MEMO.keys().next().value!);
  if (typeof localStorage === 'undefined') return;
  const st = loadStore();
  if (!st.plans[duel]) {
    st.plans[duel] = {};
    st.order.push(duel);
    while (st.order.length > STORE_DUELS) delete st.plans[st.order.shift()!];
  }
  const plans = st.plans[duel];
  if (Object.keys(plans).length >= STORE_PER_DUEL) return;
  plans[key] = pick;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(st));
  } catch {
    /* full: the AI just thinks again on resume */
  }
}

export class PlannerAI extends AIController {
  /** Copies tried (for the strength test and the debug overlay). */
  sims = 0;
  /** Copies that failed (replay drift, crash) or did not match the real duel at the decision. */
  simFails = 0;

  constructor(
    difficulty: Difficulty = 'normal',
    private seed = Math.floor(Math.random() * 1e9),
    private width = LOOKAHEAD[difficulty],
    private guesses = GUESSES[difficulty] || 1,
    /** Turns played out in a copy: 1 = to the end of the AI's turn, 2 = through the opponent's next turn too. */
    private horizon = HORIZON[difficulty] || 1,
    /** Guess hidden cards from the opponent's own unseen cards (their decklist) instead of generic 2010 picks. */
    private fromDeck = true,
  ) {
    super(difficulty, seed);
  }

  async chooseAction(game: Game, p: PlayerId, actions: Action[]): Promise<Action> {
    const plan = PLANNABLE.get(game);
    // Main Phases only: in the AI-strength test, looking ahead in the Battle Phase did not beat the heuristic's attack
    // plans (scripts/ai-strength.ts, 192 mirror games)
    const phaseOk = game.phase === 'main1' || game.phase === 'main2' || (game.phase === 'battle' && planDebug.battle === true);
    if (!plan || !this.width || game.turnPlayer !== p || !phaseOk || actions.length < 2) return super.chooseAction(game, p, actions);
    this.observe(game, p);

    // the heuristic's ranking picks the candidates (and breaks ties)
    const ranked = actions
      .map((a, i) => {
        let s = this.scoreAction(game, p, a);
        if (this.used(game, this.actionKey(a)) >= 3) s -= 100;
        return { i, s, name: `${a.type}:${(a as any).card?.name ?? (a as any).to ?? ''}` };
      })
      .sort((x, y) => y.s - x.s);
    const pass = ranked.find((r) => actions[r.i].type === 'phase');
    // plays the heuristic rejects outright (score below 0) are not worth a copy
    const cands = ranked.filter((r) => r.s >= 0 && actions[r.i].type !== 'surrender').slice(0, this.width);
    if (pass && !cands.includes(pass)) cands.push(pass);
    let pick = cands.length < 2 ? null : await this.decide(game, plan, p, 'act', cands, actions.length);
    if (pick === null) return super.chooseAction(game, p, actions);
    // keep the heuristic's own bookkeeping (attack plans, per-turn use counts) in step with the play
    this.scoreAction(game, p, actions[pick]);
    const chosen = actions[pick];
    this.bump(game, this.actionKey(chosen));
    return chosen;
  }

  async chooseResponse(game: Game, p: PlayerId, req: ResponseRequest): Promise<Activation | null> {
    const heur = await super.chooseResponse(game, p, req);
    const plan = PLANNABLE.get(game);
    if (!plan || !this.width || !req.options.length || planDebug.noResponses) return heur;
    // Think it over only when it matters: the heuristic wants to respond, or something just happened (a summon, an
    // attack, a chain). Plain phase windows with nothing going on would make every turn slow.
    if (!heur && req.kind === 'phase') return heur;
    // candidates: the heuristic's answer first, then passing, then the other responses
    const hi = heur ? req.options.indexOf(heur) : -1;
    const order = [hi, -1, ...req.options.map((_, i) => i)].filter((x, i, a) => a.indexOf(x) === i).slice(0, this.width + 1);
    const cands = order.map((i, k) => ({ i, s: k === 0 ? 10 : 0, name: i < 0 ? 'pass' : `resp:${req.options[i].card.name}` }));
    const pick = await this.decide(game, plan, p, 'resp', cands, req.options.length);
    if (pick === null) return heur;
    return pick < 0 ? null : req.options[pick];
  }

  /**
   * Try each candidate answer in copies of the duel (a couple of guesses at the hidden cards each) and return the best
   * one's index, or null when no copy could be made.
   */
  private async decide(game: Game, plan: Plannable, p: PlayerId, kind: 'act' | 'resp', cands: { i: number; s: number; name: string }[], n: number): Promise<number | null> {
    // the duel, the seat, where in the duel, and the board right now (two duels can share a seed)
    const last = (l: Decision[]) => (l.length ? l[l.length - 1].h : '');
    const key = `${kind}:${game.options.seed}:${p}:${plan.logs[0].length}:${plan.logs[1].length}:${last(plan.logs[0])}:${last(plan.logs[1])}:${stateDigest(game)}:${this.width}:${n}`;
    const duel = `${game.options.seed}:${plan.decks[0].main.length}:${plan.decks[1].main.length}`;
    const memo = memoGet(duel, key);
    if (memo !== undefined) return memo;
    const sampleSeed = (this.seed ^ Math.imul(plan.logs[p].length + 1, 0x9e3779b1)) >>> 0;
    let best: (typeof cands)[number] | null = null;
    let bestV = -Infinity;
    const vals: string[] = [];
    for (const c of cands) {
      let v: number | null = 0;
      for (let k = 0; k < this.guesses && v !== null; k++) {
        const r = await this.tryCandidate(game, plan, p, kind, c.i, (sampleSeed + k * 0x632be5ab) >>> 0);
        v = r === null ? null : v + r / this.guesses;
      }
      if (v === null) continue;
      vals.push(`${c.name}=${Math.round(v)}(${Math.round(c.s)})`);
      // the heuristic score breaks near-ties
      const total = v + c.s * 4;
      if (total > bestV) {
        bestV = total;
        best = c;
      }
      // let the screen breathe between copies
      await yieldToUI();
    }
    if (!best) return null;
    if (planDebug.log && best !== cands[0]) planDebug.log(`T${game.turn} ${game.phase} ${best.name} over ${cands[0].name}  ${vals.join(' ')}`);
    memoSet(duel, key, best.i);
    return best.i;
  }

  /** Answer this decision with candidate `index` in a fresh copy of the duel, play on, and score the board. null = the copy failed. */
  private async tryCandidate(live: Game, plan: Plannable, p: PlayerId, kind: 'act' | 'resp', index: number, sampleSeed: number): Promise<number | null> {
    this.sims++;
    const o = live.opp(p);
    const turn = live.turn;
    const liveCards = live.allCards.length;
    const liveDigest = stateDigest(live);
    let requests = 0;
    const guard = (g: Game) => {
      if (g.turn >= turn + this.horizon || g.turn < turn || ++requests > 400 * this.horizon) throw new Stop();
    };
    const policy = new RolloutAI('hard', sampleSeed, guard);
    // the opponent plays its guessed cards (hideUnknown) the way the heuristic AI would
    const opponent = new RolloutAI('hard', sampleSeed + 1, guard);
    let injected = false;
    let failed = false;
    const knows = (c: CardInstance) => this.knows(c);
    const fromDeck = this.fromDeck;
    // the copy has reached this decision: hide what the AI cannot know, then give the candidate
    const arrive = (g: Game) => {
      injected = true;
      if (g.allCards.length !== liveCards || stateDigest(g) !== liveDigest) failed = true;
      hideUnknown(live, g, p, sampleSeed, knows, fromDeck);
    };
    const mine: PlayerController = new Proxy(policy, {
      get(t, k) {
        if (!injected && kind === 'act' && k === 'chooseAction')
          return async (g: Game, _pl: PlayerId, acts: Action[]) => {
            arrive(g);
            if (!acts[index]) failed = true;
            return acts[index] ?? acts[acts.length - 1];
          };
        if (!injected && kind === 'resp' && k === 'chooseResponse')
          return async (g: Game, _pl: PlayerId, req: ResponseRequest) => {
            arrive(g);
            if (index >= req.options.length) failed = true;
            return index < 0 ? null : (req.options[index] ?? null);
          };
        if (!injected && typeof k === 'string' && k !== 'isHuman' && typeof (t as any)[k] === 'function')
          return () => {
            // the copy asked something else first: it went its own way
            failed = true;
            throw new Stop();
          };
        const v = (t as any)[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    }) as PlayerController;
    const seats: [PlayerController, PlayerController] = [null as any, null as any];
    seats[p] = new RecordingController(mine, { replay: plan.logs[p].slice(), onMismatch: () => (failed = true) });
    seats[o] = new RecordingController(opponent, { replay: plan.logs[o].slice(), onMismatch: () => (failed = true) });
    const copy = new Game(plan.decks, seats, { ...live.options });
    try {
      await copy.start();
    } catch {
      this.simFails++;
      return null;
    }
    if (failed || !injected) {
      this.simFails++;
      return null;
    }
    return evaluate(copy, p);
  }
}

/** The heuristic AI without noise, stopping when the turn is over. */
class RolloutAI extends AIController {
  constructor(d: Difficulty, seed: number, private guard: (g: Game) => void) {
    super(d, seed);
    for (const k of ['chooseAction', 'chooseResponse', 'selectCards', 'chooseOption', 'confirm', 'choosePosition', 'chooseAttackTarget', 'confirmTrigger', 'chooseTriggerOrder', 'declareCard'] as const) {
      const f = (this as any)[k];
      if (typeof f === 'function')
        (this as any)[k] = (g: Game, ...rest: unknown[]) => {
          this.guard(g);
          return f.call(this, g, ...rest);
        };
    }
  }
}

// ---------------------------------------------------------------- hiding what the AI cannot know

const HIDDEN_MONSTER = 'Dark Rabbit';
/** What a face-down Spell/Trap probably is in 2010 Edison, with rough weights (bluffs included). */
const SET_GUESSES: [string, number][] = [
  ['Bottomless Trap Hole', 3],
  ['Solemn Judgment', 2],
  ['Torrential Tribute', 2],
  ['Dimensional Prison', 2],
  ['Mystical Space Typhoon', 2],
  ['Book of Moon', 2],
  ['Mirror Force', 1],
  ['Dark Bribe', 1],
  ['Trap Dustshoot', 1],
  ['Phoenix Wing Wind Blast', 1],
  ['Call of the Haunted', 1],
  ['Sakuretsu Armor', 1],
  ['Royal Oppression', 0.5],
  ['Magic Cylinder', 0.5],
  ['Smashing Ground', 1], // a set Normal Spell: a bluff on our turn
  ['Pot of Avarice', 1],
];

function guessSet(rng: Rng) {
  const total = SET_GUESSES.reduce((a, [, w]) => a + w, 0);
  let r = rng.next() * total;
  for (const [n, w] of SET_GUESSES) if ((r -= w) <= 0) return findCard(n);
  return findCard(SET_GUESSES[0][0]);
}

function hideUnknown(live: Game, copy: Game, p: PlayerId, seed: number, knows: (c: CardInstance) => boolean, fromDeck: boolean) {
  const rng = new Rng(seed ^ 0x2545f491);
  copy.rng = new Rng(rng.int(2 ** 31));
  rng.shuffle(copy.players[p].deck);
  const o = copy.opp(p);
  const op = copy.players[o];
  const liveOf = (c: CardInstance) => live.allCards[cardRef(copy, c)];
  // the opponent's cards the AI has not seen: their hand, Deck, face-down monsters it never saw face up, set Spells/Traps
  const hiddenMon = op.mzone.filter((c): c is CardInstance => !!c && !c.faceUp && !knows(liveOf(c) ?? c));
  const hiddenST = op.szone.filter((c): c is CardInstance => !!c && !c.faceUp);
  const hand = op.hand.filter((c) => c.revealedUntil < copy.turn);
  if (fromDeck) {
    // deal them again from that same pool: right card types for the zones, right count, unknown order
    const pool = [...hand, ...op.deck, ...hiddenMon, ...hiddenST].map((c) => c.printedData);
    rng.shuffle(pool);
    const take = (want: (d: (typeof pool)[number]) => boolean) => {
      const i = pool.findIndex(want);
      return i < 0 ? undefined : pool.splice(i, 1)[0];
    };
    for (const c of hiddenMon) {
      const d = take((x) => x.kind === 'monster' && !x.mtypes?.some((t) => t === 'synchro' || t === 'fusion'));
      if (d) c.data = d;
    }
    for (const c of hiddenST) {
      const d = take((x) => x.kind !== 'monster');
      if (d) c.data = d;
    }
    for (const c of hand) {
      const d = pool.shift();
      if (d) c.data = d;
    }
    for (const c of op.deck) {
      const d = pool.shift();
      if (d) c.data = d;
    }
    return;
  }
  rng.shuffle(op.deck);
  const mon = findCard(HIDDEN_MONSTER);
  if (!mon) return;
  for (const c of hand) c.data = mon;
  for (const c of hiddenMon) c.data = mon;
  for (const c of hiddenST) {
    const g = guessSet(rng);
    if (g) c.data = g;
  }
}

// ---------------------------------------------------------------- scoring a board

// Values in "card" units (a card ≈ 1000): Edison is decided by card advantage, then by how good the cards are.
const CARD = 1000;

/** What one card on the field is worth to its controller. */
function fieldValue(g: Game, c: CardInstance): number {
  if (c.isMonster && c.location === 'mzone') {
    if (!c.faceUp) return 1100;
    const stat = Math.max(g.getAtk(c), c.pos === 'def' ? g.getDef(c) : 0);
    let v = 900 + stat * 0.35 + (c.isExtra ? 300 : 0) + (c.hasType('effect') ? 150 : 0) + (c.data.aiValue ?? 0) * 0.2;
    if (c.isToken) v *= 0.45;
    return v;
  }
  if (!c.faceUp) return c.isTrap || c.data.stype === 'quickplay' ? 1050 : 700; // a set Normal Spell is mostly a bluff
  return 900; // face-up Continuous / Equip / Field
}

/** How good the board is for `p` (higher is better), at the start of the opponent's turn. */
export function evaluate(g: Game, p: PlayerId): number {
  if (g.winner === p) return 1e6;
  const o = g.opp(p);
  if (g.winner === o) return -1e6;
  const me = g.players[p];
  const op = g.players[o];
  let v = 0;
  // Life Points: each point counts more as they run low
  const lp = (x: number) => (x <= 0 ? -9000 : x >= 4000 ? 1600 + (x - 4000) * 0.25 : x * 0.4);
  v += lp(me.lp) - lp(op.lp);
  const side = (pl: PlayerId) => {
    const ps = g.players[pl];
    let t = ps.hand.length * CARD;
    for (const c of [...ps.mzone, ...ps.szone, ps.fzone]) if (c) t += fieldValue(g, c);
    return t;
  };
  v += side(p) - side(o);
  // Running out of cards loses the duel
  if (me.deck.length < 6) v -= (6 - me.deck.length) * 400;
  // Their next turn: our face-up Attack Position monsters weaker than their best attacker are likely lost
  const oppBest = Math.max(0, ...g.faceUpMonsters(o).filter((m) => m.pos === 'atk').map((m) => g.getAtk(m)));
  for (const m of g.faceUpMonsters(p)) if (m.pos === 'atk' && g.getAtk(m) < oppBest) v -= fieldValue(g, m) * 0.5;
  // Overextending: past two monsters, each more one is exposed to what they may still have (hand, set cards)
  const mons = me.mzone.filter(Boolean).length;
  const unknown = op.szone.filter((c) => c && !c.faceUp).length + op.hand.length;
  if (mons > 2 && unknown) v -= (mons - 2) * Math.min(unknown, 4) * 40;
  return v;
}

function yieldToUI() {
  return new Promise<void>((r) => (typeof setTimeout === 'function' ? setTimeout(r, 0) : r()));
}

/** The AI for a seat: look-ahead on Normal and Hard (only in a plannable game, see planGame). */
export function createPlayerAI(difficulty: Difficulty = 'normal', seed?: number): AIController {
  return new PlannerAI(difficulty, seed);
}
